package config

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestAdminEmailMustBeAnAddress(t *testing.T) {
	for email, ok := range map[string]bool{"me@mfardiansyah.id": true, "adminardi": false, "@x.id": false, "me@": false} {
		t.Setenv("ADMIN_EMAIL", email)
		t.Setenv("ADMIN_PASSWORD", "x")
		if _, err := Load(); (err == nil) != ok {
			t.Errorf("ADMIN_EMAIL=%q: err=%v, want ok=%v", email, err, ok)
		}
	}
}

func baseEnv(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "me@mfardiansyah.id")
	t.Setenv("ADMIN_PASSWORD", "x")
	t.Setenv("BRAIN_TOWN_MODE", "demo")
	t.Setenv("ARCADEDB_URL", "")
	t.Setenv("BRAIN_TOWN_SECRET_KEY", "")
}

func TestSecretKey(t *testing.T) {
	good := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))
	short := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 16))
	long := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 33))
	for name, tc := range map[string]struct {
		key  string
		ok   bool
		want []byte
	}{
		"valid":      {good, true, bytes.Repeat([]byte{7}, 32)},
		"too short":  {short, false, nil},
		"too long":   {long, false, nil},
		"not base64": {"%%%not base64%%%", false, nil},
	} {
		baseEnv(t)
		t.Setenv("BRAIN_TOWN_SECRET_KEY", tc.key)
		c, err := Load()
		if (err == nil) != tc.ok {
			t.Errorf("%s: err=%v, want ok=%v", name, err, tc.ok)
		}
		if tc.ok && !bytes.Equal(c.SecretKey, tc.want) {
			t.Errorf("%s: wrong key", name)
		}
	}
}

func TestSecretKeyEmpty(t *testing.T) {
	baseEnv(t)
	c, err := Load()
	if err != nil || len(c.SecretKey) != 32 {
		t.Fatalf("demo mode with no key must generate one: %v len=%d", err, len(c.SecretKey))
	}
	c2, _ := Load()
	if bytes.Equal(c.SecretKey, c2.SecretKey) {
		t.Error("generated keys should differ")
	}
	baseEnv(t)
	t.Setenv("BRAIN_TOWN_MODE", "prod")
	t.Setenv("ARCADEDB_URL", "http://db:2480")
	if _, err := Load(); err == nil {
		t.Error("prod without BRAIN_TOWN_SECRET_KEY must fail")
	}
	t.Setenv("BRAIN_TOWN_SECRET_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	if _, err := Load(); err != nil {
		t.Errorf("prod with a valid key: %v", err)
	}
}
