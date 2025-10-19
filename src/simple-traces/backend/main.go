package backend

import (
	"bufio"
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
	api.HandleFunc("/traces/{id}", deleteTraceHandler(db, logger)).Methods("DELETE")

	// Spans endpoints: list and import JSONL examples
	api.HandleFunc("/spans", getSpansHandler(db, logger)).Methods("GET")
	api.HandleFunc("/spans/import", importSpansJSONLHandler(db, logger)).Methods("POST")

	// Grouped traces (OTLP trace_id)
	api.HandleFunc("/trace-groups", getTraceGroupsHandler(db, logger)).Methods("GET")
	api.HandleFunc("/trace-groups/{trace_id}", getTraceGroupSpansHandler(db, logger)).Methods("GET")
	api.HandleFunc("/trace-groups/{trace_id}", deleteTraceGroupHandler(db, logger)).Methods("DELETE")

	// Conversations API
	api.HandleFunc("/conversations", getConversationsHandler(db, logger)).Methods("GET")

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
		// Optional pagination: limit (default 100), before (RFC3339 timestamp)
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

		logger.Debug("Fetching traces with limit=%d before=%v", limit, before)
		traces, err := db.GetTracesPaginated(limit, before)
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

func deleteTraceHandler(db Database, logger *Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]
		logger.Debug("Deleting trace: %s", id)

		// Try to find related OTLP trace_id from metadata and delete those spans
		if tr, err := db.GetTraceByID(id); err == nil && tr != nil && tr.Metadata != "" {
			var meta map[string]any
			if err := json.Unmarshal([]byte(tr.Metadata), &meta); err == nil {
				if otlpID, ok := meta["trace.id"].(string); ok && otlpID != "" {
					if _, err := db.DeleteSpansByTraceID(otlpID); err != nil {
						logger.Warn("Failed deleting spans for otlp trace %s: %v", otlpID, err)
					}
					if _, err := db.DeleteSpanAttributesByTraceID(otlpID); err != nil {
						logger.Warn("Failed deleting span_attributes for otlp trace %s: %v", otlpID, err)
					}
				}
			}
		}

		if err := db.DeleteTrace(id); err != nil {
			logger.Error("Failed to delete trace %s: %v", id, err)
			http.Error(w, fmt.Sprintf("Failed to delete trace: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
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

// importSpansJSONLHandler accepts a JSON body with either a path to a JSONL file under data/ or an array of span objects
// Example body: {"path": "data/telegram_agent_traces.jsonl"}
// or {"spans": [{...}, {...}]}
func importSpansJSONLHandler(db Database, logger *Logger) http.HandlerFunc {
	type Req struct {
		Path  string           `json:"path"`
		Spans []map[string]any `json:"spans"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var req Req
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		var spans []Span
		var attrRows []SpanAttribute
		convAgg := make(map[string]*ConversationUpdate)
		if len(req.Spans) > 0 {
			for _, raw := range req.Spans {
				if sp, ar, err := spanFromRaw(raw); err == nil {
					spans = append(spans, sp)
					attrRows = append(attrRows, ar...)
					// derive conversation id from attrs
					if cid := deriveConversationID(ar); cid != "" {
						cu := convAgg[cid]
						if cu == nil {
							convAgg[cid] = &ConversationUpdate{ID: cid, Start: sp.StartTime, End: sp.EndTime, Count: 1}
						} else {
							if sp.StartTime.Before(cu.Start) {
								cu.Start = sp.StartTime
							}
							if sp.EndTime.After(cu.End) {
								cu.End = sp.EndTime
							}
							cu.Count += 1
						}
					}
				} else {
					logger.Warn("skip invalid span: %v", err)
				}
			}
		} else if req.Path != "" {
			// Limit to project working dir
			if !strings.HasPrefix(req.Path, "./") && !strings.HasPrefix(req.Path, "/") {
				req.Path = "./" + req.Path
			}
			// Scan the JSONL file line by line to avoid loading into memory
			file, err := os.Open(req.Path)
			if err != nil {
				http.Error(w, fmt.Sprintf("open file: %v", err), http.StatusBadRequest)
				return
			}
			defer file.Close()
			scanner := bufio.NewScanner(file)
			buf := make([]byte, 0, 1024*1024)
			scanner.Buffer(buf, 10*1024*1024)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "" {
					continue
				}
				raw, err := decodeJSONLineUseNumber(line)
				if err != nil {
					logger.Warn("bad jsonl line: %v", err)
					continue
				}
				sp, ar, err := spanFromRaw(raw)
				if err != nil {
					logger.Warn("skip invalid span: %v", err)
					continue
				}
				spans = append(spans, sp)
				attrRows = append(attrRows, ar...)
				if cid := deriveConversationID(ar); cid != "" {
					cu := convAgg[cid]
					if cu == nil {
						convAgg[cid] = &ConversationUpdate{ID: cid, Start: sp.StartTime, End: sp.EndTime, Count: 1}
					} else {
						if sp.StartTime.Before(cu.Start) {
							cu.Start = sp.StartTime
						}
						if sp.EndTime.After(cu.End) {
							cu.End = sp.EndTime
						}
						cu.Count += 1
					}
				}
			}
			if err := scanner.Err(); err != nil {
				http.Error(w, fmt.Sprintf("scan jsonl: %v", err), http.StatusBadRequest)
				return
			}
		} else {
			http.Error(w, "provide either 'path' or 'spans'", http.StatusBadRequest)
			return
		}

		if err := db.BatchInsertSpans(spans); err != nil {
			logger.Error("batch insert spans: %v", err)
			http.Error(w, fmt.Sprintf("failed to save spans: %v", err), http.StatusInternalServerError)
			return
		}
		if err := db.BatchUpsertSpanAttributes(attrRows); err != nil {
			logger.Error("batch upsert span attributes: %v", err)
			http.Error(w, fmt.Sprintf("failed to save span attributes: %v", err), http.StatusInternalServerError)
			return
		}
		if len(convAgg) > 0 {
			updates := make([]ConversationUpdate, 0, len(convAgg))
			for _, v := range convAgg {
				updates = append(updates, *v)
			}
			if err := db.BatchUpsertConversations(updates); err != nil {
				logger.Error("batch upsert conversations: %v", err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"inserted": len(spans), "attributes": len(attrRows)})
	}
}

// spanFromRaw maps the sample JSON span shape to our Span struct
func spanFromRaw(raw map[string]any) (Span, []SpanAttribute, error) {
	// Required fields
	name, _ := raw["name"].(string)
	traceID, _ := raw["trace_id"].(string)
	spanID, _ := raw["span_id"].(string)
	if name == "" || traceID == "" || spanID == "" {
		return Span{}, nil, fmt.Errorf("missing required fields")
	}
	// times are in UnixNano per sample
	var start, end time.Time
	switch v := raw["start_time"].(type) {
	case float64:
		start = time.Unix(0, int64(v))
	case int64:
		start = time.Unix(0, v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			start = time.Unix(0, n)
		}
	case string:
		// try parse as int64 string
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			start = time.Unix(0, n)
		}
	}
	switch v := raw["end_time"].(type) {
	case float64:
		end = time.Unix(0, int64(v))
	case int64:
		end = time.Unix(0, v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			end = time.Unix(0, n)
		}
	case string:
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			end = time.Unix(0, n)
		}
	}
	if start.IsZero() || end.IsZero() {
		return Span{}, nil, fmt.Errorf("invalid timestamps")
	}
	dur := end.Sub(start).Milliseconds()

	// status
	statusCode := ""
	statusDesc := ""
	if st, ok := raw["status"].(map[string]any); ok {
		if v, ok := st["status_code"].(string); ok {
			statusCode = v
		}
		if v, ok := st["description"].(string); ok {
			statusDesc = v
		}
	}

	// attributes/events
	var attrsStr, eventsStr string
	var attrRows []SpanAttribute
	if attrs, ok := raw["attributes"].(map[string]any); ok {
		// Flatten JSONL attributes then marshal for storage
		flat := FlattenAttrs(attrs)
		if b, err := json.Marshal(flat); err == nil {
			attrsStr = string(b)
		}
		// Build typed attribute rows
		for k, v := range flat {
			at := AttrType(v)
			a := SpanAttribute{SpanID: spanID, TraceID: traceID, Key: k, Type: at}
			switch at {
			case "string":
				s := fmt.Sprintf("%v", v)
				a.StringVal = &s
			case "bool":
				if b, ok := v.(bool); ok {
					a.BoolVal = &b
				} else {
					s := fmt.Sprintf("%v", v)
					a.Type = "string"
					a.StringVal = &s
				}
			case "int":
				switch n := v.(type) {
				case int64:
					a.IntVal = &n
				case int:
					nn := int64(n)
					a.IntVal = &nn
				case float64:
					nn := int64(n)
					a.IntVal = &nn
				default:
					s := fmt.Sprintf("%v", v)
					a.Type = "string"
					a.StringVal = &s
				}
			case "float":
				switch n := v.(type) {
				case float64:
					a.FloatVal = &n
				case float32:
					f := float64(n)
					a.FloatVal = &f
				case int64:
					f := float64(n)
					a.FloatVal = &f
				case int:
					f := float64(n)
					a.FloatVal = &f
				default:
					s := fmt.Sprintf("%v", v)
					a.Type = "string"
					a.StringVal = &s
				}
			case "array", "object", "null":
				b, _ := json.Marshal(v)
				s := string(b)
				a.JSONVal = &s
			default:
				s := fmt.Sprintf("%v", v)
				a.Type = "string"
				a.StringVal = &s
			}
			attrRows = append(attrRows, a)
		}
	}
	if events, ok := raw["events"].([]any); ok {
		if b, err := json.Marshal(events); err == nil {
			eventsStr = string(b)
		}
	}

	sp := Span{
		SpanID:     spanID,
		TraceID:    traceID,
		Name:       name,
		StartTime:  start,
		EndTime:    end,
		DurationMS: dur,
		StatusCode: statusCode,
		StatusDesc: statusDesc,
		Attributes: attrsStr,
		Events:     eventsStr,
	}
	return sp, attrRows, nil
}

// decodeJSONLineUseNumber decodes a JSON line preserving large numbers as json.Number
func decodeJSONLineUseNumber(line string) (map[string]any, error) {
	dec := json.NewDecoder(strings.NewReader(line))
	dec.UseNumber()
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		return nil, err
	}
	return raw, nil
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
		if _, err := db.DeleteSpanAttributesByGroupID(groupID); err != nil {
			logger.Warn("Failed to delete span attributes for group %s: %v", groupID, err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"ok":      true,
			"deleted": deleted,
		})
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
		convs, err := db.GetConversations(limit, before)
		if err != nil {
			logger.Error("Failed to get conversations: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get conversations: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(convs)
	}
}
