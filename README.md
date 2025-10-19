# Simple Traces

A lightweight LLM tracing tool with support for SQLite (no DB requirement) or PostgreSQL, built with Go backend and React frontend.

## Features

- 🚀 **Simple API** - REST endpoint to collect LLM traces
- 📡 **OpenTelemetry Support** - Native OTLP receiver for trace collection
- 💾 **Flexible Storage** - SQLite (default, no setup) or PostgreSQL
- 🎨 **Clean UI** - React-based dashboard to view and analyze traces
- 🐳 **Docker Ready** - Easy deployment with Docker and docker-compose
- ⚡ **Fast & Lightweight** - Go backend with minimal dependencies
- 📝 **Structured Logging** - Configurable log levels with verbose output

## Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/abi-jey/simple-traces.git
cd simple-traces
```

2. Run with docker-compose:
```bash
docker-compose up -d
```

3. Access the UI at http://localhost:8080

### Manual Setup

#### Prerequisites
- Go 1.21 or higher
- Node.js 18 or higher

#### Backend Setup

```bash
cd backend
go mod download
go build -o simple-traces
./simple-traces
```

#### Frontend Setup

```bash
cd frontend
npm install
npm run build
```

For development:
```bash
npm run dev  # Runs on http://localhost:5173
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
| `DB_CONNECTION` | `./traces.db` | Database connection string |
| `PORT` | `8080` | Server port |
| `FRONTEND_DIR` | `../frontend/dist` | Frontend build directory |
| `LOG_LEVEL` | `INFO` | Log level (`DEBUG`, `INFO`, `WARN`, `ERROR`) |
| `OTLP_ENABLED` | `true` | Enable OpenTelemetry OTLP receiver |
| `OTLP_ENDPOINT` | `:4318` | OTLP endpoint (documentation only) |

### SQLite (Default)

```bash
export DB_TYPE=sqlite
export DB_CONNECTION=./traces.db
```

### PostgreSQL

```bash
export DB_TYPE=postgres
export DB_CONNECTION=postgres://username:password@localhost:5432/traces?sslmode=disable
```

See `.env.example` for more configuration options.

## OpenTelemetry Integration

Simple Traces now supports receiving traces via the OpenTelemetry Protocol (OTLP).

### OTLP HTTP Endpoint

```
POST http://localhost:8080/v1/traces
Content-Type: application/x-protobuf
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

### Example Usage

See the `examples/otel-client.js` file for a complete OpenTelemetry integration example.

```bash
cd examples
npm install
npm run otel
```

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

```bash
cd backend
go run .
```

### Frontend

```bash
cd frontend
npm run dev
```

The frontend dev server will proxy API requests to the backend at `http://localhost:8080`.

## Docker Deployment

### With SQLite (Default)

```bash
docker-compose up -d
```

Data will be persisted in the `./data` directory.

### With PostgreSQL

Edit `docker-compose.yml` and uncomment the PostgreSQL configuration section, then:

```bash
docker-compose up -d
```

## Project Structure

```
simple-traces/
├── backend/           # Go backend
│   ├── main.go       # Main server code
│   ├── database.go   # Database abstraction layer
│   └── go.mod        # Go dependencies
├── frontend/          # React frontend
│   ├── src/          # Source files
│   ├── public/       # Static assets
│   └── package.json  # Node dependencies
├── Dockerfile         # Docker configuration
├── docker-compose.yml # Docker Compose configuration
└── README.md         # This file
```

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