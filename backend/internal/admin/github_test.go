package admin_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ardihikaru/brain-town/backend/internal/admin"
	"github.com/ardihikaru/brain-town/backend/internal/config"
	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

func TestGithubCreateRotateAndReveal(t *testing.T) {
	e := newEnv(t)
	e.login()
	c, m, _ := e.do("POST", "/api/admin/integrations", "", `{"kind":"github","name":"GitHub","org":"acme"}`)
	if c != 201 {
		t.Fatalf("create: %d", c)
	}
	i := m["integration"].(map[string]any)
	id, sec := i["id"].(string), m["token"].(string)
	if !strings.HasPrefix(sec, "whsec_") || len(sec) < 40 {
		t.Fatalf("secret shape: %q", sec)
	}
	if m["ingestPath"] != "/ingest/github/"+id {
		t.Errorf("ingestPath = %v", m["ingestPath"])
	}
	if i["tokenHint"] != sec[len(sec)-4:] {
		t.Errorf("tokenHint = %v", i["tokenHint"])
	}
	if got, _ := e.st.Lookup(id); got.TokenHash != "" || got.SecretEnc == "" || strings.Contains(got.SecretEnc, sec) {
		t.Fatalf("stored: hash=%q enc=%q", got.TokenHash, got.SecretEnc)
	}

	c, m, _ = e.do("GET", "/api/admin/integrations/"+id+"/secret", "", "")
	if c != 200 || m["secret"] != sec {
		t.Fatalf("reveal: %d %v", c, m)
	}
	// Cache-Control: no-store
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/admin/integrations/"+id+"/secret", nil)
	resp, _ := e.cl.Do(req)
	resp.Body.Close()
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", resp.Header.Get("Cache-Control"))
	}

	// List and detail never carry the sealed secret or the hash, and carry events.
	_, _, raw := e.do("GET", "/api/admin/integrations", "", "")
	for _, bad := range []string{"secretEnc", "tokenHash", sec} {
		if strings.Contains(string(raw), bad) {
			t.Errorf("list leaks %q", bad)
		}
	}
	var list []map[string]any
	_ = json.Unmarshal(raw, &list)
	if ev, ok := list[0]["events"].([]any); !ok || len(ev) != 0 {
		t.Errorf("events = %#v, want []", list[0]["events"])
	}

	// Rotate: new secret, old gone, still no token hash.
	c, m, _ = e.do("POST", "/api/admin/integrations/"+id+"/token", "", "")
	sec2, _ := m["token"].(string)
	if c != 200 || !strings.HasPrefix(sec2, "whsec_") || sec2 == sec {
		t.Fatalf("rotate: %d %v", c, m)
	}
	if got, _ := e.st.Lookup(id); got.TokenHash != "" {
		t.Error("rotate set a TokenHash on a github integration")
	}
	if _, m, _ = e.do("GET", "/api/admin/integrations/"+id+"/secret", "", ""); m["secret"] != sec2 {
		t.Errorf("reveal after rotate = %v", m["secret"])
	}
}

func TestRevealSecretNotFoundAndUndecryptable(t *testing.T) {
	e := newEnv(t)
	e.login()
	qid, _ := e.integration("qa", "QA")
	for _, id := range []string{qid, "nope"} {
		if c, _, _ := e.do("GET", "/api/admin/integrations/"+id+"/secret", "", ""); c != 404 {
			t.Errorf("%s: want 404 got %d", id, c)
		}
	}
	// Needs a session.
	anon := newEnv(t)
	if c, _, _ := anon.do("GET", "/api/admin/integrations/x/secret", "", ""); c != 401 {
		t.Errorf("anonymous: want 401 got %d", c)
	}
	gid, _ := e.integration("github", "GH")

	// Same data, different key: the secret cannot be decrypted -> 503.
	other := make([]byte, 32)
	mux := http.NewServeMux()
	admin.New(e.st, hub.New(), config.Config{AdminEmail: "a@x.id", AdminPassword: testPW, PublicURL: "http://x", SecretKey: other}).Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	e2 := &env{e.st, t, srv, srv.Client()}
	e2.login()
	if c, _, _ := e2.do("GET", "/api/admin/integrations/"+gid+"/secret", "", ""); c != 503 {
		t.Errorf("wrong key: want 503 got %d", c)
	}
}

func TestIngestHandlerRejectsGithubBearer(t *testing.T) {
	e := newEnv(t)
	e.login()
	gid, sec := e.integration("github", "GH")
	// The generic ingest handler (no github route in this mux) never accepts a github integration.
	c, _, _ := e.do("POST", "/ingest/github/"+gid, sec, gaosEv)
	if c < 400 {
		t.Errorf("bearer post to github via generic ingest: got %d", c)
	}
	st, _ := store.New(nil)
	i := st.CreateSecretIntegration("github", "x", "", "enc", "abcd")
	if got, good := st.CheckToken(i.ID, ""); got == nil || good {
		t.Error("empty bearer must not match a github integration")
	}
}
