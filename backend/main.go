package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
)

type Config struct {
	DBType       string
	DBConnection string
	Port         string
	FrontendDir  string
}

func main() {
	config := loadConfig()

	db, err := initDB(config)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	router := mux.NewRouter()

	// API routes
	api := router.PathPrefix("/api").Subrouter()
	api.HandleFunc("/traces", createTraceHandler(db)).Methods("POST")
	api.HandleFunc("/traces", getTracesHandler(db)).Methods("GET")
	api.HandleFunc("/traces/{id}", getTraceByIDHandler(db)).Methods("GET")

	// Serve embedded frontend static files
	router.PathPrefix("/").Handler(http.FileServer(getFrontendFS()))

	// Enable CORS for development
	router.Use(corsMiddleware)

	addr := ":" + config.Port
	log.Printf("Server starting on %s", addr)
	log.Printf("Database type: %s", config.DBType)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func loadConfig() Config {
	config := Config{
		DBType:       getEnv("DB_TYPE", "sqlite"),
		DBConnection: getEnv("DB_CONNECTION", "./traces.db"),
		Port:         getEnv("PORT", "8080"),
		FrontendDir:  "", // No longer used - frontend is embedded
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

type TraceInput struct {
	Model        string                 `json:"model"`
	Input        string                 `json:"input"`
	Output       string                 `json:"output"`
	PromptTokens int                    `json:"prompt_tokens"`
	OutputTokens int                    `json:"output_tokens"`
	Duration     int64                  `json:"duration"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

func createTraceHandler(db Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input TraceInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
			return
		}

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
			http.Error(w, fmt.Sprintf("Failed to create trace: %v", err), http.StatusInternalServerError)
			return
		}

		trace.ID = id
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":      id,
			"message": "Trace created successfully",
		})
	}
}

func getTracesHandler(db Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		traces, err := db.GetTraces()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get traces: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(traces)
	}
}

func getTraceByIDHandler(db Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		trace, err := db.GetTraceByID(id)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get trace: %v", err), http.StatusInternalServerError)
			return
		}

		if trace == nil {
			http.Error(w, "Trace not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(trace)
	}
}
