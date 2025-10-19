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

type Database interface {
	CreateTrace(trace Trace) (string, error)
	GetTraces() ([]Trace, error)
	GetTraceByID(id string) (*Trace, error)
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
	query := `
		SELECT id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp
		FROM traces
		ORDER BY timestamp DESC
		LIMIT 100
	`
	rows, err := s.db.Query(query)
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
	query := `
		SELECT id, model, input, output, prompt_tokens, output_tokens, duration, metadata, timestamp
		FROM traces
		ORDER BY timestamp DESC
		LIMIT 100
	`
	rows, err := p.db.Query(query)
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

func generateID() string {
	return fmt.Sprintf("trace_%d", time.Now().UnixNano())
}
