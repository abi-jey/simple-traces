package backend

import (
	"database/sql"
	"fmt"
	"time"

	"os"
	"path/filepath"
	"strings"

	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
)

type Trace struct {
	ID           string    `json:"id"`
	Model        string    `json:"model"`
	Input        string    `json:"input"`
	Output       string    `json:"output"`
	PromptTokens int       `json:"prompt_tokens"`
	OutputTokens int       `json:"output_tokens"`
	Duration     int64     `json:"duration"`
	Metadata     string    `json:"metadata,omitempty"`
	Timestamp    time.Time `json:"timestamp"`
}

// Span represents a single OpenTelemetry span (from JSONL samples or OTLP)
type Span struct {
	// Primary keys
	SpanID  string `json:"span_id"`
	TraceID string `json:"trace_id"`

	// Basic info
	Name      string    `json:"name"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	// Duration in milliseconds for convenience
	DurationMS int64  `json:"duration_ms"`
	StatusCode string `json:"status_code"`
	StatusDesc string `json:"status_description,omitempty"`

	// JSON blobs
	Attributes string `json:"attributes,omitempty"` // raw JSON string
	Events     string `json:"events,omitempty"`     // raw JSON string
}

type Database interface {
	CreateTrace(trace Trace) (string, error)
	GetTraces() ([]Trace, error)
	// Paginated access to traces ordered by timestamp DESC. If before is zero, treat as now.
	GetTracesPaginated(limit int, before time.Time) ([]Trace, error)
	GetTraceByID(id string) (*Trace, error)
	DeleteTrace(id string) error

	// Spans operations
	BatchInsertSpans(spans []Span) error
	GetSpans(limit int, before time.Time) ([]Span, error)
	DeleteSpansByTraceID(traceID string) (int64, error)
	Close() error
}

type SQLiteDB struct {
	db *sql.DB
}

type PostgresDB struct {
	db *sql.DB
}

func initDB(config Config) (Database, error) {
	switch config.DBType {
	case "sqlite":
		return initSQLite(config.DBConnection)
	case "postgres", "postgresql":
		return initPostgres(config.DBConnection)
	default:
		return nil, fmt.Errorf("unsupported database type: %s", config.DBType)
	}
}

func initSQLite(dbPath string) (*SQLiteDB, error) {
	// Ensure parent directory exists when using a file path (not :memory: etc.)
	if dbPath != ":memory:" && dbPath != "file::memory:?cache=shared" {
		// For SQLite DSNs like file:foo.db?cache=shared, extract the path part best-effort
		cleaned := dbPath
		if strings.HasPrefix(cleaned, "file:") {
			// strip file: and parameters after '?'
			cleaned = strings.TrimPrefix(cleaned, "file:")
			if idx := strings.Index(cleaned, "?"); idx != -1 {
				cleaned = cleaned[:idx]
			}
		} else {
			// For regular paths, also strip URI parameters if any
			if idx := strings.Index(cleaned, "?"); idx != -1 {
				cleaned = cleaned[:idx]
			}
		}
		dir := filepath.Dir(cleaned)
		if dir != "." && dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create db dir: %w", err)
			}
		}
	}
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS traces (
		id TEXT PRIMARY KEY,
		model TEXT NOT NULL,
		input TEXT NOT NULL,
		output TEXT NOT NULL,
		prompt_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL,
		duration INTEGER NOT NULL,
		metadata TEXT,
		timestamp DATETIME NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_timestamp ON traces(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_model ON traces(model);

	-- Spans table for OTEL/JSONL samples
	CREATE TABLE IF NOT EXISTS spans (
		span_id TEXT NOT NULL,
		trace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		start_time DATETIME NOT NULL,
		end_time DATETIME NOT NULL,
		duration_ms INTEGER NOT NULL,
		status_code TEXT,
		status_description TEXT,
		attributes TEXT,
		events TEXT,
		PRIMARY KEY (span_id),
		UNIQUE (trace_id, span_id)
	);
	CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
	CREATE INDEX IF NOT EXISTS idx_spans_start_time_desc ON spans(start_time DESC, span_id DESC);
	CREATE INDEX IF NOT EXISTS idx_spans_name ON spans(name);
	`

	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}

	return &SQLiteDB{db: db}, nil
}

