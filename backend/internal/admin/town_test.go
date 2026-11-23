package admin_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestTownPublicSnapshot(t *testing.T) {
	e := newEnv(t) // no login: the endpoint is public
	g := e.st.CreateSecretIntegration("github", "g", "alice", "s", "h")
	e.st.AdoptOwnerType(g.ID, "user")
	e.st.RegisterProduct("alice", "brain-town", "github", false)
	e.st.RegisterProduct("alice", "private-repo", "github", true)

	req, _ := http.NewRequest("GET", e.srv.URL+"/api/town", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("%d %v", resp.StatusCode, resp.Header)
	}
	code, m, body := e.do("GET", "/api/town", "", "")
	if code != 200 || strings.Contains(string(body), "private-repo") {
		t.Fatalf("%d %s", code, body)
	}
	t.Logf("%s", body)
	if o := m["owners"].([]any); len(o) != 1 {
		t.Fatalf("%s", body)
	}
	if c, _, _ := e.do("POST", "/api/town", "", ""); c != 405 {
		t.Errorf("POST: %d", c)
	}
}
