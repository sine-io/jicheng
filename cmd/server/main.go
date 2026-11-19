package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"jicheng/internal/app"
)

func main() {
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	config, err := app.LoadConfig(".env")
	if err != nil {
		slog.Error("could not read .env map settings")
		os.Exit(1)
	}
	host, _, _ := net.SplitHostPort(address)
	if net.ParseIP(host).IsLoopback() {
		config.LocalEnvFile = ".env"
	}
	server := &http.Server{Addr: address, Handler: app.New(config, nil).Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 3 * time.Minute, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-stopped
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	slog.Info("jicheng listening", "address", address, "mapConfigured", config.JSKey != "" && config.SecurityCode != "", "routingConfigured", config.WebKey != "")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
