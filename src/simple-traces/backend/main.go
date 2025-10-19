package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

type Config struct {
	DBType       string
	DBConnection string
	Port         string
	FrontendDir  string
	LogLevel     string
	OTLPEnabled  bool
	OTLPEndpoint string
}

// Run starts the Simple Traces server using environment configuration.
func Run() error {
	config := loadConfig()

	// Initialize logger
	logger := InitLogger(config.LogLevel)
	logger.Info("Starting Simple Traces server")
	logger.Info("Log level: %s", config.LogLevel)

	db, err := initDB(config)
	if err != nil {
		logger.Error("Failed to initialize database: %v", err)
		return fmt.Errorf("init db: %w", err)
	}
	defer db.Close()
	logger.Info("Database initialized successfully (type: %s)", config.DBType)

	// Log OTLP collector status
	if config.OTLPEnabled {
		logger.Info("OpenTelemetry OTLP collector enabled")
	} else {
		logger.Info("OpenTelemetry OTLP collector disabled")
	}

	router := mux.NewRouter()

	// API routes
	api := router.PathPrefix("/api").Subrouter()
	api.HandleFunc("/traces", createTraceHandler(db, logger)).Methods("POST")
	api.HandleFunc("/traces", getTracesHandler(db, logger)).Methods("GET")
	api.HandleFunc("/traces/{id}", getTraceByIDHandler(db, logger)).Methods("GET")

	// OpenTelemetry OTLP endpoint
	if config.OTLPEnabled {
		otlpHandler := NewOTLPHandler(db, logger)
		router.HandleFunc("/v1/traces", otlpHandler.ServeHTTP).Methods("POST")
		logger.Info("OTLP HTTP endpoint enabled at /v1/traces")
	}

	// Serve embedded frontend static files
	router.PathPrefix("/").Handler(http.FileServer(getFrontendFS()))

	// Enable CORS for development
	router.Use(corsMiddleware)
	router.Use(loggingMiddleware(logger))

	addr := ":" + config.Port
	logger.Info("Server starting on %s", addr)

	// Print a clickable URL for local development
	baseURL := fmt.Sprintf("http://localhost:%s", config.Port)
	logger.Info("Open in your browser: %s", baseURL)
	logger.Debug("Alternative: http://127.0.0.1:%s", config.Port)
	logger.Debug("API base: %s/api", baseURL)
	if config.OTLPEnabled {
		logger.Info("OTLP ingest endpoint: %s/v1/traces", baseURL)
	}
	if err := http.ListenAndServe(addr, router); err != nil {
		logger.Error("Server failed to start: %v", err)
		return fmt.Errorf("listen and serve: %w", err)
	}
	return nil
}

func loadConfig() Config {
	config := Config{
		DBType: getEnv("DB_TYPE", "sqlite"),
		// Default to a local, writable path for non-container runs; Dockerfile overrides to /data/traces.db
		DBConnection: getEnv("DB_CONNECTION", "./data/traces.db"),
		Port:         getEnv("PORT", "8080"),
		FrontendDir:  "", // No longer used - frontend is embedded
		LogLevel:     getEnv("LOG_LEVEL", "INFO"),
		OTLPEnabled:  parseBool(getEnv("OTLP_ENABLED", "true")),
		OTLPEndpoint: getEnv("OTLP_ENDPOINT", ":4318"),
	}

	if config.DBType == "postgres" && config.DBConnection == "./traces.db" {
		config.DBConnection = "postgres://localhost/traces?sslmode=disable"
	}

	return config
}

func parseBool(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "true" || s == "1" || s == "yes" || s == "on"
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(logger *Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Log request
			logger.Debug("Request: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

			// Wrap response writer to capture status code
			wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			next.ServeHTTP(wrapped, r)

			// Log response
			duration := time.Since(start)
			logger.Info("Request: %s %s - Status: %d - Duration: %v", r.Method, r.URL.Path, wrapped.statusCode, duration)
		})
	}
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

type TraceInput struct {
	Model        string                 `json:"model"`
	Input        string                 `json:"input"`
	Output       string                 `json:"output"`
	PromptTokens int                    `json:"prompt_tokens"`
	OutputTokens int                    `json:"output_tokens"`
	Duration     int64                  `json:"duration"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

func createTraceHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input TraceInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			logger.Warn("Invalid request body for trace creation: %v", err)
			http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		logger.Debug("Creating trace: Model=%s, PromptTokens=%d, OutputTokens=%d, Duration=%dms",
			input.Model, input.PromptTokens, input.OutputTokens, input.Duration)

		metadataJSON, _ := json.Marshal(input.Metadata)

		trace := Trace{
			Model:        input.Model,
			Input:        input.Input,
			Output:       input.Output,
			PromptTokens: input.PromptTokens,
			OutputTokens: input.OutputTokens,
			Duration:     input.Duration,
			Metadata:     string(metadataJSON),
			Timestamp:    time.Now(),
		}

		id, err := db.CreateTrace(trace)
		if err != nil {
			logger.Error("Failed to create trace: %v", err)
			http.Error(w, fmt.Sprintf("Failed to create trace: %v", err), http.StatusInternalServerError)
			return
		}

		logger.Info("Trace created successfully: %s (Model: %s, Duration: %dms, Tokens: %d/%d)",
			id, input.Model, input.Duration, input.PromptTokens, input.OutputTokens)

		trace.ID = id
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":      id,
			"message": "Trace created successfully",
		})
	}
}

func getTracesHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		logger.Debug("Fetching all traces")
		traces, err := db.GetTraces()
		if err != nil {
			logger.Error("Failed to get traces: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get traces: %v", err), http.StatusInternalServerError)
			return
		}

		logger.Debug("Retrieved %d traces", len(traces))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(traces)
	}
}

func getTraceByIDHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		logger.Debug("Fetching trace by ID: %s", id)

		trace, err := db.GetTraceByID(id)
		if err != nil {
			logger.Error("Failed to get trace %s: %v", id, err)
			http.Error(w, fmt.Sprintf("Failed to get trace: %v", err), http.StatusInternalServerError)
			return
		}

		if trace == nil {
			logger.Debug("Trace not found: %s", id)
			http.Error(w, "Trace not found", http.StatusNotFound)
			return
		}

		logger.Debug("Retrieved trace: %s", id)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(trace)
	}
}
