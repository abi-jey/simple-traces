package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"google.golang.org/protobuf/proto"

	tracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepbv1 "go.opentelemetry.io/proto/otlp/trace/v1"
)

// OTLPHandler handles OTLP trace data via HTTP
type OTLPHandler struct {
	db     Database
	logger *Logger
}

// NewOTLPHandler creates a new OTLP handler
func NewOTLPHandler(db Database, logger *Logger) *OTLPHandler {
	return &OTLPHandler{
		db:     db,
		logger: logger,
	}
}

// ServeHTTP handles OTLP HTTP requests
func (h *OTLPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.logger.Debug("Received OTLP request: %s %s", r.Method, r.URL.Path)

	if r.Method != http.MethodPost {
		h.logger.Warn("Invalid OTLP request method: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.logger.Error("Failed to read OTLP request body: %v", err)
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	h.logger.Debug("Received OTLP payload of %d bytes", len(body))

	// Parse OTLP trace request
	var req tracepb.ExportTraceServiceRequest
	if err := proto.Unmarshal(body, &req); err != nil {
		h.logger.Error("Failed to unmarshal OTLP trace request: %v", err)
		http.Error(w, "Failed to parse OTLP request", http.StatusBadRequest)
		return
	}

	h.logger.Info("Processing OTLP trace export with %d resource spans", len(req.ResourceSpans))

	// Process each resource span
	spansProcessed := 0
	for _, rs := range req.ResourceSpans {
		for _, ss := range rs.ScopeSpans {
			for _, span := range ss.Spans {
				h.processSpan(span, rs.Resource)
				spansProcessed++
			}
		}
	}

	h.logger.Info("Successfully processed %d spans from OTLP export", spansProcessed)

	// Send success response
	resp := &tracepb.ExportTraceServiceResponse{}
	respBytes, err := proto.Marshal(resp)
	if err != nil {
		h.logger.Error("Failed to marshal OTLP response: %v", err)
		http.Error(w, "Failed to create response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
	w.Write(respBytes)
}

// processSpan converts and stores an OTLP span directly
func (h *OTLPHandler) processSpan(span *tracepbv1.Span, resource *resourcepb.Resource) {
	h.logger.Debug("Processing OTLP span: %s", span.Name)

	// Extract attributes into a map
	attrs := make(map[string]interface{})
	for _, attr := range span.Attributes {
		kv := convertOTLPAttribute(attr)
		attrs[string(kv.Key)] = attrValueToInterface(kv.Value)
	}

	// Also add resource attributes
	if resource != nil {
		for _, attr := range resource.Attributes {
			kv := convertOTLPAttribute(attr)
			attrs["resource."+string(kv.Key)] = attrValueToInterface(kv.Value)
		}
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
	} else if modelAttr, ok := attrs["resource.service.name"]; ok {
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
	startTime := time.Unix(0, int64(span.StartTimeUnixNano))
	endTime := time.Unix(0, int64(span.EndTimeUnixNano))
	duration := endTime.Sub(startTime).Milliseconds()

	// Add span metadata
	attrs["span.name"] = span.Name
	attrs["span.kind"] = spanKindToString(span.Kind)
	attrs["trace.id"] = fmt.Sprintf("%x", span.TraceId)
	attrs["span.id"] = fmt.Sprintf("%x", span.SpanId)

	if span.Status != nil {
		attrs["span.status.code"] = statusCodeToString(span.Status.Code)
		if span.Status.Message != "" {
			attrs["span.status.description"] = span.Status.Message
		}
	}

	// Add events to metadata if any
	if len(span.Events) > 0 {
		events := make([]map[string]interface{}, 0, len(span.Events))
		for _, event := range span.Events {
			eventData := map[string]interface{}{
				"name":      event.Name,
				"timestamp": time.Unix(0, int64(event.TimeUnixNano)).Format(time.RFC3339Nano),
			}
			if len(event.Attributes) > 0 {
				eventAttrs := make(map[string]interface{})
				for _, attr := range event.Attributes {
					kv := convertOTLPAttribute(attr)
					eventAttrs[string(kv.Key)] = attrValueToInterface(kv.Value)
				}
				eventData["attributes"] = eventAttrs
			}
			events = append(events, eventData)
		}
		attrs["span.events"] = events
	}

	metadataJSON, err := json.Marshal(attrs)
	if err != nil {
		h.logger.Error("Failed to marshal span attributes: %v", err)
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
		Timestamp:    startTime,
	}

	// Store in database
	id, err := h.db.CreateTrace(traceEntry)
	if err != nil {
		h.logger.Error("Failed to store trace from OTLP span: %v", err)
		return
	}

	h.logger.Info("Stored trace from OTLP span: %s (Model: %s, Duration: %dms, Tokens: %d/%d)",
		id, model, duration, promptTokens, outputTokens)
}

func spanKindToString(kind tracepbv1.Span_SpanKind) string {
	switch kind {
	case tracepbv1.Span_SPAN_KIND_INTERNAL:
		return "INTERNAL"
	case tracepbv1.Span_SPAN_KIND_SERVER:
		return "SERVER"
	case tracepbv1.Span_SPAN_KIND_CLIENT:
		return "CLIENT"
	case tracepbv1.Span_SPAN_KIND_PRODUCER:
		return "PRODUCER"
	case tracepbv1.Span_SPAN_KIND_CONSUMER:
		return "CONSUMER"
	default:
		return "UNSPECIFIED"
	}
}

func statusCodeToString(code tracepbv1.Status_StatusCode) string {
	switch code {
	case tracepbv1.Status_STATUS_CODE_OK:
		return "OK"
	case tracepbv1.Status_STATUS_CODE_ERROR:
		return "ERROR"
	default:
		return "UNSET"
	}
}

// convertOTLPAttribute converts an OTLP attribute to an OpenTelemetry attribute
func convertOTLPAttribute(attr *commonpb.KeyValue) attribute.KeyValue {
	key := attribute.Key(attr.Key)

	switch v := attr.Value.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return key.String(v.StringValue)
	case *commonpb.AnyValue_BoolValue:
		return key.Bool(v.BoolValue)
	case *commonpb.AnyValue_IntValue:
		return key.Int64(v.IntValue)
	case *commonpb.AnyValue_DoubleValue:
		return key.Float64(v.DoubleValue)
	case *commonpb.AnyValue_ArrayValue:
		// Convert array to string representation for now
		return key.String(fmt.Sprintf("%v", v.ArrayValue))
	case *commonpb.AnyValue_KvlistValue:
		// Convert key-value list to string representation for now
		return key.String(fmt.Sprintf("%v", v.KvlistValue))
	case *commonpb.AnyValue_BytesValue:
		// Convert bytes to string
		return key.String(string(v.BytesValue))
	default:
		// Log warning for truly unknown types
		return key.String(fmt.Sprintf("<unsupported type: %T>", v))
	}
}

// attrValueToInterface converts an attribute.Value to a Go interface{}
// It handles all OpenTelemetry attribute types including:
// - Primitive types (bool, int64, float64, string)
// - Slice types ([]bool, []int64, []float64, []string)
// For unsupported types, it falls back to string conversion using AsString()
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
