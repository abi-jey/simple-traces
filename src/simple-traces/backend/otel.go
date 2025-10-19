package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// CustomSpanProcessor implements sdktrace.SpanProcessor to capture and store spans
type CustomSpanProcessor struct {
	db     Database
	logger *Logger
}

// NewCustomSpanProcessor creates a new custom span processor
func NewCustomSpanProcessor(db Database, logger *Logger) *CustomSpanProcessor {
	return &CustomSpanProcessor{
		db:     db,
		logger: logger,
	}
}

// OnStart is called when a span starts
func (p *CustomSpanProcessor) OnStart(parent context.Context, s sdktrace.ReadWriteSpan) {
	p.logger.Debug("Span started: %s (TraceID: %s, SpanID: %s)",
		s.Name(), s.SpanContext().TraceID().String(), s.SpanContext().SpanID().String())
}

// OnEnd is called when a span ends
func (p *CustomSpanProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	// Convert OpenTelemetry span to our trace format
	spanCtx := s.SpanContext()
	
	p.logger.Debug("Span ended: %s (TraceID: %s, SpanID: %s, Duration: %v)",
		s.Name(), spanCtx.TraceID().String(), spanCtx.SpanID().String(), s.EndTime().Sub(s.StartTime()))
	
	// Extract attributes
	attrs := make(map[string]interface{})
	for _, attr := range s.Attributes() {
		attrs[string(attr.Key)] = attrValueToInterface(attr.Value)
	}
	
	// Extract model information from attributes (if available)
	model := "unknown"
	input := ""
	output := ""
	promptTokens := 0
	outputTokens := 0
	
	// Check for common LLM-related attributes
	if modelAttr, ok := attrs["llm.model"]; ok {
		model = fmt.Sprintf("%v", modelAttr)
	} else if modelAttr, ok := attrs["gen_ai.request.model"]; ok {
		model = fmt.Sprintf("%v", modelAttr)
	}
	
	if inputAttr, ok := attrs["llm.input"]; ok {
		input = fmt.Sprintf("%v", inputAttr)
	} else if inputAttr, ok := attrs["gen_ai.prompt"]; ok {
		input = fmt.Sprintf("%v", inputAttr)
	}
	
	if outputAttr, ok := attrs["llm.output"]; ok {
		output = fmt.Sprintf("%v", outputAttr)
	} else if outputAttr, ok := attrs["gen_ai.response"]; ok {
		output = fmt.Sprintf("%v", outputAttr)
	}
	
	if promptTokensAttr, ok := attrs["llm.usage.prompt_tokens"]; ok {
		if val, ok := promptTokensAttr.(int64); ok {
			promptTokens = int(val)
		}
	} else if promptTokensAttr, ok := attrs["gen_ai.usage.input_tokens"]; ok {
		if val, ok := promptTokensAttr.(int64); ok {
			promptTokens = int(val)
		}
	}
	
	if outputTokensAttr, ok := attrs["llm.usage.completion_tokens"]; ok {
		if val, ok := outputTokensAttr.(int64); ok {
			outputTokens = int(val)
		}
	} else if outputTokensAttr, ok := attrs["gen_ai.usage.output_tokens"]; ok {
		if val, ok := outputTokensAttr.(int64); ok {
			outputTokens = int(val)
		}
	}
	
	// Calculate duration in milliseconds
	duration := s.EndTime().Sub(s.StartTime()).Milliseconds()
	
	// Add span name and status to metadata
	attrs["span.name"] = s.Name()
	attrs["span.kind"] = s.SpanKind().String()
	attrs["trace.id"] = spanCtx.TraceID().String()
	attrs["span.id"] = spanCtx.SpanID().String()
	
	if s.Status().Code != codes.Unset {
		attrs["span.status.code"] = s.Status().Code.String()
		if s.Status().Description != "" {
			attrs["span.status.description"] = s.Status().Description
		}
	}
	
	// Add events to metadata if any
	if len(s.Events()) > 0 {
		events := make([]map[string]interface{}, 0, len(s.Events()))
		for _, event := range s.Events() {
			eventData := map[string]interface{}{
				"name":      event.Name,
				"timestamp": event.Time.Format(time.RFC3339Nano),
			}
			if len(event.Attributes) > 0 {
				eventAttrs := make(map[string]interface{})
				for _, attr := range event.Attributes {
					eventAttrs[string(attr.Key)] = attrValueToInterface(attr.Value)
				}
				eventData["attributes"] = eventAttrs
			}
			events = append(events, eventData)
		}
		attrs["span.events"] = events
	}
	
	metadataJSON, err := json.Marshal(attrs)
	if err != nil {
		p.logger.Error("Failed to marshal span attributes: %v", err)
		return
	}
	
	// Create trace entry
	traceEntry := Trace{
		Model:        model,
		Input:        input,
		Output:       output,
		PromptTokens: promptTokens,
		OutputTokens: outputTokens,
		Duration:     duration,
		Metadata:     string(metadataJSON),
		Timestamp:    s.StartTime(),
	}
	
	// Store in database
	id, err := p.db.CreateTrace(traceEntry)
	if err != nil {
		p.logger.Error("Failed to store trace from span: %v", err)
		return
	}
	
	p.logger.Info("Stored trace from OpenTelemetry span: %s (Model: %s, Duration: %dms, Tokens: %d/%d)",
		id, model, duration, promptTokens, outputTokens)
}

// Shutdown is called when the span processor is shut down
func (p *CustomSpanProcessor) Shutdown(ctx context.Context) error {
	p.logger.Info("Shutting down custom span processor")
	return nil
}

// ForceFlush is called to flush any buffered spans
func (p *CustomSpanProcessor) ForceFlush(ctx context.Context) error {
	p.logger.Debug("Force flushing span processor")
	return nil
}

// attrValueToInterface converts an attribute.Value to a Go interface{}
func attrValueToInterface(v attribute.Value) interface{} {
	switch v.Type() {
	case attribute.BOOL:
		return v.AsBool()
	case attribute.INT64:
		return v.AsInt64()
	case attribute.FLOAT64:
		return v.AsFloat64()
	case attribute.STRING:
		return v.AsString()
	case attribute.BOOLSLICE:
		return v.AsBoolSlice()
	case attribute.INT64SLICE:
		return v.AsInt64Slice()
	case attribute.FLOAT64SLICE:
		return v.AsFloat64Slice()
	case attribute.STRINGSLICE:
		return v.AsStringSlice()
	default:
		return v.AsString()
	}
}

// setupTracerProvider sets up the OpenTelemetry tracer provider with OTLP exporters
func setupTracerProvider(config Config, db Database, logger *Logger) (*sdktrace.TracerProvider, error) {
	logger.Info("Setting up OpenTelemetry tracer provider")
	
	// Create custom span processor
	processor := NewCustomSpanProcessor(db, logger)
	
	// Create tracer provider
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(processor),
	)
	
	logger.Info("OpenTelemetry tracer provider initialized successfully")
	return tp, nil
}
