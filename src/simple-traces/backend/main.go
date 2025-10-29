package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
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
}

// Run starts the Simple Traces server using environment configuration.
func Run(logLevelFlag string) error {
	config := loadConfig(logLevelFlag)

	// Initialize logger
	logger := InitLogger(config.LogLevel)
	logger.Info("Starting Simple Traces server")
	logger.Info("Log level: %s", config.LogLevel)

	db, err := InitDatabase(&config)
	if err != nil {
		logger.Error("Failed to initialize database: %v", err)
		return fmt.Errorf("init db: %w", err)
	}
	defer db.Close()
	logger.Info("Database initialized successfully (type: %s)", config.DBType)

	router := mux.NewRouter()

	// API routes
	api := router.PathPrefix("/api").Subrouter()

	// Spans endpoints: list and import JSONL examples
	api.HandleFunc("/spans", getSpansHandler(db, logger)).Methods("GET")

	// Grouped traces (OTLP trace_id)
	api.HandleFunc("/trace-groups", getTraceGroupsHandler(db, logger)).Methods("GET")
	api.HandleFunc("/trace-groups/{trace_id}", getTraceGroupSpansHandler(db, logger)).Methods("GET")
	api.HandleFunc("/trace-groups/{trace_id}", deleteTraceGroupHandler(db, logger)).Methods("DELETE")

	// Projects API
	api.HandleFunc("/projects", getProjectsHandler(db, logger)).Methods("GET")
	api.HandleFunc("/projects", createProjectHandler(db, logger)).Methods("POST")
	api.HandleFunc("/projects/{id}", getProjectByIDHandler(db, logger)).Methods("GET")

	// Conversations API
	api.HandleFunc("/conversations", getConversationsHandler(db, logger)).Methods("GET")
	api.HandleFunc("/conversations/{id}", deleteConversationHandler(db, logger)).Methods("DELETE")

	// OpenTelemetry OTLP endpoint
	otlpHandler := NewOTLPHandler(db, logger)
	router.HandleFunc("/v1/traces", otlpHandler.ServeHTTP).Methods("POST")
	logger.Info("OTLP HTTP endpoint enabled at /v1/traces")

	// Serve embedded frontend static files with SPA fallback
	router.PathPrefix("/").Handler(newSPAHandler(getFrontendFS()))

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
	logger.Info("OTLP ingest endpoint: %s/v1/traces", baseURL)
	if err := http.ListenAndServe(addr, router); err != nil {
		logger.Error("Server failed to start: %v", err)
		return fmt.Errorf("listen and serve: %w", err)
	}
	return nil
}

