package admin_test

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/admin"
	"github.com/ardihikaru/brain-town/backend/internal/config"
	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/ingest"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

// testPW is random per run so no password literal lives in the repo.
var testPW = func() string { b := make([]byte, 12); _, _ = rand.Read(b); return hex.EncodeToString(b) }()

var testKey = func() []byte { b := make([]byte, 32); _, _ = rand.Read(b); return b }()

type env struct {
	st  *store.Store
	t   *testing.T
	srv *httptest.Server
	cl  *http.Client
}

func newEnv(t *testing.T) *env { return newEnvLimits(t, 0, 0) }

func newEnvLimits(t *testing.T, rate, burst float64) *env {
	st, err := store.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	h := hub.New()
	mux := http.NewServeMux()
	mux.Handle("POST /ingest/{kind}/{id}", ingest.New(st, h, rate, burst))
	admin.New(st, h, config.Config{AdminEmail: "a@x.id", AdminPassword: testPW, PublicURL: "http://x", SecretKey: testKey}).Routes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{st, t, srv, srv.Client()}
}

func (e *env) do(method, path, token, body string, hdr ...string) (int, map[string]any, []byte) {
	req, _ := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	resp, err := e.cl.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	var buf strings.Builder
	_, _ = bufio.NewReader(resp.Body).WriteTo(&buf)
	var m map[string]any
	_ = json.Unmarshal([]byte(buf.String()), &m)
	return resp.StatusCode, m, []byte(buf.String())
}

func (e *env) login() {
	jar, _ := cookieJar()
	e.cl = &http.Client{Jar: jar}
	if c, _, _ := e.do("POST", "/api/admin/login", "", `{"email":"a@x.id","password":"`+testPW+`"}`); c != 200 {
		e.t.Fatalf("login status %d", c)
	}
}

func (e *env) integration(kind, name string) (id, token string) {
	c, m, _ := e.do("POST", "/api/admin/integrations", "", `{"kind":"`+kind+`","name":"`+name+`"}`)
	if c != 201 {
		e.t.Fatalf("create integration %d", c)
	}
	i := m["integration"].(map[string]any)
	return i["id"].(string), m["token"].(string)
}

const gaosEv = `{"id":"e1","type":"task.created","at":"2026-11-21T09:00:00Z","product":{"key":"demo","name":"Demo","visibility":"public"},"task":{"id":"T-1","title":"Secret title","kind":"feature","column":"backlog"}}`

func TestAdminRequiresLoginAndRejectsBadPassword(t *testing.T) {
	e := newEnv(t)
	if c, _, _ := e.do("GET", "/api/admin/integrations", "", ""); c != 401 {
		t.Fatalf("want 401 got %d", c)
	}
	if c, _, _ := e.do("POST", "/api/admin/login", "", `{"email":"a@x.id","password":"`+testPW+`x"}`); c != 401 {
		t.Fatalf("want 401 got %d", c)
	}
}

func TestIngestStatusCodes(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	url := "/ingest/gaos/" + id

	cases := []struct {
		name, token, body string
		want              int
	}{
		{"accepted", tok, gaosEv, 202},
		{"duplicate", tok, gaosEv, 409},
		{"bad token", "bt_live_wrong", gaosEv, 401},
		{"no token", "", gaosEv, 401},
		{"bad json", tok, `nope`, 422},
		{"missing product key", tok, `{"id":"e2","type":"task.created","at":"2026-11-21T09:00:00Z","product":{"visibility":"public"},"task":{"id":"T"}}`, 422},
		{"bad time", tok, `{"id":"e3","type":"task.created","at":"yesterday","product":{"key":"d","visibility":"public"},"task":{"id":"T"}}`, 422},
		{"unknown type", tok, `{"id":"e4","type":"nope","at":"2026-11-21T09:00:00Z","product":{"key":"d","visibility":"public"}}`, 422},
	}
	for _, c := range cases {
		if got, _, _ := e.do("POST", url, c.token, c.body); got != c.want {
			t.Errorf("%s: want %d got %d", c.name, c.want, got)
		}
	}
	if c, _, _ := e.do("POST", "/ingest/gaos/unknown", tok, gaosEv); c != 401 {
		t.Errorf("unknown integration: want 401 got %d", c)
	}
	if c, _, _ := e.do("POST", "/ingest/qa/"+id, tok, gaosEv); c != 401 {
		t.Errorf("wrong kind: want 401 got %d", c)
	}
}

func TestIdempotencyKeyHeaderDedupes(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	b2 := strings.Replace(gaosEv, `"id":"e1"`, `"id":"other"`, 1)
	if c, _, _ := e.do("POST", "/ingest/gaos/"+id, tok, gaosEv, "Idempotency-Key", "k1"); c != 202 {
		t.Fatal(c)
	}
	if c, _, _ := e.do("POST", "/ingest/gaos/"+id, tok, b2, "Idempotency-Key", "k1"); c != 409 {
		t.Fatalf("same key should be 409, got %d", c)
	}
}

func eventN(i int) string {
	return strings.Replace(gaosEv, `"id":"e1"`, fmt.Sprintf(`"id":"n%d"`, i), 1)
}

func TestRateLimit429WhenBurstExceeded(t *testing.T) {
	e := newEnvLimits(t, 1, 5) // 1 event/s sustained, burst of 5
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	var got []int
	for i := 0; i < 8; i++ {
		c, _, _ := e.do("POST", "/ingest/gaos/"+id, tok, eventN(i))
		got = append(got, c)
	}
	for i, c := range got {
		want := 202
		if i >= 5 {
			want = 429
		}
		if c != want {
			t.Fatalf("request %d: want %d got %d (all: %v)", i, want, c, got)
		}
	}
}

