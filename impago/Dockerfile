FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git gcc musl-dev

WORKDIR /app

COPY go.mod ./
COPY go.sum* ./
RUN go mod download 2>/dev/null || true

COPY . .

RUN go mod tidy

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /impago ./cmd/impago

# ---

FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata ffmpeg

WORKDIR /app

COPY --from=builder /impago .

EXPOSE 8080

ENTRYPOINT ["./impago"]
