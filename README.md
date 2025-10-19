# Simple Traces

A lightweight LLM tracing tool with support for SQLite (no DB requirement) or PostgreSQL, built with Go backend and React frontend.

## Features

- 🚀 **Simple API** - Single endpoint to collect LLM traces
- 💾 **Flexible Storage** - SQLite (default, no setup) or PostgreSQL
- 🎨 **Clean UI** - React-based dashboard to view and analyze traces
- 🐳 **Docker Ready** - Single container with embedded frontend
- ⚡ **Fast & Lightweight** - Go backend with minimal dependencies
- 📦 **No External Dependencies** - Frontend embedded in Go binary

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
| `DB_CONNECTION` | `/data/traces.db` | Database connection string |
| `PORT` | `8080` | Server port |

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
├── backend/           # Go backend
│   ├── main.go       # Main server code
│   ├── database.go   # Database abstraction layer
│   ├── static.go     # Embedded frontend files handler
│   └── go.mod        # Go dependencies
├── frontend/          # React frontend
│   ├── src/          # Source files
│   ├── public/       # Static assets
│   └── package.json  # Node dependencies
├── Dockerfile         # Multi-stage Docker build
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