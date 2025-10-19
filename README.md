# Simple Traces

A lightweight LLM tracing tool with support for SQLite (no DB requirement) or PostgreSQL, built with Go backend and React frontend.

## Features

- 🚀 **Simple API** - REST endpoint to collect LLM traces
- 📡 **OpenTelemetry Collector** - OTLP HTTP endpoint to receive traces from instrumented applications
- 💾 **Flexible Storage** - SQLite (default, no setup) or PostgreSQL
- 🎨 **Clean UI** - React-based dashboard to view and analyze traces
- 🐳 **Docker Ready** - Single container with embedded frontend
- ⚡ **Fast & Lightweight** - Go backend with minimal dependencies
- 📦 **No External Dependencies** - Frontend embedded in Go binary
- 📝 **Structured Logging** - Configurable log levels with verbose output

## Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/abi-jey/simple-traces.git
cd simple-traces
```

2. Build the Docker image:
```bash
docker build -t simple-traces .
```

3. Run the container:
```bash
# Interactive mode (see logs)
docker run --rm -p 8080:8080 simple-traces

# Detached mode (background)
docker run -d -p 8080:8080 --name simple-traces simple-traces
```

4. Access the UI at http://localhost:8080

### Manual Setup

#### Prerequisites
- Go 1.21 or higher
- Node.js 18 or higher

#### Build from Root

The repository now supports building from the root directory:

```bash
# Install frontend dependencies
npm run install-frontend

# Build frontend
npm run build

# Build backend
npm run build-backend

# Or build everything at once
npm run build-all

# Run the application
./simple-traces
```

#### Development

For frontend development:
```bash
npm run dev  # Runs on http://localhost:5173
```

For backend development:
```bash
cd src/simple-traces/backend
go run .
```

## API Usage

### Create a Trace

```bash
curl -X POST http://localhost:8080/api/traces \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "input": "What is the meaning of life?",
    "output": "The meaning of life is a philosophical question...",
    "prompt_tokens": 10,
    "output_tokens": 50,
    "duration": 1500,
    "metadata": {
      "user_id": "user123",
      "temperature": 0.7
    }
  }'
```

### Get All Traces

```bash
curl http://localhost:8080/api/traces
```

### Get a Single Trace

```bash
curl http://localhost:8080/api/traces/{trace_id}
```

## Configuration

Configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_TYPE` | `sqlite` | Database type (`sqlite` or `postgres`) |
| `DB_CONNECTION` | `./data/traces.db` | Database connection string (Docker overrides to `/data/traces.db`) |
| `PORT` | `8080` | Server port |
| `LOG_LEVEL` | `INFO` | Log level (`DEBUG`, `INFO`, `WARN`, `ERROR`) |
| `OTLP_ENABLED` | `true` | Enable OpenTelemetry OTLP receiver |
| `OTLP_ENDPOINT` | `:4318` | OTLP endpoint (documentation only) |

### SQLite (Default)

```bash
export DB_TYPE=sqlite
export DB_CONNECTION=./data/traces.db
```

### PostgreSQL

```bash
export DB_TYPE=postgres
export DB_CONNECTION=postgres://username:password@localhost:5432/traces?sslmode=disable
```

See `.env.example` for more configuration options.

## OpenTelemetry Integration

Simple Traces acts as an **OpenTelemetry Collector** that receives traces via the OpenTelemetry Protocol (OTLP). You can instrument your applications (Python, JavaScript, Java, etc.) with OpenTelemetry and configure them to export traces to Simple Traces.

### OTLP HTTP Endpoint

```
POST http://localhost:8080/v1/traces
Content-Type: application/x-protobuf
```

### Python Example

Here's how to send traces from a Python application:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

# Configure the tracer
resource = Resource.create({"service.name": "my-python-app"})
trace.set_tracer_provider(TracerProvider(resource=resource))

# Configure OTLP exporter to send to Simple Traces
otlp_exporter = OTLPSpanExporter(
    endpoint="http://localhost:8080/v1/traces",
)

# Add the exporter
span_processor = BatchSpanProcessor(otlp_exporter)
trace.get_tracer_provider().add_span_processor(span_processor)

# Create traces
tracer = trace.get_tracer(__name__)
with tracer.start_as_current_span("llm-request") as span:
    span.set_attribute("llm.model", "gpt-4")
    span.set_attribute("llm.input", "What is the meaning of life?")
    span.set_attribute("llm.output", "42")
    span.set_attribute("llm.usage.prompt_tokens", 10)
    span.set_attribute("llm.usage.completion_tokens", 5)
```

### Supported Attributes

The backend automatically maps OpenTelemetry span attributes to trace fields:

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

All span attributes, events, and metadata are preserved in the trace metadata field.

### JavaScript/Node.js Example

```javascript
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { Resource } = require('@opentelemetry/resources');
const { trace } = require('@opentelemetry/api');

