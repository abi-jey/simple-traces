########## Stage 1: Build frontend ##########
FROM node:lts-alpine AS frontend-builder

WORKDIR /app

# Copy root package files and vite config
COPY package*.json ./
COPY vite.config.js ./

# Copy frontend source code
COPY src/simple-traces/frontend ./src/simple-traces/frontend

# Install and build
RUN npm ci && npm run build

########## Stage 2: Build Go backend with embedded frontend ##########
FROM golang:1.21-alpine AS go-builder

WORKDIR /app

# Install build dependencies for CGO
RUN apk add --no-cache gcc musl-dev

# Copy root Go module files and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy backend source code
COPY src/simple-traces/backend/*.go ./src/simple-traces/backend/

# Copy the built frontend from frontend-builder stage to the expected embed path
COPY --from=frontend-builder /app/dist ./src/simple-traces/backend/frontend/dist

# Build the application with CGO enabled for SQLite
RUN cd src/simple-traces/backend && CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o /app/simple-traces .

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