func initPostgres(connStr string) (*PostgresDB, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}

	if err := db.Ping(); err != nil {
		return nil, err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS traces (
		id TEXT PRIMARY KEY,
		model TEXT NOT NULL,
		input TEXT NOT NULL,
		output TEXT NOT NULL,
		prompt_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL,
		duration BIGINT NOT NULL,
		metadata TEXT,
		timestamp TIMESTAMP NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_timestamp ON traces(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_model ON traces(model);

	CREATE TABLE IF NOT EXISTS spans (
		span_id TEXT PRIMARY KEY,
		trace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		start_time TIMESTAMP NOT NULL,
		end_time TIMESTAMP NOT NULL,
		duration_ms BIGINT NOT NULL,
		status_code TEXT,
		status_description TEXT,
		attributes TEXT,
		events TEXT
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_spans_trace_span ON spans(trace_id, span_id);
	CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
	CREATE INDEX IF NOT EXISTS idx_spans_start_time_desc ON spans(start_time DESC, span_id DESC);
	CREATE INDEX IF NOT EXISTS idx_spans_name ON spans(name);
	`

	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}

	return &PostgresDB{db: db}, nil
}

func (s *SQLiteDB) CreateTrace(trace Trace) (string, error) {
	id := generateID()
	query := `
		INSERT INTO traces (id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := s.db.Exec(query, id, trace.Model, trace.Input, trace.Output,
		trace.PromptTokens, trace.OutputTokens, trace.Duration, trace.Metadata, trace.Timestamp)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (s *SQLiteDB) GetTraces() ([]Trace, error) {
	// Backwards-compatible default of 100 most recent
	return s.GetTracesPaginated(100, time.Time{})
}

func (s *SQLiteDB) GetTracesPaginated(limit int, before time.Time) ([]Trace, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	base := `
		SELECT id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp
		FROM traces
	`
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		q := base + ` ORDER BY timestamp DESC LIMIT ?`
		rows, err = s.db.Query(q, limit)
	} else {
		q := base + ` WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?`
		rows, err = s.db.Query(q, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var traces []Trace
	for rows.Next() {
		var trace Trace
		err := rows.Scan(&trace.ID, &trace.Model, &trace.Input, &trace.Output,
			&trace.PromptTokens, &trace.OutputTokens, &trace.Duration, &trace.Metadata, &trace.Timestamp)
		if err != nil {
			return nil, err
		}
		traces = append(traces, trace)
	}

	return traces, nil
}

func (s *SQLiteDB) GetTraceByID(id string) (*Trace, error) {
	query := `
		SELECT id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp
		FROM traces
		WHERE id = ?
	`
	var trace Trace
	err := s.db.QueryRow(query, id).Scan(&trace.ID, &trace.Model, &trace.Input, &trace.Output,
		&trace.PromptTokens, &trace.OutputTokens, &trace.Duration, &trace.Metadata, &trace.Timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &trace, nil
}

func (s *SQLiteDB) Close() error {
	return s.db.Close()
}

func (s *SQLiteDB) DeleteTrace(id string) error {
	_, err := s.db.Exec(`DELETE FROM traces WHERE id = ?`, id)
	return err
}

// BatchInsertSpans inserts multiple spans efficiently in a single transaction
func (s *SQLiteDB) BatchInsertSpans(spans []Span) error {
	if len(spans) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO spans (
			span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, sp := range spans {
		if _, err := stmt.Exec(sp.SpanID, sp.TraceID, sp.Name, sp.StartTime, sp.EndTime, sp.DurationMS, sp.StatusCode, sp.StatusDesc, sp.Attributes, sp.Events); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteDB) GetSpans(limit int, before time.Time) ([]Span, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		rows, err = s.db.Query(`
			SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
			FROM spans
			ORDER BY start_time DESC, span_id DESC
			LIMIT ?
		`, limit)
	} else {
		rows, err = s.db.Query(`
			SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
			FROM spans
			WHERE start_time < ?
			ORDER BY start_time DESC, span_id DESC
			LIMIT ?
		`, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Span, 0, limit)
	for rows.Next() {
		var sp Span
		if err := rows.Scan(&sp.SpanID, &sp.TraceID, &sp.Name, &sp.StartTime, &sp.EndTime, &sp.DurationMS, &sp.StatusCode, &sp.StatusDesc, &sp.Attributes, &sp.Events); err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, nil
}

func (s *SQLiteDB) DeleteSpansByTraceID(traceID string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM spans WHERE trace_id = ?`, traceID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (p *PostgresDB) CreateTrace(trace Trace) (string, error) {
	id := generateID()
	query := `
		INSERT INTO traces (id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	_, err := p.db.Exec(query, id, trace.Model, trace.Input, trace.Output,
		trace.PromptTokens, trace.OutputTokens, trace.Duration, trace.Metadata, trace.Timestamp)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (p *PostgresDB) GetTraces() ([]Trace, error) {
	return p.GetTracesPaginated(100, time.Time{})
}

func (p *PostgresDB) GetTracesPaginated(limit int, before time.Time) ([]Trace, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	base := `
		SELECT id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp
		FROM traces
	`
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		q := base + ` ORDER BY timestamp DESC LIMIT $1`
		rows, err = p.db.Query(q, limit)
	} else {
		q := base + ` WHERE timestamp < $1 ORDER BY timestamp DESC LIMIT $2`
		rows, err = p.db.Query(q, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var traces []Trace
	for rows.Next() {
		var trace Trace
		err := rows.Scan(&trace.ID, &trace.Model, &trace.Input, &trace.Output,
			&trace.PromptTokens, &trace.OutputTokens, &trace.Duration, &trace.Metadata, &trace.Timestamp)
		if err != nil {
			return nil, err
		}
		traces = append(traces, trace)
	}

	return traces, nil
}

func (p *PostgresDB) GetTraceByID(id string) (*Trace, error) {
	query := `
		SELECT id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp
		FROM traces
		WHERE id = $1
	`
	var trace Trace
	err := p.db.QueryRow(query, id).Scan(&trace.ID, &trace.Model, &trace.Input, &trace.Output,
		&trace.PromptTokens, &trace.OutputTokens, &trace.Duration, &trace.Metadata, &trace.Timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &trace, nil
}

func (p *PostgresDB) Close() error {
	return p.db.Close()
}

func (p *PostgresDB) DeleteTrace(id string) error {
	_, err := p.db.Exec(`DELETE FROM traces WHERE id = $1`, id)
	return err
}

func (p *PostgresDB) BatchInsertSpans(spans []Span) error {
	if len(spans) == 0 {
		return nil
	}
	tx, err := p.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT INTO spans (
			span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (span_id) DO UPDATE SET
			trace_id = EXCLUDED.trace_id,
			name = EXCLUDED.name,
			start_time = EXCLUDED.start_time,
			end_time = EXCLUDED.end_time,
			duration_ms = EXCLUDED.duration_ms,
			status_code = EXCLUDED.status_code,
			status_description = EXCLUDED.status_description,
			attributes = EXCLUDED.attributes,
			events = EXCLUDED.events
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, sp := range spans {
		if _, err := stmt.Exec(sp.SpanID, sp.TraceID, sp.Name, sp.StartTime, sp.EndTime, sp.DurationMS, sp.StatusCode, sp.StatusDesc, sp.Attributes, sp.Events); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (p *PostgresDB) GetSpans(limit int, before time.Time) ([]Span, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		rows, err = p.db.Query(`
			SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
			FROM spans
			ORDER BY start_time DESC, span_id DESC
			LIMIT $1
		`, limit)
	} else {
		rows, err = p.db.Query(`
			SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
			FROM spans
			WHERE start_time < $1
			ORDER BY start_time DESC, span_id DESC
			LIMIT $2
		`, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Span, 0, limit)
	for rows.Next() {
		var sp Span
		if err := rows.Scan(&sp.SpanID, &sp.TraceID, &sp.Name, &sp.StartTime, &sp.EndTime, &sp.DurationMS, &sp.StatusCode, &sp.StatusDesc, &sp.Attributes, &sp.Events); err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, nil
}

func (p *PostgresDB) DeleteSpansByTraceID(traceID string) (int64, error) {
	res, err := p.db.Exec(`DELETE FROM spans WHERE trace_id = $1`, traceID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func generateID() string {
	return fmt.Sprintf("trace_%d", time.Now().UnixNano())
}
