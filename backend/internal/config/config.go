// Package config reads runtime settings from the environment.
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Listen        string // LISTEN_ADDR, default :8081
	AdminEmail    string // ADMIN_EMAIL
	AdminPassword string // ADMIN_PASSWORD (server-side env only)
	ArcadeURL     string // ARCADEDB_URL; empty = memory only (data lost on restart)
	ArcadeDB      string // ARCADEDB_DATABASE, default braintown
	ArcadeUser    string // ARCADEDB_USER
	ArcadePass    string // ARCADEDB_PASSWORD
	PublicURL     string // PUBLIC_URL, https => Secure cookies
	Mode          string // BRAIN_TOWN_MODE: demo | prod
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
	}
	if c.AdminEmail == "" || c.AdminPassword == "" {
		return c, errors.New("ADMIN_EMAIL and ADMIN_PASSWORD must be set")
	}
	if c.Mode == "prod" && c.ArcadeURL == "" {
		return c, errors.New("ARCADEDB_URL must be set when BRAIN_TOWN_MODE=prod (memory-only storage would lose events)")
	}
	return c, nil
}

func (c Config) SecureCookies() bool { return strings.HasPrefix(c.PublicURL, "https://") }

func get(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
