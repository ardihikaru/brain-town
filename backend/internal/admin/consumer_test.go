package admin_test

import (
	"bufio"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// The consumer stream is the downstream reader's path: a scoped bearer token,
// the stored envelope rather than the public view, and a stream that stays
// inside the scope it was given.

func consumerToken(t *testing.T, e *env, name, scope string) (id, token string) {
	t.Helper()
	c, m, _ := e.do("POST", "/api/admin/consumers", "", `{"name":"`+name+`","scope":`+scope+`}`)
	if c != 201 {
		t.Fatalf("create consumer: %d %v", c, m)
	}
	cons := m["consumer"].(map[string]any)
	tok, _ := m["token"].(string)
	if tok == "" {
		t.Fatal("the token must be returned once")
	}
	if cons["tokenHint"] == nil {
		t.Error("the consumer must carry a token hint")
	}
	return cons["id"].(string), tok
}

// readStream reads SSE frames from a path until it has seen want data frames
// or the deadline passes. It returns the raw data lines.
func readStream(t *testing.T, e *env, path, token string, want int, headers ...string) []string {
	t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	var out []string
	sc := bufio.NewScanner(resp.Body)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "data: ") {
				out = append(out, strings.TrimPrefix(line, "data: "))
				if len(out) >= want {
					return
				}
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}
	return out
}

