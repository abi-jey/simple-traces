# Stage 1: Build frontend
FROM node:lts-alpine AS frontend-builder

WORKDIR /frontend

# Copy package files
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Build Go backend with embedded frontend
FROM golang:1.21-alpine AS go-builder

WORKDIR /app

# Install build dependencies for CGO
RUN apk add --no-cache gcc musl-dev

# Copy the built frontend from frontend-builder stage
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Copy go mod files
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy source code
COPY backend/*.go ./

# Build the application with CGO enabled for SQLite
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o simple-traces .

# Stage 3: Final runtime image
FROM alpine:latest

RUN apk --no-cache add ca-certificates sqlite-libs

WORKDIR /app

# Copy the Go binary (with embedded frontend) from go-builder stage
COPY --from=go-builder /app/simple-traces .

# Expose port
EXPOSE 8080

# Set default environment variables
ENV PORT=8080
ENV DB_TYPE=sqlite
ENV DB_CONNECTION=/data/traces.db

# Create data directory
RUN mkdir -p /data

CMD ["./simple-traces"]
