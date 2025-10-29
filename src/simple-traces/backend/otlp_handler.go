package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	tracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepbv1 "go.opentelemetry.io/proto/otlp/trace/v1"
)

// formatBytes converts byte count to human readable format
func formatBytes(b int) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

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

	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.logger.Error("Failed to read OTLP request body: %v", err)
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	h.logger.Debug("Received OTLP payload: %s (Content-Type=%s)", formatBytes(len(body)), r.Header.Get("Content-Type"))

	// Parse OTLP trace request
	var req tracepb.ExportTraceServiceRequest
	if err := proto.Unmarshal(body, &req); err != nil {
		h.logger.Error("Failed to unmarshal OTLP trace request: %v", err)
		http.Error(w, "Failed to parse OTLP request", http.StatusBadRequest)
		return
	}

	// Also dump a JSON view of the OTLP content for debugging
	{
		marshaler := protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: false, Indent: "  "}
		if b, err := marshaler.Marshal(&req); err == nil {
			h.logger.Debug("OTLP JSON preview: %s", string(b))
		}
	}

	h.logger.Info("Processing OTLP trace export with %d resource spans", len(req.ResourceSpans))

	// Process each resource span
	spansProcessed := 0
	// Collect spans for batch insert for efficiency
	var spanRows []Span
	// collect conversation aggregates for batch upsert
	convAgg := make(map[string]*ConversationUpdate)

	for _, rs := range req.ResourceSpans {
		for _, ss := range rs.ScopeSpans {
			for _, span := range ss.Spans {
				// Transform span
				spanRow := h.transformSpan(span, rs.Resource)
				spanRows = append(spanRows, spanRow)
				spansProcessed++

				// derive conversation id from span attributes
				convID := deriveConversationIDFromJSON(spanRow.Attributes)
				userID := deriveUserIDFromJSON(spanRow.Attributes)

				if convID != "" {
					cu := convAgg[convID]
					start := spanRow.StartTime
					end := spanRow.EndTime
					if cu == nil {
						convAgg[convID] = &ConversationUpdate{
							ID:        convID,
							ProjectID: spanRow.ProjectID,
							UserID:    userID,
							Start:     start,
							End:       end,
						}
					} else {
						if start.Before(cu.Start) {
							cu.Start = start
						}
						if end.After(cu.End) {
							cu.End = end
						}
						// Update user_id if it was empty and we now have one
						if cu.UserID == "" && userID != "" {
							cu.UserID = userID
						}
					}
					h.logger.Debug("Derived conversation_id=%s user_id=%s for span_id=%s trace_id=%s", convID, userID, spanRow.SpanID, spanRow.TraceID)
				}
			}
		}
	}

	// Batch insert spans
	if err := h.db.BatchInsertSpans(spanRows); err != nil {
		h.logger.Error("Failed to batch insert %d spans: %v", len(spanRows), err)
	}

	// upsert conversations
	if len(convAgg) > 0 {
		updates := make([]ConversationUpdate, 0, len(convAgg))
		for convID, v := range convAgg {
			updates = append(updates, *v)
			// also propagate this conversation id to all spans that share the same trace id if missing
			// we use the span trace_id as fallback linkage: update after inserts
			for _, sp := range spanRows {
				// propagate for spans that occurred in this batch with the same conversation id found
				// Note: deriveConversationIDFromJSON used attributes only; here we ensure every span under the same OTLP trace
				// gets the conv id if not already present.
				_, _ = h.db.PropagateConversationID(sp.TraceID, convID)
			}
		}
		if err := h.db.BatchUpsertConversations(updates); err != nil {
			h.logger.Error("Failed to upsert conversations: %v", err)
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

// deriveConversationIDFromJSON picks a conversation id from preferred keys in span attributes JSON
func deriveConversationIDFromJSON(attrsJSON string) string {
	if attrsJSON == "" {
		return ""
	}

	var attrs map[string]interface{}
	if err := json.Unmarshal([]byte(attrsJSON), &attrs); err != nil {
		return ""
	}

	// scan by preference order
	pref := []string{
		"simpleTraces.conversation.id",
		"gcp.vertex.agent.session_id",
		"gen_ai.conversation.id",
		"conversation.id",
		"conversation_id",
		"session.conversation_id",
		"session.id",
		"chat.id",
		"thread.id",
	}

	for _, k := range pref {
		if v, ok := attrs[k]; ok {
			if strVal, ok := v.(string); ok && strings.TrimSpace(strVal) != "" {
				return strVal
			}
		}
	}
	return ""
}

// Generated by Copilot
// deriveUserIDFromJSON picks a user id from preferred keys in span attributes JSON
func deriveUserIDFromJSON(attrsJSON string) string {
	if attrsJSON == "" {
		return ""
	}

	var attrs map[string]interface{}
	if err := json.Unmarshal([]byte(attrsJSON), &attrs); err != nil {
		return ""
	}

	// scan by preference order
	pref := []string{
		"simpleTraces.user.id",
		"user.id",
		"user_id",
		"enduser.id",
		"actor.id",
		"gen_ai.user.id",
		"session.user.id",
	}

	for _, k := range pref {
		if v, ok := attrs[k]; ok {
			if strVal, ok := v.(string); ok && strings.TrimSpace(strVal) != "" {
				return strVal
			}
		}
	}
	return ""
}

// transformSpan converts an OTLP span to our Span struct
func (h *OTLPHandler) transformSpan(span *tracepbv1.Span, resource *resourcepb.Resource) Span {
	h.logger.Debug("Processing OTLP span: %s", span.Name)

	// Extract attributes into a map
	attrs := make(map[string]interface{})
	for _, attr := range span.Attributes {
		if attr == nil {
			continue
		}
		attrs[attr.Key] = anyValueToInterface(attr.Value)
	}

	// Also add resource attributes
	if resource != nil {
		for _, attr := range resource.Attributes {
			if attr == nil {
				continue
			}
			key := attr.Key
			val := anyValueToInterface(attr.Value)
			// record prefixed resource attribute
			attrs["resource."+key] = val
			// Also propagate to top-level if not present already
			if _, exists := attrs[key]; !exists {
				attrs[key] = val
				h.logger.Debug("Propagated resource attribute to top-level: %s <- resource.%s", key, key)
			}
		}
	}

	// Provider-specific augmentation (e.g., Vertex Agent JSON fields)
	if added := augmentVertexAttrs(attrs); len(added) > 0 {
		h.logger.Debug("Derived attributes added: %v", added)
	}

	// Extract model and IO usage info from attributes (with broader provider coverage)
	model, modelSrc := detectModelFromAttrs(attrs)
	if strings.TrimSpace(model) == "" {
		model = "unknown"
	}
	if strings.TrimSpace(modelSrc) != "" {
		h.logger.Debug("Detected model='%s' from key '%s'", model, modelSrc)
	} else {
		h.logger.Debug("Detected model='%s' (no explicit source key)", model)
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
					if attr == nil {
						continue
					}
					eventAttrs[attr.Key] = anyValueToInterface(attr.Value)
				}
				eventData["attributes"] = eventAttrs
			}
			events = append(events, eventData)
		}
		attrs["span.events"] = events
	}

	// Flatten attributes for metadata and typed storage (record any nested-key renames)
	flat, flattenedKeys := FlattenAttrsWithTrace(attrs)
	if len(flattenedKeys) > 0 {
		// Log only in debug: which keys resulted from flattening (i.e., implicit renames to dot-notation)
		h.logger.Debug("Flattened nested attributes into dot-keys (%d): %v", len(flattenedKeys), flattenedKeys)
	}

	// Build span row: store flattened attributes (without events) as JSON for display
	attrsOnly := make(map[string]interface{})
	// Keep the flattened attributes except events (handled separately)
	for k, v := range flat {
		switch k {
		case "span.events":
			// handled below
		default:
			attrsOnly[k] = v
		}
	}
	// Add derived attributes for UI/search convenience
	if strings.TrimSpace(model) != "" && strings.ToLower(model) != "unknown" {
		attrsOnly["simpleTraces.model"] = model
	}
	attrsOnly["simpleTraces.category"] = detectCategory(span.Name, flat)

	// Extract project_id from attributes with preference order
	projectID := "default"
	projectKeys := []string{
		"simpleTraces.project.id",
		"project.id",
		"resource.project.id",
		"gcp.project.id",
		"service.namespace",
	}
	for _, key := range projectKeys {
		if projAttr, ok := attrs[key]; ok {
			if projStr, ok := projAttr.(string); ok && strings.TrimSpace(projStr) != "" {
				projectID = projStr
				break
			}
		}
	}
	// Also store in attributes for consistency
	attrsOnly["simpleTraces.project.id"] = projectID

	attrsStr, _ := json.Marshal(attrsOnly)
	var eventsStr []byte
	if ev, ok := attrs["span.events"]; ok {
		eventsStr, _ = json.Marshal(ev)
	}

	spanRow := Span{
		SpanID:       fmt.Sprintf("%x", span.SpanId),
		TraceID:      fmt.Sprintf("%x", span.TraceId),
		ProjectID:    projectID,
		ParentSpanID: fmt.Sprintf("%x", span.ParentSpanId),
		Name:         span.Name,
		StartTime:    startTime,
		EndTime:      endTime,
		DurationMS:   duration,
		StatusCode:   "",
		StatusDesc:   "",
		Attributes:   string(attrsStr),
		Events:       string(eventsStr),
	}
	if span.Status != nil {
		spanRow.StatusCode = statusCodeToString(span.Status.Code)
		spanRow.StatusDesc = span.Status.Message
	}

	return spanRow
}

