FROM golang:1.26.5-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go tool templ generate && CGO_ENABLED=0 go build -tags nomsgpack -trimpath -ldflags='-s -w' -o /jicheng ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=builder /jicheng /app/jicheng
USER app
ENV LISTEN_ADDR=:8080
EXPOSE 8080
CMD ["/app/jicheng"]