// Configure the tracer
const provider = new NodeTracerProvider({
  resource: new Resource({
    'service.name': 'my-node-app',
  }),
});

// Configure OTLP exporter to send to Simple Traces
const exporter = new OTLPTraceExporter({
  url: 'http://localhost:8080/v1/traces',
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));
provider.register();

// Create traces
const tracer = trace.getTracer('my-app');
const span = tracer.startSpan('llm-request');
span.setAttribute('llm.model', 'gpt-4');
span.setAttribute('llm.input', 'What is AI?');
span.setAttribute('llm.output', 'Artificial Intelligence...');
span.setAttribute('llm.usage.prompt_tokens', 8);
span.setAttribute('llm.usage.completion_tokens', 25);
span.end();
```

### Additional Examples

For more examples of OpenTelemetry integration, check the `examples/` directory in this repository which includes:
- `python_otlp_client.py` - Complete Python example with LLM trace attributes
- See `examples/README.md` for more details and usage instructions


### Logging Configuration

Set the `LOG_LEVEL` environment variable to control logging verbosity:

- `DEBUG` - Verbose logging including request details and span processing
- `INFO` - Standard operational logs (default)
- `WARN` - Warning messages only
- `ERROR` - Error messages only

Example:
```bash
export LOG_LEVEL=DEBUG
./simple-traces
```

## Development

### Backend

Build from the repo root (produces a `simple-traces` binary in the root):

```
go build ./cmd/simple-traces
```

Alternatively, build and run in one go:

```
go run ./cmd/simple-traces
```

Docker build also works from the root and will build the frontend and embed it:

```
docker build -t ghcr.io/abi-jey/simple-traces:latest-dev .
```

You can run from the repo root (recommended for debug tools and to ensure both frontend and backend assets are embedded correctly):

```bash
go run .
```

Or directly inside the backend folder:

```bash
cd src/simple-traces/backend
go run .
```

### VS Code Debugging

We include a `.vscode/launch.json` that debugs the root module. Use the configuration "Run Simple Traces (root)". This avoids
errors like `undefined: InitLogger` that occur when trying to debug a single file without the full package context.

### Frontend

```bash
npm run dev
```

The frontend dev server will proxy API requests to the backend at `http://localhost:8080`.

## Docker Deployment

The Docker image uses a multi-stage build that:
1. Builds the React frontend using Node.js
2. Embeds the built frontend into the Go binary
3. Creates a minimal Alpine-based runtime image

### Build the Image

```bash
docker build -t simple-traces .
```

### Run with SQLite (Default)

```bash
# Run in interactive mode
docker run --rm -p 8080:8080 simple-traces

# Run in detached mode
docker run -d -p 8080:8080 --name simple-traces simple-traces

# With persistent storage (optional)
docker run -d -p 8080:8080 -v $(pwd)/data:/data --name simple-traces simple-traces
```

### Run with PostgreSQL

```bash
docker run -d -p 8080:8080 \
  -e DB_TYPE=postgres \
  -e DB_CONNECTION="postgres://user:pass@host:5432/traces?sslmode=disable" \
  --name simple-traces simple-traces
```

### Stop the Container

```bash
docker stop simple-traces
docker rm simple-traces
```

## Project Structure

```
simple-traces/
├── src/
│   └── simple-traces/
│       ├── backend/           # Go backend
│       │   ├── main.go       # Main server code
│       │   ├── database.go   # Database abstraction layer
│       │   ├── static.go     # Embedded frontend files handler
│       │   └── otel*.go      # OpenTelemetry integration
│       └── frontend/          # React frontend
│           ├── src/          # Source files
│           └── package.json  # Frontend dependencies
├── examples/          # Example clients
├── go.mod            # Go dependencies (root)
├── package.json      # NPM scripts (root)
├── Dockerfile        # Multi-stage Docker build
└── README.md         # This file
```

## Architecture

The application uses a 3-stage Docker build:

1. **Frontend Build Stage**: Compiles React app using Node.js LTS
2. **Backend Build Stage**: Embeds frontend files into Go binary using `//go:embed`
3. **Runtime Stage**: Minimal Alpine Linux image with only the Go binary

Frontend files are embedded at build time, resulting in a single self-contained binary 
with no external file dependencies.

## API Schema

### Trace Object

```json
{
  "id": "trace_1234567890",
  "model": "gpt-4",
  "input": "User input text",
  "output": "Model output text",
  "prompt_tokens": 100,
  "output_tokens": 200,
  "duration": 1500,
  "metadata": "{}",
  "timestamp": "2025-10-19T09:30:00Z"
}
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.