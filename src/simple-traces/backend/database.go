package backend

import (
	"database/sql"
	"fmt"
	"time"

	"encoding/json"
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

type TraceGroup struct {
	TraceID        string    `json:"trace_id"`
	FirstStartTime time.Time `json:"first_start_time"`
	LastEndTime    time.Time `json:"last_end_time"`
	SpanCount      int       `json:"span_count"`
	Model          string    `json:"model,omitempty"`
}

// Conversation represents a top-level conversation/thread
type Conversation struct {
	ID             string    `json:"id"`
	FirstStartTime time.Time `json:"first_start_time"`
	LastEndTime    time.Time `json:"last_end_time"`
	SpanCount      int       `json:"span_count"`
	Model          string    `json:"model,omitempty"`
}

// ConversationUpdate is used to upsert conversation aggregates
type ConversationUpdate struct {
	ID    string
	Start time.Time
	End   time.Time
	Count int
	Model string
}

// SpanAttribute stores a flattened, typed attribute for a span
type SpanAttribute struct {
	SpanID    string
	TraceID   string
	Key       string
	Type      string // string|int|float|bool|array|object|null
	StringVal *string
	IntVal    *int64
	FloatVal  *float64
	BoolVal   *bool
	JSONVal   *string // for array/object or fallback
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
	DeleteSpansByGroupID(groupID string) (int64, error)

	// Typed, flattened attributes
	BatchUpsertSpanAttributes(attrs []SpanAttribute) error
	DeleteSpanAttributesByTraceID(traceID string) (int64, error)
	DeleteSpanAttributesByGroupID(groupID string) (int64, error)

	// Grouped traces (by OTLP trace_id)
	GetTraceGroups(limit int, before time.Time) ([]TraceGroup, error)
	GetTraceGroupSpans(traceID string, limit int) ([]Span, error)
	// Search variants
	GetTraceGroupsWithSearch(limit int, before time.Time, search string) ([]TraceGroup, error)
	GetTraceGroupSpansWithSearch(traceID string, limit int, search string) ([]Span, error)

	// Conversations API
	BatchUpsertConversations(updates []ConversationUpdate) error
	GetConversations(limit int, before time.Time) ([]Conversation, error)
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

// Preferred keys for conversation/session grouping
var conversationIDKeys = []string{
	"gen_ai.conversation.id",
	"conversation.id",
	"conversation_id",
	"session.conversation_id",
	"session.id",
	"chat.id",
	"thread.id",
}

// Build SQLite SQL expression to compute group_id from span_attributes, fallback to spans.trace_id.
func sqliteGroupIDExpr() string {
	// Inlines constants (safe: controlled list)
	keysList := "('" + strings.Join(conversationIDKeys, "','") + "')"
	// Priority order via CASE, 1..n
	var b strings.Builder
	b.WriteString("COALESCE(")
	// prefer string_val
	b.WriteString("(SELECT string_val FROM span_attributes sa1 WHERE sa1.span_id = s.span_id AND sa1.key IN ")
	b.WriteString(keysList)
	b.WriteString(" ORDER BY CASE sa1.key ")
	for i, k := range conversationIDKeys {
		fmt.Fprintf(&b, "WHEN '%s' THEN %d ", k, i+1)
	}
	b.WriteString("END LIMIT 1),")
	// then int_val
	b.WriteString("(SELECT CAST(int_val AS TEXT) FROM span_attributes sa2 WHERE sa2.span_id = s.span_id AND sa2.key IN ")
	b.WriteString(keysList)
	b.WriteString(" ORDER BY CASE sa2.key ")
	for i, k := range conversationIDKeys {
		fmt.Fprintf(&b, "WHEN '%s' THEN %d ", k, i+1)
	}
	b.WriteString("END LIMIT 1),")
	// then float_val
	b.WriteString("(SELECT CAST(float_val AS TEXT) FROM span_attributes sa3 WHERE sa3.span_id = s.span_id AND sa3.key IN ")
	b.WriteString(keysList)
	b.WriteString(" ORDER BY CASE sa3.key ")
	for i, k := range conversationIDKeys {
		fmt.Fprintf(&b, "WHEN '%s' THEN %d ", k, i+1)
	}
	b.WriteString("END LIMIT 1),")
	// fallback
	b.WriteString("s.trace_id)")
	return b.String()
}

// Build Postgres SQL expression for group_id
func pgGroupIDExpr() string {
	keysList := "('" + strings.Join(conversationIDKeys, "','") + "')"
	var b strings.Builder
	b.WriteString("COALESCE(")
	b.WriteString("(SELECT string_val FROM span_attributes sa1 WHERE sa1.span_id = s.span_id AND sa1.key IN ")
	b.WriteString(keysList)
	b.WriteString(" ORDER BY CASE ")
	for i, k := range conversationIDKeys {
		fmt.Fprintf(&b, "WHEN sa1.key = '%s' THEN %d ", k, i+1)
	}
	b.WriteString("END LIMIT 1),")
	b.WriteString("(SELECT (int_val)::text FROM span_attributes sa2 WHERE sa2.span_id = s.span_id AND sa2.key IN ")
	b.WriteString(keysList)
	b.WriteString(" ORDER BY CASE ")
	for i, k := range conversationIDKeys {
		fmt.Fprintf(&b, "WHEN sa2.key = '%s' THEN %d ", k, i+1)
	}
	b.WriteString("END LIMIT 1),")
	b.WriteString("(SELECT (float_val)::text FROM span_attributes sa3 WHERE sa3.span_id = s.span_id AND sa3.key IN ")
	b.WriteString(keysList)
	b.WriteString(" ORDER BY CASE ")
	for i, k := range conversationIDKeys {
		fmt.Fprintf(&b, "WHEN sa3.key = '%s' THEN %d ", k, i+1)
	}
	b.WriteString("END LIMIT 1),")
	b.WriteString("s.trace_id)")
	return b.String()
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

	-- Flattened attribute storage for efficient querying
	CREATE TABLE IF NOT EXISTS span_attributes (
		span_id TEXT NOT NULL,
		trace_id TEXT NOT NULL,
		key TEXT NOT NULL,
		type TEXT NOT NULL,
		string_val TEXT,
		int_val INTEGER,
		float_val REAL,
		bool_val INTEGER,
		json_val TEXT,
		PRIMARY KEY (span_id, key)
	);
	CREATE INDEX IF NOT EXISTS idx_span_attrs_trace_id ON span_attributes(trace_id);
	CREATE INDEX IF NOT EXISTS idx_span_attrs_key ON span_attributes(key);

	-- Conversations table aggregates
	CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		first_start_time DATETIME NOT NULL,
		last_end_time DATETIME NOT NULL,
		span_count INTEGER NOT NULL,
		model TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_conversations_last_end_desc ON conversations(last_end_time DESC);
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

	CREATE TABLE IF NOT EXISTS span_attributes (
		span_id TEXT NOT NULL,
		trace_id TEXT NOT NULL,
		key TEXT NOT NULL,
		type TEXT NOT NULL,
		string_val TEXT,
		int_val BIGINT,
		float_val DOUBLE PRECISION,
		bool_val BOOLEAN,
		json_val TEXT,
		PRIMARY KEY (span_id, key)
	);
	CREATE INDEX IF NOT EXISTS idx_span_attrs_trace_id ON span_attributes(trace_id);
	CREATE INDEX IF NOT EXISTS idx_span_attrs_key ON span_attributes(key);

	CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		first_start_time TIMESTAMP NOT NULL,
		last_end_time TIMESTAMP NOT NULL,
		span_count BIGINT NOT NULL,
		model TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_conversations_last_end_desc ON conversations(last_end_time DESC);
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

func (s *SQLiteDB) DeleteSpansByGroupID(groupID string) (int64, error) {
	gid := sqliteGroupIDExpr()
	q := `DELETE FROM spans WHERE ` + gid + ` = ?`
	res, err := s.db.Exec(q, groupID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *SQLiteDB) DeleteSpanAttributesByTraceID(traceID string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM span_attributes WHERE trace_id = ?`, traceID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *SQLiteDB) DeleteSpanAttributesByGroupID(groupID string) (int64, error) {
	gid := sqliteGroupIDExpr()
	q := `DELETE FROM span_attributes WHERE span_id IN (SELECT span_id FROM spans s WHERE ` + gid + ` = ?)`
	res, err := s.db.Exec(q, groupID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// BatchUpsertConversations aggregates and upserts conversations
func (s *SQLiteDB) BatchUpsertConversations(updates []ConversationUpdate) error {
	if len(updates) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO conversations (
			id, first_start_time, last_end_time, span_count, model
		) VALUES (
			?,
			COALESCE((SELECT first_start_time FROM conversations WHERE id = ?), ?),
			?,
			COALESCE((SELECT span_count FROM conversations WHERE id = ?), 0) + ?,
			COALESCE(?, (SELECT model FROM conversations WHERE id = ?))
		)
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, u := range updates {
		_, err := stmt.Exec(u.ID, u.ID, u.Start, u.End, u.ID, u.Count, nullableString(u.Model), u.ID)
		if err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteDB) GetConversations(limit int, before time.Time) ([]Conversation, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		rows, err = s.db.Query(`
			SELECT id, first_start_time, last_end_time, span_count, COALESCE(model, '')
			FROM conversations
			ORDER BY last_end_time DESC
			LIMIT ?
		`, limit)
	} else {
		rows, err = s.db.Query(`
			SELECT id, first_start_time, last_end_time, span_count, COALESCE(model, '')
			FROM conversations
			WHERE last_end_time < ?
			ORDER BY last_end_time DESC
			LIMIT ?
		`, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Conversation, 0, limit)
	for rows.Next() {
		var c Conversation
		if err := rows.Scan(&c.ID, &c.FirstStartTime, &c.LastEndTime, &c.SpanCount, &c.Model); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (s *SQLiteDB) GetTraceGroups(limit int, before time.Time) ([]TraceGroup, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	gid := sqliteGroupIDExpr()
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		q := `
			SELECT ` + gid + ` AS group_id, MIN(start_time) AS first_start, MAX(end_time) AS last_end, COUNT(*) AS span_count
			FROM spans s
			GROUP BY group_id
			ORDER BY last_end DESC
			LIMIT ?
		`
		rows, err = s.db.Query(q, limit)
	} else {
		q := `
			SELECT ` + gid + ` AS group_id, MIN(start_time) AS first_start, MAX(end_time) AS last_end, COUNT(*) AS span_count
			FROM spans s
			GROUP BY group_id
			HAVING MAX(end_time) < ?
			ORDER BY last_end DESC
			LIMIT ?
		`
		rows, err = s.db.Query(q, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := make([]TraceGroup, 0, limit)
	for rows.Next() {
		var (
			groupID  string
			firstStr string
			lastStr  string
			count    int
		)
		if err := rows.Scan(&groupID, &firstStr, &lastStr, &count); err != nil {
			return nil, err
		}
		var firstT, lastT time.Time
		if t, err := parseSQLiteTime(firstStr); err == nil {
			firstT = t
		}
		if t, err := parseSQLiteTime(lastStr); err == nil {
			lastT = t
		}
		groups = append(groups, TraceGroup{
			TraceID:        groupID,
			FirstStartTime: firstT,
			LastEndTime:    lastT,
			SpanCount:      count,
		})
	}

	// Best-effort model extraction by inspecting latest span per group
	for i := range groups {
		// Pick latest span for this group_id and extract model
		var attrJSON string
		q := `SELECT attributes FROM spans s WHERE ` + gid + ` = ? ORDER BY start_time DESC LIMIT 1`
		err := s.db.QueryRow(q, groups[i].TraceID).Scan(&attrJSON)
		if err == nil && attrJSON != "" {
			if model := extractModelFromAttrJSON(attrJSON); model != "" {
				groups[i].Model = model
			}
		}
	}
	return groups, nil
}

// GetTraceGroupsWithSearch searches across span fields and groups by trace_id
func (s *SQLiteDB) GetTraceGroupsWithSearch(limit int, before time.Time, search string) ([]TraceGroup, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	pattern := "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
	gid := sqliteGroupIDExpr()
	var rows *sql.Rows
	var err error
	base := `
		SELECT ` + gid + ` AS group_id, MIN(start_time) AS first_start, MAX(end_time) AS last_end, COUNT(*) AS span_count
		FROM spans s
		WHERE (
			lower(name) LIKE ? OR lower(span_id) LIKE ? OR lower(trace_id) LIKE ? OR
			lower(coalesce(status_code, '')) LIKE ? OR lower(coalesce(status_description, '')) LIKE ? OR
			lower(coalesce(attributes, '')) LIKE ? OR lower(coalesce(events, '')) LIKE ?
		)
	`
	if before.IsZero() {
		q := base + ` GROUP BY group_id ORDER BY last_end DESC LIMIT ?`
		rows, err = s.db.Query(q, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit)
	} else {
		q := base + ` GROUP BY group_id HAVING MAX(end_time) < ? ORDER BY last_end DESC LIMIT ?`
		rows, err = s.db.Query(q, pattern, pattern, pattern, pattern, pattern, pattern, pattern, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make([]TraceGroup, 0, limit)
	for rows.Next() {
		var (
			groupID  string
			firstStr string
			lastStr  string
			count    int
		)
		if err := rows.Scan(&groupID, &firstStr, &lastStr, &count); err != nil {
			return nil, err
		}
		var firstT, lastT time.Time
		if t, err := parseSQLiteTime(firstStr); err == nil {
			firstT = t
		}
		if t, err := parseSQLiteTime(lastStr); err == nil {
			lastT = t
		}
		groups = append(groups, TraceGroup{TraceID: groupID, FirstStartTime: firstT, LastEndTime: lastT, SpanCount: count})
	}
	// Extract model as before
	for i := range groups {
		var attrJSON string
		q := `SELECT attributes FROM spans s WHERE ` + gid + ` = ? ORDER BY start_time DESC LIMIT 1`
		err := s.db.QueryRow(q, groups[i].TraceID).Scan(&attrJSON)
		if err == nil && attrJSON != "" {
			if model := extractModelFromAttrJSON(attrJSON); model != "" {
				groups[i].Model = model
			}
		}
	}
	return groups, nil
}

func (s *SQLiteDB) GetTraceGroupSpansWithSearch(traceID string, limit int, search string) ([]Span, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	pattern := "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
	gid := sqliteGroupIDExpr()
	q := `
			SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
			FROM spans s
			WHERE ` + gid + ` = ? AND (
			lower(name) LIKE ? OR lower(span_id) LIKE ? OR lower(coalesce(status_code, '')) LIKE ? OR
			lower(coalesce(status_description, '')) LIKE ? OR lower(coalesce(attributes, '')) LIKE ? OR lower(coalesce(events, '')) LIKE ?
			)
			ORDER BY start_time ASC, span_id ASC
			LIMIT ?
		`
	rows, err := s.db.Query(q, traceID, pattern, pattern, pattern, pattern, pattern, pattern, limit)
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

// parseSQLiteTime attempts to parse common SQLite datetime string formats into time.Time
func parseSQLiteTime(s string) (time.Time, error) { // fmt: skip
	if s == "" {
		return time.Time{}, fmt.Errorf("empty time string")
	}
	// Try common layouts
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05", // default go-sqlite3 format often
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999",
	}
	var lastErr error
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		} else {
			lastErr = err
		}
	}
	return time.Time{}, lastErr
}

func (s *SQLiteDB) GetTraceGroupSpans(traceID string, limit int) ([]Span, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	gid := sqliteGroupIDExpr()
	q := `
		SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
		FROM spans s
		WHERE ` + gid + ` = ?
		ORDER BY start_time ASC, span_id ASC
		LIMIT ?
	`
	rows, err := s.db.Query(q, traceID, limit)
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

func (p *PostgresDB) DeleteSpansByGroupID(groupID string) (int64, error) {
	gid := pgGroupIDExpr()
	q := `DELETE FROM spans WHERE ` + gid + ` = $1`
	res, err := p.db.Exec(q, groupID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (p *PostgresDB) DeleteSpanAttributesByTraceID(traceID string) (int64, error) {
	res, err := p.db.Exec(`DELETE FROM span_attributes WHERE trace_id = $1`, traceID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (p *PostgresDB) DeleteSpanAttributesByGroupID(groupID string) (int64, error) {
	gid := pgGroupIDExpr()
	q := `DELETE FROM span_attributes WHERE span_id IN (SELECT span_id FROM spans s WHERE ` + gid + ` = $1)`
	res, err := p.db.Exec(q, groupID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (p *PostgresDB) BatchUpsertConversations(updates []ConversationUpdate) error {
	if len(updates) == 0 {
		return nil
	}
	tx, err := p.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT INTO conversations (
			id, first_start_time, last_end_time, span_count, model
		) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			first_start_time = LEAST(conversations.first_start_time, EXCLUDED.first_start_time),
			last_end_time = GREATEST(conversations.last_end_time, EXCLUDED.last_end_time),
			span_count = conversations.span_count + EXCLUDED.span_count,
			model = COALESCE(EXCLUDED.model, conversations.model)
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, u := range updates {
		var modelPtr *string
		if strings.TrimSpace(u.Model) != "" {
			m := u.Model
			modelPtr = &m
		}
		_, err := stmt.Exec(u.ID, u.Start, u.End, u.Count, modelPtr)
		if err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (p *PostgresDB) GetConversations(limit int, before time.Time) ([]Conversation, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		rows, err = p.db.Query(`
			SELECT id, first_start_time, last_end_time, span_count, COALESCE(model, '')
			FROM conversations
			ORDER BY last_end_time DESC
			LIMIT $1
		`, limit)
	} else {
		rows, err = p.db.Query(`
			SELECT id, first_start_time, last_end_time, span_count, COALESCE(model, '')
			FROM conversations
			WHERE last_end_time < $1
			ORDER BY last_end_time DESC
			LIMIT $2
		`, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Conversation, 0, limit)
	for rows.Next() {
		var c Conversation
		if err := rows.Scan(&c.ID, &c.FirstStartTime, &c.LastEndTime, &c.SpanCount, &c.Model); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// helper to turn empty string into NULL for model in SQLite upsert
func nullableString(s string) *string {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	return &t
}

// BatchUpsertSpanAttributes stores flattened attributes with proper types
func (s *SQLiteDB) BatchUpsertSpanAttributes(attrs []SpanAttribute) error {
	if len(attrs) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO span_attributes (
			span_id, trace_id, key, type, string_val, int_val, float_val, bool_val, json_val
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, a := range attrs {
		var bInt *int
		if a.BoolVal != nil {
			if *a.BoolVal {
				one := 1
				bInt = &one
			} else {
				zero := 0
				bInt = &zero
			}
		}
		_, err := stmt.Exec(
			a.SpanID, a.TraceID, a.Key, a.Type,
			a.StringVal, a.IntVal, a.FloatVal, bInt, a.JSONVal,
		)
		if err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (p *PostgresDB) BatchUpsertSpanAttributes(attrs []SpanAttribute) error {
	if len(attrs) == 0 {
		return nil
	}
	tx, err := p.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT INTO span_attributes (
			span_id, trace_id, key, type, string_val, int_val, float_val, bool_val, json_val
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (span_id, key) DO UPDATE SET
			trace_id = EXCLUDED.trace_id,
			type = EXCLUDED.type,
			string_val = EXCLUDED.string_val,
			int_val = EXCLUDED.int_val,
			float_val = EXCLUDED.float_val,
			bool_val = EXCLUDED.bool_val,
			json_val = EXCLUDED.json_val
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, a := range attrs {
		_, err := stmt.Exec(
			a.SpanID, a.TraceID, a.Key, a.Type,
			a.StringVal, a.IntVal, a.FloatVal, a.BoolVal, a.JSONVal,
		)
		if err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (p *PostgresDB) GetTraceGroups(limit int, before time.Time) ([]TraceGroup, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	gid := pgGroupIDExpr()
	var rows *sql.Rows
	var err error
	if before.IsZero() {
		q := `
			SELECT ` + gid + ` AS group_id, MIN(start_time) AS first_start, MAX(end_time) AS last_end, COUNT(*) AS span_count
			FROM spans s
			GROUP BY group_id
			ORDER BY last_end DESC
			LIMIT $1
		`
		rows, err = p.db.Query(q, limit)
	} else {
		q := `
			SELECT ` + gid + ` AS group_id, MIN(start_time) AS first_start, MAX(end_time) AS last_end, COUNT(*) AS span_count
			FROM spans s
			GROUP BY group_id
			HAVING MAX(end_time) < $1
			ORDER BY last_end DESC
			LIMIT $2
		`
		rows, err = p.db.Query(q, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make([]TraceGroup, 0, limit)
	for rows.Next() {
		var g TraceGroup
		if err := rows.Scan(&g.TraceID, &g.FirstStartTime, &g.LastEndTime, &g.SpanCount); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	// Best-effort model extraction from latest span
	for i := range groups {
		var attrJSON string
		q := `SELECT attributes FROM spans s WHERE ` + gid + ` = $1 ORDER BY start_time DESC LIMIT 1`
		err := p.db.QueryRow(q, groups[i].TraceID).Scan(&attrJSON)
		if err == nil && attrJSON != "" {
			if model := extractModelFromAttrJSON(attrJSON); model != "" {
				groups[i].Model = model
			}
		}
	}
	return groups, nil
}
func (p *PostgresDB) GetTraceGroupsWithSearch(limit int, before time.Time, search string) ([]TraceGroup, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	pattern := "%" + strings.TrimSpace(search) + "%"
	var rows *sql.Rows
	var err error
	gid := pgGroupIDExpr()
	base := `
		SELECT ` + gid + ` AS group_id, MIN(start_time) AS first_start, MAX(end_time) AS last_end, COUNT(*) AS span_count
		FROM spans s
		WHERE (
			name ILIKE $1 OR span_id ILIKE $1 OR trace_id ILIKE $1 OR
			coalesce(status_code, '') ILIKE $1 OR coalesce(status_description, '') ILIKE $1 OR
			coalesce(attributes, '') ILIKE $1 OR coalesce(events, '') ILIKE $1
		)
	`
	if before.IsZero() {
		q := base + ` GROUP BY group_id ORDER BY last_end DESC LIMIT $2`
		rows, err = p.db.Query(q, pattern, limit)
	} else {
		q := base + ` GROUP BY group_id HAVING MAX(end_time) < $2 ORDER BY last_end DESC LIMIT $3`
		rows, err = p.db.Query(q, pattern, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make([]TraceGroup, 0, limit)
	for rows.Next() {
		var g TraceGroup
		if err := rows.Scan(&g.TraceID, &g.FirstStartTime, &g.LastEndTime, &g.SpanCount); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	for i := range groups {
		var attrJSON string
		q := `SELECT attributes FROM spans s WHERE ` + gid + ` = $1 ORDER BY start_time DESC LIMIT 1`
		err := p.db.QueryRow(q, groups[i].TraceID).Scan(&attrJSON)
		if err == nil && attrJSON != "" {
			if model := extractModelFromAttrJSON(attrJSON); model != "" {
				groups[i].Model = model
			}
		}
	}
	return groups, nil
}

func (p *PostgresDB) GetTraceGroupSpansWithSearch(traceID string, limit int, search string) ([]Span, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	pattern := "%" + strings.TrimSpace(search) + "%"
	gid := pgGroupIDExpr()
	q := `
			SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
			FROM spans s
			WHERE ` + gid + ` = $1 AND (
			name ILIKE $2 OR span_id ILIKE $2 OR coalesce(status_code, '') ILIKE $2 OR
			coalesce(status_description, '') ILIKE $2 OR coalesce(attributes, '') ILIKE $2 OR coalesce(events, '') ILIKE $2
			)
			ORDER BY start_time ASC, span_id ASC
			LIMIT $3
		`
	rows, err := p.db.Query(q, traceID, pattern, limit)
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

func (p *PostgresDB) GetTraceGroupSpans(traceID string, limit int) ([]Span, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	gid := pgGroupIDExpr()
	q := `
		SELECT span_id, trace_id, name, start_time, end_time, duration_ms, status_code, status_description, attributes, events
		FROM spans s
		WHERE ` + gid + ` = $1
		ORDER BY start_time ASC, span_id ASC
		LIMIT $2
	`
	rows, err := p.db.Query(q, traceID, limit)
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

// extractModelFromAttrJSON tries to find a model key in spans.attributes JSON
func extractModelFromAttrJSON(attrJSON string) string {
	// Parse small JSON into map and probe known model keys
	type anyMap = map[string]interface{}
	var m anyMap
	if err := json.Unmarshal([]byte(attrJSON), &m); err != nil {
		return ""
	}
	keys := []string{
		"llm.model", "gen_ai.request.model", "resource.service.name", "agent.model",
	}
	for _, k := range keys {
		if v, ok := m[k]; ok {
			return fmt.Sprintf("%v", v)
		}
	}
	return ""
}

func generateID() string {
	return fmt.Sprintf("trace_%d", time.Now().UnixNano())
}
