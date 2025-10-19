package backend

import (
	"io"
	"log"
	"os"
	"strings"
)

// LogLevel represents the logging level
type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
)

// Logger provides structured logging with different levels
type Logger struct {
	debugLogger *log.Logger
	infoLogger  *log.Logger
	warnLogger  *log.Logger
	errorLogger *log.Logger
	level       LogLevel
}

var globalLogger *Logger

// InitLogger initializes the global logger with the specified log level
func InitLogger(levelStr string) *Logger {
	level := parseLogLevel(levelStr)

	var debugOut, infoOut, warnOut, errorOut io.Writer

	// Configure output based on log level
	switch level {
	case DEBUG:
		debugOut = os.Stdout
		infoOut = os.Stdout
		warnOut = os.Stdout
		errorOut = os.Stderr
	case INFO:
		debugOut = io.Discard
		infoOut = os.Stdout
		warnOut = os.Stdout
		errorOut = os.Stderr
	case WARN:
		debugOut = io.Discard
		infoOut = io.Discard
		warnOut = os.Stdout
		errorOut = os.Stderr
	case ERROR:
		debugOut = io.Discard
		infoOut = io.Discard
		warnOut = io.Discard
		errorOut = os.Stderr
	}

	globalLogger = &Logger{
		debugLogger: log.New(debugOut, "[DEBUG] ", log.LstdFlags|log.Lshortfile),
		infoLogger:  log.New(infoOut, "[INFO]  ", log.LstdFlags),
		warnLogger:  log.New(warnOut, "[WARN]  ", log.LstdFlags),
		errorLogger: log.New(errorOut, "[ERROR] ", log.LstdFlags|log.Lshortfile),
		level:       level,
	}

	return globalLogger
}

// GetLogger returns the global logger instance
func GetLogger() *Logger {
	if globalLogger == nil {
		return InitLogger("INFO")
	}
	return globalLogger
}

// Debug logs a debug message with verbose details
func (l *Logger) Debug(format string, v ...interface{}) {
	if l.level <= DEBUG {
		l.debugLogger.Printf(format, v...)
	}
}

// Info logs an informational message
func (l *Logger) Info(format string, v ...interface{}) {
	if l.level <= INFO {
		l.infoLogger.Printf(format, v...)
	}
}

// Warn logs a warning message
func (l *Logger) Warn(format string, v ...interface{}) {
	if l.level <= WARN {
		l.warnLogger.Printf(format, v...)
	}
}

// Error logs an error message
func (l *Logger) Error(format string, v ...interface{}) {
	if l.level <= ERROR {
		l.errorLogger.Printf(format, v...)
	}
}

// Fatal logs a fatal error message and exits
func (l *Logger) Fatal(format string, v ...interface{}) {
	l.errorLogger.Fatalf(format, v...)
}

func parseLogLevel(levelStr string) LogLevel {
	switch strings.ToUpper(levelStr) {
	case "DEBUG":
		return DEBUG
	case "INFO":
		return INFO
	case "WARN", "WARNING":
		return WARN
	case "ERROR":
		return ERROR
	default:
		return INFO
	}
}
