# Simple Traces API Examples

This directory contains example client implementations for interacting with the Simple Traces API.

## Setup

Install dependencies for Node.js examples:

```bash
npm install
```

## Basic REST API Example

Simple example using the REST API directly:

```bash
node client.js
```

## OpenTelemetry Example

Example using OpenTelemetry Protocol (OTLP) to send traces:

```bash
npm run otel
```

This example demonstrates:
- Simple LLM traces with token usage
- Nested traces (parent-child relationships)
- Gen AI semantic conventions
- Traces with events (for streaming scenarios)

## Python Example

```bash
pip install requests
python client.py
```

## cURL Examples

### Create a trace via REST API
```bash
curl -X POST http://localhost:8080/api/traces \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "input": "What is AI?",
    "output": "AI stands for Artificial Intelligence...",
    "prompt_tokens": 10,
    "output_tokens": 50,
    "duration": 1500,
    "metadata": {
      "user_id": "user123",
      "temperature": 0.7
    }
  }'
```

### Get all traces
```bash
curl http://localhost:8080/api/traces
```

### Get a specific trace
```bash
curl http://localhost:8080/api/traces/{trace_id}
```

## OpenTelemetry OTLP Endpoint

The OTLP endpoint is available at:
- **HTTP**: `http://localhost:8080/v1/traces`

### Supported Attributes

The backend automatically maps the following OpenTelemetry attributes to trace fields:

**LLM Conventions:**
- `llm.model` → Model name
- `llm.input` → Input prompt
- `llm.output` → Model output
- `llm.usage.prompt_tokens` → Prompt token count
- `llm.usage.completion_tokens` → Completion token count

**Gen AI Semantic Conventions:**
- `gen_ai.request.model` → Model name
- `gen_ai.prompt` → Input prompt
- `gen_ai.response` → Model output
- `gen_ai.usage.input_tokens` → Input token count
- `gen_ai.usage.output_tokens` → Output token count

All other attributes are preserved in the trace metadata.
