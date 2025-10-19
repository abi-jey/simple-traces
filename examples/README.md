# Simple Traces API Examples

This directory contains example client implementations for interacting with the Simple Traces API.

## Python Example

```bash
pip install requests
python client.py
```

## Node.js Example

```bash
node client.js
```

## cURL Examples

### Create a trace
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
