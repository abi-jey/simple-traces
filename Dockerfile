########## Stage 1: Build frontend ##########
FROM node:lts-alpine AS frontend-builder

WORKDIR /app

# Copy root package files and vite config
COPY package*.json ./
COPY vite.config.js ./

# Copy frontend source code
COPY src/simple-traces/frontend ./src/simple-traces/frontend

# Install and build
RUN npm install && mkdir -p src/simple-traces/backend/frontend && npm run build

########## Stage 2: Build Go backend with embedded frontend ##########
FROM golang:1.25-alpine AS go-builder

WORKDIR /app

# Install build dependencies for CGO
RUN apk add --no-cache gcc musl-dev

# Ensure Go can auto-download the exact toolchain version specified in go.mod if needed
ENV GOTOOLCHAIN=auto

# Copy root Go module files and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy entire repository (keeping module path intact for embedding and cmd build)
COPY . .

# Ensure the built frontend from the frontend-builder stage is present at the embed path inside the repo before building
RUN mkdir -p src/simple-traces/backend/frontend/dist
COPY --from=frontend-builder /app/src/simple-traces/backend/frontend/dist/ ./src/simple-traces/backend/frontend/dist/

# Build the application with CGO enabled for SQLite from the repo root
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o /app/simple-traces .

########## Stage 3: Final runtime image ##########
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