func TestDefaultLimitAllowsBulkBurst(t *testing.T) {
	e := newEnv(t) // defaults: 50/s, burst 200, so a 150-event migration is not throttled
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	for i := 0; i < 150; i++ {
		if c, _, _ := e.do("POST", "/ingest/gaos/"+id, tok, eventN(i)); c != 202 {
			t.Fatalf("event %d got %d", i, c)
		}
	}
}

func TestTokenRotationInvalidatesOldToken(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, old := e.integration("gaos", "GAOS")
	_, m, _ := e.do("POST", "/api/admin/integrations/"+id+"/token", "", "")
	fresh := m["token"].(string)
	if c, _, _ := e.do("POST", "/ingest/gaos/"+id, old, gaosEv); c != 401 {
		t.Fatalf("old token: want 401 got %d", c)
	}
	if c, _, _ := e.do("POST", "/ingest/gaos/"+id, fresh, gaosEv); c != 202 {
		t.Fatalf("new token: want 202 got %d", c)
	}
	// the list never returns token material
	_, _, raw := e.do("GET", "/api/admin/integrations", "", "")
	if strings.Contains(string(raw), "tokenHash") || strings.Contains(string(raw), fresh) {
		t.Fatal("integration list leaks token material")
	}
}

func TestSiteVisitStripsExtraFields(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("site", "Site")
	body := `{"id":"v1","type":"site.visit","at":"2026-11-22T00:14:03Z","data":{"page":"blog","country":"JP","ip":"1.2.3.4","ua":"x"}}`
	if c, _, _ := e.do("POST", "/ingest/site/"+id, tok, body); c != 202 {
		t.Fatal(c)
	}
	_, _, raw := e.do("GET", "/api/admin/events", "", "")
	if strings.Contains(string(raw), "1.2.3.4") {
		t.Fatal("ip stored")
	}
	if c, _, _ := e.do("POST", "/ingest/site/"+id, tok, strings.Replace(strings.Replace(body, `"v1"`, `"v2"`, 1), `"JP"`, `"jp"`, 1)); c != 422 {
		t.Fatalf("lowercase country: want 422 got %d", c)
	}
}

func TestHiddenOrgIsMaskedInPublicStream(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("qa", "QA")
	ev := func(id, typ string) string {
		return `{"id":"` + id + `","type":"` + typ + `","at":"2026-11-21T09:00:00Z","product":"sipreport","org":"sismedika","run":"r1","data":{"spec":"login.spec.ts","step":"Sign in","index":1,"status":"passed"}}`
	}
	if c, _, _ := e.do("POST", "/ingest/qa/"+id, tok, ev("q1", "qa.step")); c != 202 {
		t.Fatal(c)
	}
	if c, _, _ := e.do("PUT", "/api/admin/orgs/sismedika", "", `{"visibility":"hidden"}`); c != 200 {
		t.Fatal(c)
	}
	// public stream: replay from the start
	req, _ := http.NewRequest("GET", e.srv.URL+"/events", nil)
	req.Header.Set("Last-Event-ID", "0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	// replay only happens when Last-Event-ID > 0, so send a second event and read it live
	go func() {
		time.Sleep(100 * time.Millisecond)
		e.do("POST", "/ingest/qa/"+id, tok, ev("q2", "qa.step"))
	}()
	sc := bufio.NewScanner(resp.Body)
	var data string
	deadline := time.After(3 * time.Second)
	done := make(chan struct{})
	go func() {
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), "data: ") {
				data = sc.Text()
				close(done)
				return
			}
		}
	}()
	select {
	case <-done:
	case <-deadline:
		t.Fatal("no SSE event")
	}
	for _, leak := range []string{"sismedika", "sipreport", "Sign in", "login.spec.ts"} {
		if strings.Contains(data, leak) {
			t.Errorf("public stream leaks %q: %s", leak, data)
		}
	}
	if !strings.Contains(data, "Org A") {
		t.Errorf("expected alias Org A in %s", data)
	}
	// admin view still shows raw
	_, _, raw := e.do("GET", "/api/admin/events", "", "")
	if !strings.Contains(string(raw), "sipreport") {
		t.Error("admin view lost raw payload")
	}
}

func TestSSEReplayFromLastEventID(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	for _, n := range []string{"a1", "a2", "a3"} {
		e.do("POST", "/ingest/gaos/"+id, tok, strings.Replace(gaosEv, `"e1"`, `"`+n+`"`, 1))
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/events", nil)
	req.Header.Set("Last-Event-ID", "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	sc := bufio.NewScanner(resp.Body)
	ids := []string{}
	for sc.Scan() && len(ids) < 2 {
		if strings.HasPrefix(sc.Text(), "id: ") {
			ids = append(ids, strings.TrimPrefix(sc.Text(), "id: "))
		}
	}
	if len(ids) != 2 || ids[0] != "2" || ids[1] != "3" {
		t.Fatalf("replay ids = %v, want [2 3]", ids)
	}
}

func TestVisibilityAndSettingsValidation(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	e.do("POST", "/ingest/gaos/"+id, tok, gaosEv)
	if c, _, _ := e.do("PUT", "/api/admin/products/demo", "", `{"visibility":"secret"}`); c != 422 {
		t.Fatalf("want 422 got %d", c)
	}
	c, m, _ := e.do("PUT", "/api/admin/products/demo", "", `{"visibility":"hidden"}`)
	if c != 200 || m["alias"] != "Product A" {
		t.Fatalf("hidden product: %d %v", c, m)
	}
	c, m, _ = e.do("PUT", "/api/admin/settings", "", `{"retentionDays":0,"animation":true}`)
	if c != 200 || m["retentionDays"].(float64) != 1 {
		t.Fatalf("settings clamp: %d %v", c, m)
	}
}
