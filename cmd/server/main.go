package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"routeworkbench/internal/app"
)

func main() {
	config := app.Config{JSKey: os.Getenv("AMAP_JS_KEY"), SecurityCode: os.Getenv("AMAP_JS_SECURITY_CODE"), WebKey: os.Getenv("AMAP_WEB_SERVICE_KEY"), ProxyToken: os.Getenv("GO_PROXY_TOKEN")}
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = ":8080"
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
	slog.Info("route workbench listening", "address", address, "mapConfigured", config.JSKey != "" && config.SecurityCode != "", "routingConfigured", config.WebKey != "")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