func TestConsumerStreamNeedsAToken(t *testing.T) {
	e := newEnv(t)
	if c, _, _ := e.do("GET", "/consumer/events", "", ""); c != 401 {
		t.Fatalf("no token must be 401, got %d", c)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/consumer/events", nil)
	req.Header.Set("Authorization", "Bearer bt_c_not-a-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("a wrong token must be 401, got %d", resp.StatusCode)
	}
}

func TestConsumerStreamIsScopedToItsOwnRepos(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("qa", "QA")
	_, ctoken := consumerToken(t, e, "gaos", `{"kinds":["qa"],"repos":["mine"]}`)

	ev := func(eid, product string) string {
		return `{"id":"` + eid + `","type":"qa.step","at":"2026-11-21T09:00:00Z","product":"` + product + `","org":"sismedika","run":"r1","data":{"status":"passed"}}`
	}
	if c, _, _ := e.do("POST", "/ingest/qa/"+id, tok, ev("q1", "mine")); c != 202 {
		t.Fatal(c)
	}
	if c, _, _ := e.do("POST", "/ingest/qa/"+id, tok, ev("q2", "theirs")); c != 202 {
		t.Fatal(c)
	}

	frames := readStream(t, e, "/consumer/events?replay=10", ctoken, 1)
	if len(frames) != 1 {
		t.Fatalf("the consumer must see exactly its own event, got %d frames", len(frames))
	}
	if !strings.Contains(frames[0], `"mine"`) {
		t.Errorf("the consumer frame must carry its own product: %s", frames[0])
	}
	if strings.Contains(frames[0], "theirs") {
		t.Errorf("the consumer must not see an event outside its scope: %s", frames[0])
	}
}

func TestConsumerSeesTheRealNameWhereThePublicStreamIsMasked(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("qa", "QA")
	_, ctoken := consumerToken(t, e, "gaos", `{"kinds":["qa"],"repos":["sipreport"]}`)

	ev := `{"id":"q1","type":"qa.step","at":"2026-11-21T09:00:00Z","product":"sipreport","org":"sismedika","run":"r1","task":{"id":"T-1","title":"A real title","kind":"feature","column":"backlog"},"data":{"status":"passed"}}`
	if c, _, _ := e.do("POST", "/ingest/qa/"+id, tok, ev); c != 202 {
		t.Fatal(c)
	}
	// Hide the product: the public stream must now mask it.
	if c, _, _ := e.do("PUT", "/api/admin/products/sipreport", "", `{"visibility":"hidden"}`); c != 200 {
		t.Fatal(c)
	}

	// The public stream: masked.
	pub := readStream(t, e, "/events?replay=10", "", 1)
	if len(pub) != 1 {
		t.Fatalf("the public stream must carry the event, got %d frames", len(pub))
	}
	if strings.Contains(pub[0], "sipreport") {
		t.Errorf("the public stream must not name a hidden product: %s", pub[0])
	}
	if strings.Contains(pub[0], "A real title") {
		t.Errorf("the public stream must not carry a hidden title: %s", pub[0])
	}

	// The consumer stream: the real name and the real title.
	frames := readStream(t, e, "/consumer/events?replay=10", ctoken, 1)
	if len(frames) != 1 {
		t.Fatalf("the consumer must see the event, got %d frames", len(frames))
	}
	if !strings.Contains(frames[0], "sipreport") {
		t.Errorf("the consumer must see the real product name: %s", frames[0])
	}
	if !strings.Contains(frames[0], "A real title") {
		t.Errorf("the consumer must see the real title: %s", frames[0])
	}
	// The frame carries the routing metadata a consumer needs, in the public
	// frame's own shape.
	var m map[string]any
	if err := json.Unmarshal([]byte(frames[0]), &m); err != nil {
		t.Fatalf("the frame must be JSON: %v", err)
	}
	for _, k := range []string{"seq", "source", "type", "id", "at", "payload"} {
		if _, ok := m[k]; !ok {
			t.Errorf("the frame must carry %q: %s", k, frames[0])
		}
	}
}

func TestRotatedConsumerTokenStopsWorking(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, _ := consumerToken(t, e, "gaos", `{"kinds":["qa"]}`)

	c, m, _ := e.do("POST", "/api/admin/consumers/"+id+"/token", "", "")
	if c != 200 {
		t.Fatalf("rotate: %d", c)
	}
	newTok, _ := m["token"].(string)
	if newTok == "" {
		t.Fatal("a rotation must return a new token")
	}
	// The old token is gone; the new one works.
	if frames := readStream(t, e, "/consumer/events", newTok, 0); frames != nil {
		t.Error("a fresh stream must not fail")
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/consumer/events", nil)
	req.Header.Set("Authorization", "Bearer "+newTok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("the new token must work, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestDeletedConsumerIsRefused(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, token := consumerToken(t, e, "gaos", `{"kinds":["qa"]}`)
	if c, _, _ := e.do("DELETE", "/api/admin/consumers/"+id, "", ""); c != 200 {
		t.Fatalf("delete: %d", c)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/consumer/events", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("a deleted consumer's token must be refused, got %d", resp.StatusCode)
	}
}

func TestConsumerAdminSurfaces(t *testing.T) {
	e := newEnv(t)
	if c, _, _ := e.do("GET", "/api/admin/consumers", "", ""); c != 401 {
		t.Fatalf("the list must need a session, got %d", c)
	}
	e.login()
	id, token := consumerToken(t, e, "gaos", `{"kinds":["github"],"types":["pr.opened"]}`)

	c, m, _ := e.do("GET", "/api/admin/consumers", "", "")
	if c != 200 {
		t.Fatalf("list: %d", c)
	}
	list := m["consumers"].([]any)
	if len(list) != 1 {
		t.Fatalf("consumers = %d", len(list))
	}
	if strings.Contains(mustJSON(t, list), token) {
		t.Error("the list must not carry the token")
	}
	if strings.Contains(mustJSON(t, list), `"tokenHash"`) {
		t.Error("the list must not carry the token hash")
	}

	// A duplicate name is 409.
	if c, _, _ := e.do("POST", "/api/admin/consumers", "", `{"name":"gaos","scope":{}}`); c != 409 {
		t.Fatalf("a duplicate name must be 409, got %d", c)
	}
	// An update replaces the scope.
	if c, _, _ := e.do("PATCH", "/api/admin/consumers/"+id, "", `{"name":"gaos-2","scope":{"types":["pr.merged"]}}`); c != 200 {
		t.Fatalf("update: %d", c)
	}
	// An unknown consumer is 404.
	if c, _, _ := e.do("PATCH", "/api/admin/consumers/btc-nope", "", `{"name":"x","scope":{}}`); c != 404 {
		t.Fatalf("an unknown consumer must be 404, got %d", c)
	}
	// A bad name is 422.
	if c, _, _ := e.do("POST", "/api/admin/consumers", "", `{"name":"","scope":{}}`); c != 422 {
		t.Fatalf("an empty name must be 422, got %d", c)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
