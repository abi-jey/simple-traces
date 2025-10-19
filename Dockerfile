# Backend Dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go mod files
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy source code
COPY backend/*.go ./

# Build the application with CGO enabled for SQLite
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o simple-traces .

# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates sqlite-libs

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/simple-traces .

# Copy frontend dist
COPY frontend/dist ./frontend/dist

# Expose port
EXPOSE 8080

# Set default environment variables
ENV PORT=8080
ENV DB_TYPE=sqlite
ENV DB_CONNECTION=/data/traces.db
ENV FRONTEND_DIR=./frontend/dist

# Create data directory
RUN mkdir -p /data

CMD ["./simple-traces"]