// augmentVertexAttrs parses provider-specific blobs (like Vertex Agent request/response) into normalized keys
// to improve search and UI rendering. It mutates attrs in-place.
// augmentVertexAttrs parses provider-specific blobs (like Vertex Agent request/response) into normalized keys
// and returns a list of derived keys that were added for debug visibility.
func augmentVertexAttrs(attrs map[string]any) []string {
	var added []string
	// Request: gcp.vertex.agent.llm_request (JSON string)
	if v, ok := attrs["gcp.vertex.agent.llm_request"]; ok {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			var req map[string]any
			if err := json.Unmarshal([]byte(s), &req); err == nil {
				// system instruction
				if cfg, ok := req["config"].(map[string]any); ok {
					if si, ok := cfg["system_instruction"].(string); ok && strings.TrimSpace(si) != "" {
						attrs["simpleTraces.system_instruction"] = si
						added = append(added, "simpleTraces.system_instruction")
					}
				}
				// user messages -> derive prompt (take last user text)
				if raw, ok := req["contents"]; ok {
					if arr, ok := raw.([]any); ok {
						lastUser := ""
						for _, item := range arr {
							m, ok := item.(map[string]any)
							if !ok {
								continue
							}
							role, _ := m["role"].(string)
							if strings.ToLower(role) == "user" {
								if parts, ok := m["parts"].([]any); ok {
									var buf strings.Builder
									for _, p := range parts {
										if pm, ok := p.(map[string]any); ok {
											if t, ok := pm["text"].(string); ok {
												if buf.Len() > 0 {
													buf.WriteString("\n\n")
												}
												buf.WriteString(t)
											}
										}
									}
									if buf.Len() > 0 {
										lastUser = buf.String()
									}
								}
							}
						}
						if strings.TrimSpace(lastUser) != "" {
							if _, exists := attrs["gen_ai.prompt"]; !exists {
								attrs["gen_ai.prompt"] = lastUser
								added = append(added, "gen_ai.prompt")
							}
							// also expose all messages for UI (kept as array)
							attrs["simpleTraces.messages"] = arr
							added = append(added, "simpleTraces.messages")
						}
					}
				}
			}
		}
	}
	// Response: gcp.vertex.agent.llm_response (JSON string)
	if v, ok := attrs["gcp.vertex.agent.llm_response"]; ok {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			var resp map[string]any
			if err := json.Unmarshal([]byte(s), &resp); err == nil {
				// extract response text
				if content, ok := resp["content"].(map[string]any); ok {
					if parts, ok := content["parts"].([]any); ok {
						var buf strings.Builder
						for _, p := range parts {
							if pm, ok := p.(map[string]any); ok {
								if t, ok := pm["text"].(string); ok {
									if buf.Len() > 0 {
										buf.WriteString("\n\n")
									}
									buf.WriteString(t)
								}
							}
						}
						if buf.Len() > 0 {
							if _, exists := attrs["gen_ai.response"]; !exists {
								attrs["gen_ai.response"] = buf.String()
								added = append(added, "gen_ai.response")
							}
						}
					}
				}
				// usage tokens
				if usage, ok := resp["usage_metadata"].(map[string]any); ok {
					if _, exists := attrs["gen_ai.usage.input_tokens"]; !exists {
						if pt, ok := asInt(usage["prompt_token_count"]); ok {
							attrs["gen_ai.usage.input_tokens"] = pt
							added = append(added, "gen_ai.usage.input_tokens")
						}
					}
					if _, exists := attrs["gen_ai.usage.output_tokens"]; !exists {
						if ct, ok := asInt(usage["candidates_token_count"]); ok {
							attrs["gen_ai.usage.output_tokens"] = ct
							added = append(added, "gen_ai.usage.output_tokens")
						}
					}
				}
			}
		}
	}
	return added
}

