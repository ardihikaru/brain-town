// Package config reads runtime settings from the environment.
package config

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Listen        string  // LISTEN_ADDR, default :8081
	AdminEmail    string  // ADMIN_EMAIL
	AdminPassword string  // ADMIN_PASSWORD (server-side env only)
	ArcadeURL     string  // ARCADEDB_URL; empty = memory only (data lost on restart)
	ArcadeDB      string  // ARCADEDB_DATABASE, default braintown
	ArcadeUser    string  // ARCADEDB_USER
	ArcadePass    string  // ARCADEDB_PASSWORD
	PublicURL     string  // PUBLIC_URL, https => Secure cookies
	Mode          string  // BRAIN_TOWN_MODE: demo | prod
	IngestRate    float64 // INGEST_RATE: events per second per integration (default 50)
	IngestBurst   float64 // INGEST_BURST: burst size per integration (default 200)
	SecretKey     []byte  // BRAIN_TOWN_SECRET_KEY: base64, 32 bytes; encrypts GitHub webhook secrets (required in prod)
	FeedInterval  int     // FEED_PULL_INTERVAL_SECONDS: how often site JSON Feeds are pulled (default 300)
}

func Load() (Config, error) {
	c := Config{
		Listen:        get("LISTEN_ADDR", ":8081"),
		AdminEmail:    os.Getenv("ADMIN_EMAIL"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		ArcadeURL:     os.Getenv("ARCADEDB_URL"),
		ArcadeDB:      get("ARCADEDB_DATABASE", "braintown"),
		ArcadeUser:    os.Getenv("ARCADEDB_USER"),
		ArcadePass:    os.Getenv("ARCADEDB_PASSWORD"),
		PublicURL:     get("PUBLIC_URL", "http://127.0.0.1:8080"),
		Mode:          get("BRAIN_TOWN_MODE", "demo"),
		IngestRate:    getFloat("INGEST_RATE", 50),
		IngestBurst:   getFloat("INGEST_BURST", 200),
		FeedInterval:  int(getFloat("FEED_PULL_INTERVAL_SECONDS", 300)),
	}
	if c.AdminEmail == "" || c.AdminPassword == "" {
		return c, errors.New("ADMIN_EMAIL and ADMIN_PASSWORD must be set")
	}
	if at := strings.Index(c.AdminEmail, "@"); at < 1 || at == len(c.AdminEmail)-1 {
		return c, errors.New("ADMIN_EMAIL must be an email address, for example me@mfardiansyah.id")
	}
	if c.Mode == "prod" && c.ArcadeURL == "" {
		return c, errors.New("ARCADEDB_URL must be set when BRAIN_TOWN_MODE=prod (memory-only storage would lose events)")
	}
	key, err := loadSecretKey(os.Getenv("BRAIN_TOWN_SECRET_KEY"), c.Mode == "prod")
	if err != nil {
		return c, err
	}
	c.SecretKey = key
	return c, nil
}

// loadSecretKey decodes the key. When empty it fails in prod and otherwise returns a random per-process key.
func loadSecretKey(v string, prod bool) ([]byte, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		if prod {
			return nil, errors.New("BRAIN_TOWN_SECRET_KEY must be set when BRAIN_TOWN_MODE=prod (generate one with: openssl rand -base64 32)")
		}
		k := make([]byte, 32)
		if _, err := rand.Read(k); err != nil {
			return nil, err
		}
		log.Print("BRAIN_TOWN_SECRET_KEY is empty: using a random key for this process; GitHub webhook secrets created now stop working after a restart")
		return k, nil
	}
	k, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		if k, err = base64.RawStdEncoding.DecodeString(v); err != nil {
			return nil, errors.New("BRAIN_TOWN_SECRET_KEY must be base64 (openssl rand -base64 32)")
		}
	}
	if len(k) != 32 {
		return nil, errors.New("BRAIN_TOWN_SECRET_KEY must decode to exactly 32 bytes (openssl rand -base64 32)")
	}
	return k, nil
}

func (c Config) SecureCookies() bool { return strings.HasPrefix(c.PublicURL, "https://") }

func get(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getFloat(k string, def float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(k), 64); err == nil && v > 0 {
		return v
	}
	return def
}
