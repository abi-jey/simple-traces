# Simple Traces Examples

This directory contains example clients that demonstrate how to send traces to the Simple Traces OpenTelemetry collector.

## Python Example

The Python example shows how to instrument a Python application with OpenTelemetry and send traces to Simple Traces.

### Prerequisites

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

### Running the Example

1. Start Simple Traces server:
```bash
# From the repository root
./simple-traces
```

2. Run the Python client:
```bash
python examples/python_otlp_client.py
```

3. View the traces in the web UI at http://localhost:8080

## Supported Attributes

Simple Traces automatically extracts LLM-related information from OpenTelemetry span attributes:

### LLM Conventions
- `llm.model` → Model name
- `llm.input` → Input prompt
- `llm.output` → Model output
- `llm.usage.prompt_tokens` → Prompt token count
- `llm.usage.completion_tokens` → Completion token count

### Gen AI Semantic Conventions
- `gen_ai.request.model` → Model name
- `gen_ai.prompt` → Input prompt
- `gen_ai.response` → Model output
- `gen_ai.usage.input_tokens` → Input token count
- `gen_ai.usage.output_tokens` → Output token count

All other attributes are preserved in the trace metadata.