func loadConfig(logLevelFlag string) Config {
	config := Config{
		DBType: getEnv("DB_TYPE", "sqlite"),
		// Default to a local, writable path for non-container runs; Dockerfile overrides to /data/traces.db
		DBConnection: getEnv("DB_CONNECTION", "./data/traces.db"),
		Port:         getEnv("PORT", "8080"),
		FrontendDir:  "", // No longer used - frontend is embedded
		LogLevel:     getLogLevel(logLevelFlag),
	}

	if config.DBType == "postgres" && config.DBConnection == "./traces.db" {
		config.DBConnection = "postgres://localhost/traces?sslmode=disable"
	}

	return config
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getLogLevel returns log level from flag or environment, preferring flag
func getLogLevel(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	return getEnv("LOG_LEVEL", "INFO")
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

// getSpansHandler returns spans ordered by start_time DESC with optional pagination
func getSpansHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit := 100
		if s := strings.TrimSpace(q.Get("limit")); s != "" {
			if v, err := strconv.Atoi(s); err == nil && v > 0 {
				limit = v
			}
		}
		var before time.Time
		if sb := strings.TrimSpace(q.Get("before")); sb != "" {
			if t, err := time.Parse(time.RFC3339Nano, sb); err == nil {
				before = t
			} else if t, err := time.Parse(time.RFC3339, sb); err == nil {
				before = t
			}
		}
		spans, err := db.GetSpans(limit, before)
		if err != nil {
			logger.Error("Failed to get spans: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get spans: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(spans)
	}
}

// getTraceGroupsHandler returns groups of spans by trace_id, ordered by most recent activity
func getTraceGroupsHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit := 100
		if s := strings.TrimSpace(q.Get("limit")); s != "" {
			if v, err := strconv.Atoi(s); err == nil && v > 0 {
				limit = v
			}
		}
		var before time.Time
		if sb := strings.TrimSpace(q.Get("before")); sb != "" {
			if t, err := time.Parse(time.RFC3339Nano, sb); err == nil {
				before = t
			} else if t, err := time.Parse(time.RFC3339, sb); err == nil {
				before = t
			}
		}
		search := strings.TrimSpace(q.Get("q"))
		groups, err := db.GetTraceGroups(limit, before)
		if search != "" {
			groups, err = db.GetTraceGroupsWithSearch(limit, before, search)
		}
		if err != nil {
			logger.Error("Failed to get trace groups: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get trace groups: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(groups)
	}
}

// getTraceGroupSpansHandler returns spans for a specific trace_id ordered as a continuous thread
func getTraceGroupSpansHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		traceID := vars["trace_id"]
		limit := 2000
		if s := strings.TrimSpace(r.URL.Query().Get("limit")); s != "" {
			if v, err := strconv.Atoi(s); err == nil && v > 0 {
				limit = v
			}
		}
		search := strings.TrimSpace(r.URL.Query().Get("q"))
		spans, err := db.GetTraceGroupSpans(traceID, limit)
		if search != "" {
			spans, err = db.GetTraceGroupSpansWithSearch(traceID, limit, search)
		}
		if err != nil {
			logger.Error("Failed to get group spans: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get group spans: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(spans)
	}
}

// deleteTraceGroupHandler deletes all spans for a given trace_id (trace group)
func deleteTraceGroupHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		groupID := strings.TrimSpace(vars["trace_id"]) // using same param name for compatibility
		if groupID == "" {
			http.Error(w, "missing trace_id", http.StatusBadRequest)
			return
		}
		// Delete by conversation group id (new grouping)
		deleted, err := db.DeleteSpansByGroupID(groupID)
		if err != nil {
			logger.Error("Failed to delete trace group %s: %v", groupID, err)
			http.Error(w, fmt.Sprintf("Failed to delete group: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"ok":      true,
			"deleted": deleted,
		})
	}
}

// getProjectsHandler returns all projects
func getProjectsHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		projects, err := db.GetProjects()
		if err != nil {
			logger.Error("Failed to get projects: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get projects: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(projects)
	}
}

// getProjectByIDHandler returns a single project by ID
func getProjectByIDHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := strings.TrimSpace(vars["id"])
		if id == "" {
			http.Error(w, "missing id", http.StatusBadRequest)
			return
		}

		project, err := db.GetProjectByID(id)
		if err != nil {
			logger.Error("Failed to get project: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get project: %v", err), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(project)
	}
}

// createProjectHandler creates a new project
func createProjectHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if strings.TrimSpace(req.ID) == "" || strings.TrimSpace(req.Name) == "" {
			http.Error(w, "id and name are required", http.StatusBadRequest)
			return
		}

		if err := db.CreateProject(req.ID, req.Name); err != nil {
			logger.Error("Failed to create project: %v", err)
			http.Error(w, fmt.Sprintf("Failed to create project: %v", err), http.StatusInternalServerError)
			return
		}

		// Return the created project
		project, err := db.GetProjectByID(req.ID)
		if err != nil {
			logger.Error("Failed to get created project: %v", err)
			http.Error(w, "Project created but failed to retrieve", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(project)
	}
}

// getConversationsHandler returns paginated conversations ordered by last_end_time DESC
func getConversationsHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit := 100
		if s := strings.TrimSpace(q.Get("limit")); s != "" {
			if v, err := strconv.Atoi(s); err == nil && v > 0 {
				limit = v
			}
		}
		var before time.Time
		if sb := strings.TrimSpace(q.Get("before")); sb != "" {
			if t, err := time.Parse(time.RFC3339Nano, sb); err == nil {
				before = t
			} else if t, err := time.Parse(time.RFC3339, sb); err == nil {
				before = t
			}
		}
		search := strings.TrimSpace(q.Get("q"))
		convs, err := db.GetConversations(limit, before)
		if search != "" {
			convs, err = db.GetConversationsWithSearch(limit, before, search)
		}
		if err != nil {
			logger.Error("Failed to get conversations: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get conversations: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(convs)
	}
}

// deleteConversationHandler deletes all data linked to a conversation id
// deleteConversationHandler deletes all data linked to a conversation id
func deleteConversationHandler(db Database, logger *Logger) http.HandlerFunc { // fmt: skip
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := strings.TrimSpace(vars["id"])
		if id == "" {
			http.Error(w, "missing id", http.StatusBadRequest)
			return
		}

		// Best-effort: delete spans first
		nSpans, err := db.DeleteSpansByConversationID(id)
		if err != nil {
			logger.Error("delete spans by conversation id failed: %v", err)
			http.Error(w, fmt.Sprintf("failed to delete spans: %v", err), http.StatusInternalServerError)
			return
		}
		if _, err := db.DeleteConversationRow(id); err != nil {
			logger.Warn("delete conversation row failed: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "deleted_spans": nSpans})
	}
}