// asInt attempts to coerce an interface{} to int64-compatible int
func asInt(v any) (int64, bool) {
	switch n := v.(type) {
	case int64:
		return n, true
	case float64:
		return int64(n), true
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return i, true
		}
		return 0, false
	case string:
		if strings.TrimSpace(n) == "" {
			return 0, false
		}
		// best-effort parse
		var num json.Number = json.Number(n)
		if i, err := num.Int64(); err == nil {
			return i, true
		}
		return 0, false
	default:
		return 0, false
	}
}

// detectModelFromAttrs tries a comprehensive set of keys and embedded JSONs to find a model name
// detectModelFromAttrs returns model name and the source key it came from (if any)
func detectModelFromAttrs(attrs map[string]any) (string, string) {
	// direct keys first
	keys := []string{
		"simpleTraces.model", // already normalized
		"llm.model", "gen_ai.request.model", "openai.model", "anthropic.model",
		"vertex.model", "google.vertex.model", "ai.model", "model",
	}
	for _, k := range keys {
		if v, ok := attrs[k]; ok {
			s := strings.TrimSpace(fmt.Sprintf("%v", v))
			if s != "" {
				return s, k
			}
		}
	}
	// embedded JSON strings with potential model key
	embedded := []string{
		"gcp.vertex.agent.llm_request", "gcp.vertex.agent.llm_response",
		"gen_ai.request", "gen_ai.response", "llm.request", "llm.response",
	}
	for _, k := range embedded {
		if v, ok := attrs[k]; ok {
			switch vv := v.(type) {
			case string:
				var obj map[string]any
				if err := json.Unmarshal([]byte(vv), &obj); err == nil {
					if m, ok := obj["model"]; ok {
						s := strings.TrimSpace(fmt.Sprintf("%v", m))
						if s != "" {
							return s, k + ".model"
						}
					}
				}
			case map[string]any:
				if m, ok := vv["model"]; ok {
					s := strings.TrimSpace(fmt.Sprintf("%v", m))
					if s != "" {
						return s, k + ".model"
					}
				}
			}
		}
	}
	// fallback: resource.service.name may contain an agent name; only use if it's clearly a model
	if v, ok := attrs["resource.service.name"]; ok {
		s := strings.TrimSpace(fmt.Sprintf("%v", v))
		// Heuristic: if contains vendor/model tokens
		lower := strings.ToLower(s)
		if strings.Contains(lower, "gpt") || strings.Contains(lower, "gemini") || strings.Contains(lower, "claude") {
			return s, "resource.service.name"
		}
	}
	return "", ""
}

