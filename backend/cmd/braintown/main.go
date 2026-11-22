// Command braintown runs the Brain Town back-office API: admin API, ingest and SSE streams.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/admin"
	"github.com/ardihikaru/brain-town/backend/internal/config"
	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/ingest"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	st := openStore(cfg)
	h := hub.New()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok\n")) })
	mux.Handle("POST /ingest/{kind}/{id}", ingest.New(st, h))
	admin.New(st, h, cfg).Routes(mux)

	srv := &http.Server{Addr: cfg.Listen, Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 2 * time.Minute}
	stop := make(chan struct{})
	go st.Run(stop)
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		close(stop)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	log.Printf("braintown api on %s (mode=%s)", cfg.Listen, cfg.Mode)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// openStore connects to ArcadeDB (retrying while it starts) or falls back to memory.
func openStore(cfg config.Config) *store.Store {
	if cfg.ArcadeURL == "" {
		log.Print("ARCADEDB_URL is empty: events are kept in memory only and are lost on restart")
		st, _ := store.New(nil)
		return st
	}
	p := store.NewArcade(cfg.ArcadeURL, cfg.ArcadeDB, cfg.ArcadeUser, cfg.ArcadePass)
	var lastErr error
	for i := 0; i < 30; i++ {
		st, err := store.New(p)
		if err == nil {
			log.Printf("ArcadeDB ready (%s, database %s)", cfg.ArcadeURL, cfg.ArcadeDB)
			return st
		}
		lastErr = err
		log.Printf("ArcadeDB not ready (%v), retrying", err)
		time.Sleep(2 * time.Second)
	}
	log.Fatalf("ArcadeDB unavailable: %v", lastErr)
	return nil
}
