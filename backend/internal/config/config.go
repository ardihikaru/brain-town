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
	DataFile      string // DATA_FILE, JSON snapshot path; empty = memory only
	PublicURL     string // PUBLIC_URL, https => Secure cookies
	Mode          string // BRAIN_TOWN_MODE: demo | prod
}

func Load() (Config, error) {
	c := Config{
		Listen:        get("LISTEN_ADDR", ":8081"),
		AdminEmail:    os.Getenv("ADMIN_EMAIL"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		DataFile:      os.Getenv("DATA_FILE"),
		PublicURL:     get("PUBLIC_URL", "http://127.0.0.1:8080"),
		Mode:          get("BRAIN_TOWN_MODE", "demo"),
	}
	if c.AdminEmail == "" || c.AdminPassword == "" {
		return c, errors.New("ADMIN_EMAIL and ADMIN_PASSWORD must be set")
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