// detectCategory derives a coarse category for the span for coloring/filtering
func detectCategory(name string, attrs map[string]any) string {
	n := strings.ToLower(name)
	has := func(k string) bool { _, ok := attrs[k]; return ok }
	// LLM calls
	if has("llm.model") || has("gen_ai.request.model") || has("simpleTraces.model") || strings.Contains(n, "call_llm") ||
		strings.Contains(n, "openai") || strings.Contains(n, "anthropic") || strings.Contains(n, "gemini") {
		return "llm"
	}
	// HTTP
	if has("http.method") || has("http.url") || strings.Contains(n, "http") {
		return "http"
	}
	// Database
	if has("db.system") || has("db.statement") {
		return "db"
	}
	// Agent / Orchestration
	if strings.Contains(n, "agent") || has("agent.name") || has("gen_ai.system") {
		return "agent"
	}
	// Tool/function calls
	if strings.Contains(n, "tool") || has("function.name") || has("tool.name") {
		return "tool"
	}
	return "other"
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

// anyValueToInterface converts an OTLP AnyValue into native Go types while preserving arrays and objects
func anyValueToInterface(v *commonpb.AnyValue) interface{} {
	if v == nil {
		return nil
	}
	switch vv := v.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return vv.StringValue
	case *commonpb.AnyValue_BoolValue:
		return vv.BoolValue
	case *commonpb.AnyValue_IntValue:
		return vv.IntValue
	case *commonpb.AnyValue_DoubleValue:
		return vv.DoubleValue
	case *commonpb.AnyValue_BytesValue:
		// Keep bytes as base64 string for readability
		return string(vv.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		arr := vv.ArrayValue
		if arr == nil {
			return []any{}
		}
		out := make([]any, 0, len(arr.Values))
		for _, elem := range arr.Values {
			out = append(out, anyValueToInterface(elem))
		}
		return out
	case *commonpb.AnyValue_KvlistValue:
		kv := vv.KvlistValue
		if kv == nil {
			return map[string]any{}
		}
		m := make(map[string]any, len(kv.Values))
		for _, kvp := range kv.Values {
			if kvp == nil {
				continue
			}
			m[kvp.Key] = anyValueToInterface(kvp.Value)
		}
		return m
	default:
		return fmt.Sprintf("<unsupported type: %T>", vv)
	}
}
