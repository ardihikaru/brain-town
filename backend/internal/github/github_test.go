package github

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/ingest"
	"github.com/ardihikaru/brain-town/backend/internal/secret"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

type env struct {
	t      *testing.T
	st     *store.Store
	hub    *hub.Hub
	co     *Coalescer
	clk    *clock
	srv    *httptest.Server
	id     string
	secret string
	n      int
}

func newEnv(t *testing.T, org string) *env { return newEnvRate(t, org, 0, 0) }

func newEnvRate(t *testing.T, org string, rate, burst float64) *env {
	t.Helper()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	st, _ := store.New(nil)
	h := hub.New()
	clk := &clock{t: time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)}
	co := NewCoalescer(st, h, 15*time.Second, 1000, clk.Now)
	plain := "whsec_" + fmt.Sprint(time.Now().UnixNano())
	enc, err := secret.Seal(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	i := st.CreateSecretIntegration("github", "GitHub", org, enc, "abcd")
	mux := http.NewServeMux()
	// Same registration as main: the specific pattern must win over the generic one.
	mux.Handle("POST /ingest/github/{id}", New(st, h, key, rate, burst, co))
	mux.Handle("POST /ingest/{kind}/{id}", ingest.New(st, h, 0, 0))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, hub: h, co: co, clk: clk, srv: srv, id: i.ID, secret: plain}
}

func sign(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return "sha256=" + hex.EncodeToString(m.Sum(nil))
}

type opt func(*http.Request)

func hdr(k, v string) opt { return func(r *http.Request) { r.Header.Set(k, v) } }

// send posts a signed JSON delivery and returns the status and decoded response.
func (e *env) send(event, delivery string, payload any, opts ...opt) (int, map[string]string) {
	e.t.Helper()
	var body []byte
	if b, ok := payload.([]byte); ok {
		body = b
	} else {
		body, _ = json.Marshal(payload)
	}
	req, _ := http.NewRequest("POST", e.srv.URL+"/ingest/github/"+e.id, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", event)
	req.Header.Set("X-GitHub-Delivery", delivery)
	req.Header.Set("X-Hub-Signature-256", sign(e.secret, body))
	for _, o := range opts {
		o(req)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var m map[string]string
	_ = json.Unmarshal(b, &m)
	return resp.StatusCode, m
}

// ok sends a delivery with a fresh id and requires 202 accepted.
func (e *env) ok(event string, payload any) {
	e.t.Helper()
	e.n++
	if c, m := e.send(event, fmt.Sprintf("d-%d", e.n), payload); c != 202 || m["status"] != "accepted" {
		e.t.Fatalf("%s: want 202 accepted, got %d %v", event, c, m)
	}
}

func (e *env) events(typ string) []store.Event {
	var out []store.Event
	for _, ev := range e.st.Events(store.Query{Limit: 500, Delivery: store.OK}) {
		if typ == "" || ev.Type == typ {
			out = append(out, ev)
		}
	}
	return out
}

func (e *env) rejected() []store.Event {
	return e.st.Events(store.Query{Limit: 500, Delivery: store.Reject})
}

// one flushes open rollups and returns the single stored event of a type.
func (e *env) one(typ string) store.Event {
	e.t.Helper()
	e.co.FlushAll()
	evs := e.events(typ)
	if len(evs) != 1 {
		e.t.Fatalf("want 1 %s event, got %d", typ, len(evs))
	}
	return evs[0]
}

type M = map[string]any

func repo(name string, private bool) M {
	return M{"name": name, "private": private, "owner": M{"login": "Acme"}, "stargazers_count": 7}
}

func issue(n int, title string, extra M) M {
	m := M{"number": n, "title": title, "body": "", "labels": []any{M{"color": "d73a4a", "name": "bug"}}}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func TestSignature(t *testing.T) {
	e := newEnv(t, "")
	p := M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("r", false)}
	body, _ := json.Marshal(p)
	cases := []struct {
		name string
		opts []opt
		want int
	}{
		{"good", nil, 202},
		{"wrong", []opt{hdr("X-Hub-Signature-256", sign("whsec_other", body))}, 401},
		{"missing", []opt{hdr("X-Hub-Signature-256", "")}, 401},
		{"no prefix", []opt{hdr("X-Hub-Signature-256", strings.TrimPrefix(sign(e.secret, body), "sha256="))}, 401},
		{"not hex", []opt{hdr("X-Hub-Signature-256", "sha256=zz")}, 401},
		{"sha1 only", []opt{hdr("X-Hub-Signature-256", ""), hdr("X-Hub-Signature", "sha1=abc")}, 401},
	}
	for i, c := range cases {
		if got, _ := e.send("issues", fmt.Sprintf("s-%d", i), body, c.opts...); got != c.want {
			t.Errorf("%s: want %d got %d", c.name, c.want, got)
		}
	}
	if n := len(e.rejected()); n != 5 {
		t.Errorf("want 5 rejected log entries, got %d", n)
	}
	if got, _ := e.st.Lookup(e.id); got.LastRejectedAt.IsZero() {
		t.Error("LastRejectedAt not set")
	}
	// Unknown integration, and a non-github integration: 401 without logging.
	before := len(e.rejected())
	req, _ := http.NewRequest("POST", e.srv.URL+"/ingest/github/nope", bytes.NewReader(body))
	req.Header.Set("X-Hub-Signature-256", sign(e.secret, body))
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	qa, _ := e.st.CreateIntegration("qa", "q", "")
	req, _ = http.NewRequest("POST", e.srv.URL+"/ingest/github/"+qa.ID, bytes.NewReader(body))
	resp2, _ := http.DefaultClient.Do(req)
	resp2.Body.Close()
	if resp.StatusCode != 401 || resp2.StatusCode != 401 || len(e.rejected()) != before {
		t.Errorf("unknown/other integration: %d %d, rejected %d->%d", resp.StatusCode, resp2.StatusCode, before, len(e.rejected()))
	}
}

func TestBadKeyIs503(t *testing.T) {
	e := newEnv(t, "")
	mux := http.NewServeMux()
	mux.Handle("POST /ingest/github/{id}", New(e.st, e.hub, make([]byte, 32), 0, 0, e.co)) // different key
	srv := httptest.NewServer(mux)
	defer srv.Close()
	resp, _ := http.Post(srv.URL+"/ingest/github/"+e.id, "application/json", strings.NewReader("{}"))
	resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Errorf("want 503 got %d", resp.StatusCode)
	}
}

func TestContentTypeBodyAndHeaders(t *testing.T) {
	e := newEnv(t, "")
	p := M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("r", false)}
	form := func(v url.Values) []byte { return []byte(v.Encode()) }
	pj, _ := json.Marshal(p)
	fh := hdr("Content-Type", "application/x-www-form-urlencoded")
	if c, m := e.send("issues", "f1", form(url.Values{"payload": {string(pj)}}), fh); c != 202 {
		t.Errorf("form: want 202 got %d %v", c, m)
	}
	if got := e.events("issue.opened"); len(got) != 1 {
		t.Errorf("form delivery mapped to %d issue.opened events, want 1", len(got))
	}
	if c, m := e.send("issues", "f2", form(url.Values{"other": {"x"}}), fh); c != 422 || m["field"] != "payload" {
		t.Errorf("form without payload: %d %v", c, m)
	}
	before := len(e.rejected())
	if c, _ := e.send("issues", "f3", p, hdr("Content-Type", "text/plain")); c != 415 || len(e.rejected()) != before+1 {
		t.Errorf("text/plain: want 415 and one more rejection, got %d, rejected %d->%d", c, before, len(e.rejected()))
	}
	if c, _ := e.send("issues", "a", p, hdr("Content-Type", "application/json; charset=utf-8")); c != 202 {
		t.Errorf("json with charset: want 202 got %d", c)
	}
	big := bytes.Repeat([]byte("x"), 2<<20+10)
	if c, _ := e.send("issues", "b", big); c != 413 {
		t.Errorf("big body: want 413 got %d", c)
	}
	if c, m := e.send("issues", "", p); c != 422 || m["field"] != "X-GitHub-Delivery" {
		t.Errorf("no delivery: %d %v", c, m)
	}
	if c, m := e.send("", "c", p); c != 422 || m["field"] != "X-GitHub-Event" {
		t.Errorf("no event: %d %v", c, m)
	}
	if c, m := e.send("issues", "d", []byte("nope")); c != 422 || m["field"] != "body" {
		t.Errorf("bad json: %d %v", c, m)
	}
	if c, m := e.send("issues", "e", M{"action": "opened", "issue": issue(1, "t", nil)}); c != 422 || m["field"] != "repository" {
		t.Errorf("no repository: %d %v", c, m)
	}
}

func TestRouteSpecificPatternWins(t *testing.T) {
	e := newEnv(t, "")
	// A bearer post (what the generic handler wants) hits the github handler: its 401 text differs.
	req, _ := http.NewRequest("POST", e.srv.URL+"/ingest/github/"+e.id, strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer bt_live_x")
	resp, _ := http.DefaultClient.Do(req)
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 401 || !strings.Contains(string(b), "signature") {
		t.Errorf("github route not used: %d %s", resp.StatusCode, b)
	}
	// Other kinds still reach the generic handler.
	req, _ = http.NewRequest("POST", e.srv.URL+"/ingest/qa/x", strings.NewReader("{}"))
	resp, _ = http.DefaultClient.Do(req)
	b, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 401 || !strings.Contains(string(b), "token") {
		t.Errorf("generic route lost: %d %s", resp.StatusCode, b)
	}
}

func TestGenericIngestRefusesGithub(t *testing.T) {
	st, _ := store.New(nil)
	i := st.CreateSecretIntegration("github", "g", "", "enc", "abcd")
	mux := http.NewServeMux()
	mux.Handle("POST /ingest/{kind}/{id}", ingest.New(st, hub.New(), 0, 0)) // no github route
	srv := httptest.NewServer(mux)
	defer srv.Close()
	for _, tok := range []string{"", "bt_live_anything", i.TokenHint} {
		req, _ := http.NewRequest("POST", srv.URL+"/ingest/github/"+i.ID, strings.NewReader(`{"id":"1"}`))
		req.Header.Set("Authorization", "Bearer "+tok)
		resp, _ := http.DefaultClient.Do(req)
		resp.Body.Close()
		if resp.StatusCode < 400 {
			t.Errorf("token %q accepted: %d", tok, resp.StatusCode)
		}
	}
}

func TestOrgMismatchAndAdopt(t *testing.T) {
	e := newEnv(t, "acme")
	p := M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("r", false), "organization": M{"login": "Other"}}
	if c, m := e.send("issues", "1", p); c != 422 || m["field"] != "organization" {
		t.Errorf("mismatch: %d %v", c, m)
	}
	p["organization"] = M{"login": "ACME"} // case-insensitive
	if c, _ := e.send("issues", "2", p); c != 202 {
		t.Errorf("same org other case: %d", c)
	}
	// Falls back to repository.owner.login.
	delete(p, "organization")
	p["repository"] = M{"name": "r", "owner": M{"login": "someone"}}
	if c, _ := e.send("issues", "3", p); c != 422 {
		t.Errorf("owner mismatch: %d", c)
	}

	e2 := newEnv(t, "")
	p = M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("r", false), "organization": M{"login": "NewOrg"}}
	if c, _ := e2.send("issues", "1", p); c != 202 {
		t.Fatal(c)
	}
	if got, _ := e2.st.GetIntegration(e2.id); got.Org != "NewOrg" {
		t.Errorf("org not adopted: %q", got.Org)
	}
	if _, ok := e2.st.GetOrg("NewOrg"); !ok {
		t.Error("org not registered")
	}
	// An ignored delivery does not adopt.
	e3 := newEnv(t, "")
	if c, m := e3.send("issues", "1", M{"action": "deleted", "issue": issue(1, "t", nil), "repository": repo("r", false)}); c != 202 || m["status"] != "ignored" {
		t.Fatal(c, m)
	}
	if got, _ := e3.st.GetIntegration(e3.id); got.Org != "" {
		t.Errorf("ignored delivery adopted org %q", got.Org)
	}
}

func TestDedupe(t *testing.T) {
	e := newEnv(t, "")
	single := M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("r", false)}
	if c, _ := e.send("issues", "same", single); c != 202 {
		t.Fatal(c)
	}
	if c, _ := e.send("issues", "same", single); c != 409 {
		t.Errorf("single redelivery: want 409 got %d", c)
	}
	grouped := M{"action": "created", "issue": issue(1, "t", nil), "comment": M{"body": "secret text"}, "repository": repo("r", false), "sender": M{"type": "User", "login": "u"}}
	if c, _ := e.send("issue_comment", "g1", grouped); c != 202 {
		t.Fatal(c)
	}
	if c, _ := e.send("issue_comment", "g1", grouped); c != 409 {
		t.Errorf("grouped redelivery: want 409 got %d", c)
	}
	e.co.FlushAll()
	if ev := e.events("issue.commented"); len(ev) != 1 || ev[0].Raw["data"].(M)["count"] != 1 {
		t.Errorf("duplicate counted: %v", ev)
	}
	// After the flush the claim still holds.
	if c, _ := e.send("issue_comment", "g1", grouped); c != 409 {
		t.Errorf("after flush: want 409 got %d", c)
	}
	if got, _ := e.st.GetIntegration(e.id); got.LastEventAt.IsZero() {
		t.Error("LastEventAt not updated")
	}
}

func TestRateLimit(t *testing.T) {
	e := newEnvRate(t, "", 0.001, 2)
	p := M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("r", false)}
	var got []int
	for i := 0; i < 4; i++ {
		c, _ := e.send("issues", fmt.Sprintf("r-%d", i), p)
		got = append(got, c)
	}
	n429 := 0
	for _, c := range got {
		if c == 429 {
			n429++
		}
	}
	if n429 != 2 || got[0] != 202 || got[1] != 202 {
		t.Errorf("want [202 202 429 429] with burst 2, got %v", got)
	}
}

func hubNew() *hub.Hub { return hub.New() }

func TestEventsFromDeliveries(t *testing.T) {
	e := newEnv(t, "")
	evs := func() []string { i, _ := e.st.GetIntegration(e.id); return i.Events }
	e.ok("ping", M{"hook": M{"events": []any{"issues", "push"}}})
	e.send("star", "s1", M{"zen": "x"}) // ignored by the town, still proves the subscription
	e.ok("issues", M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("hall", false)})
	e.ok("issues", M{"action": "closed", "issue": issue(1, "t", nil), "repository": repo("hall", false)})
	if got := fmt.Sprint(evs()); got != "[issues push star]" {
		t.Errorf("events = %s", got)
	}
	// Duplicate delivery (409) still counts; a bad signature does not.
	if c, _ := e.send("fork", "dup", M{"repository": repo("hall", false)}); c != 202 {
		t.Fatal(c)
	}
	e.send("watch", "bad", M{}, hdr("X-Hub-Signature-256", "sha256=00"))
	if got := fmt.Sprint(evs()); got != "[issues push star fork]" {
		t.Errorf("events = %s", got)
	}
	// A new ping replaces the list, later deliveries add again.
	e.ok("ping", M{"hook": M{"events": []any{"check_run"}}})
	if got := fmt.Sprint(evs()); got != "[check_run]" {
		t.Errorf("after ping: %s", got)
	}
	e.send("release", "r1", M{"action": "published"})
	if got := fmt.Sprint(evs()); got != "[check_run release]" {
		t.Errorf("after delivery: %s", got)
	}
	for n := 0; n < 80; n++ {
		e.send(fmt.Sprintf("custom_%d", n), fmt.Sprintf("c%d", n), M{})
	}
	if n := len(evs()); n != store.MaxIntegrationEvents {
		t.Errorf("cap: %d", n)
	}
}

func TestPingPublishedLive(t *testing.T) {
	e := newEnv(t, "")
	ch, cancel := e.hub.Subscribe()
	defer cancel()
	e.ok("ping", M{"hook": M{"events": []any{"issues"}}})
	select {
	case ev := <-ch:
		d, _ := ev.Raw["data"].(M)
		if ev.Type != "ping" || ev.Delivery != store.OK || fmt.Sprint(d["events"]) != "[issues]" {
			t.Errorf("published: %+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ping was not published on the hub")
	}
	if got := e.events("ping"); len(got) != 1 {
		t.Errorf("stored pings: %d", len(got))
	}
}

// ciJob sends one workflow_job delivery for run 900; ciRun a workflow_run one.
func (e *env) ciJob(id int, action, concl string) {
	e.n++
	e.ok("workflow_job", M{"action": action, "workflow_job": M{"id": id, "run_id": 900, "workflow_name": "CI", "conclusion": concl}, "repository": repo("hall", false)})
}

func (e *env) ciRun(action, concl string) {
	e.ok("workflow_run", M{"action": action, "workflow_run": M{"id": 900, "name": "CI", "conclusion": concl, "pull_requests": []any{M{"number": 4}}}, "repository": repo("hall", false)})
}

func (e *env) window() { e.clk.Advance(16 * time.Second); e.co.FlushDue() }

func (e *env) lastCI() map[string]any {
	var last store.Event
	for _, ev := range e.events("ci.run") {
		if ev.Seq > last.Seq {
			last = ev
		}
	}
	return last.Raw["data"].(M)
}

func TestCIStateSpansThreeWindows(t *testing.T) {
	e := newEnv(t, "")
	e.ciRun("requested", "")
	e.ciJob(1, "queued", "")
	e.ciJob(2, "queued", "")
	e.ciJob(1, "queued", "") // redelivery of the same state does not double count
	e.window()
	if d := e.lastCI(); fmt.Sprint(d["jobs"]) != "map[done:0 failed:0 total:2]" || d["status"] != "queued" {
		t.Errorf("window 1: %v", d)
	}
	e.ciJob(1, "in_progress", "")
	e.ciJob(1, "completed", "success")
	e.window()
	if d := e.lastCI(); fmt.Sprint(d["jobs"]) != "map[done:1 failed:0 total:2]" || d["status"] != "running" || d["workflow"] != "CI" || d["pr"] != 4 {
		t.Errorf("window 2: %v", d)
	}
	e.ciJob(2, "in_progress", "")
	e.ciJob(2, "completed", "failure")
	e.window()
	if d := e.lastCI(); fmt.Sprint(d["jobs"]) != "map[done:2 failed:1 total:2]" || d["status"] != "failed" {
		t.Errorf("window 3: %v", d)
	}
	if n := len(e.events("ci.run")); n != 3 {
		t.Errorf("want 3 ci.run events, got %d", n)
	}
}

func TestLoneCompletedKeepsCounts(t *testing.T) {
	e := newEnv(t, "")
	e.ciJob(1, "completed", "success")
	e.ciJob(2, "completed", "success")
	e.window()
	e.ciRun("completed", "success") // alone in its window
	e.window()
	d := e.lastCI()
	if fmt.Sprint(d["jobs"]) != "map[done:2 failed:0 total:2]" || d["status"] != "passed" || d["workflow"] != "CI" || d["pr"] != 4 {
		t.Errorf("lone completed: %v", d)
	}
}

func TestRunCacheIsBounded(t *testing.T) {
	e := newEnv(t, "")
	for n := 0; n < MaxRuns+50; n++ {
		e.clk.Advance(time.Millisecond)
		e.co.Add(base{Integration: e.id, Repo: "r", Delivery: fmt.Sprint(n), At: e.clk.Now()},
			contrib{Type: "ci.run", Grouped: true, Subject: fmt.Sprint(n), Data: map[string]any{"run": n}, JobID: "j", JobStatus: "queued"})
	}
	if n := e.co.Runs(); n != MaxRuns {
		t.Errorf("runs = %d, want %d", n, MaxRuns)
	}
	// The oldest runs were evicted, the newest are kept.
	e.co.mu.Lock()
	_, oldest := e.co.runs[e.id+"\x00r\x00"+"0"]
	_, newest := e.co.runs[e.id+"\x00r\x00"+fmt.Sprint(MaxRuns+49)]
	e.co.mu.Unlock()
	if oldest || !newest {
		t.Errorf("eviction order wrong: oldest kept=%v newest kept=%v", oldest, newest)
	}
	// Idle entries expire after an hour.
	e.co.FlushAll()
	e.clk.Advance(RunTTL + time.Minute)
	e.co.FlushDue()
	if n := e.co.Runs(); n != 0 {
		t.Errorf("after TTL: %d", n)
	}
	// Job ids per run are bounded.
	for j := 0; j < MaxJobsPerRun+40; j++ {
		e.co.Add(base{Integration: e.id, Repo: "r", Delivery: "x", At: e.clk.Now()},
			contrib{Type: "ci.run", Grouped: true, Subject: "big", Data: map[string]any{"run": 1}, JobID: fmt.Sprint(j), JobStatus: "passed"})
	}
	e.co.mu.Lock()
	n := len(e.co.runs[e.id+"\x00r\x00big"].jobs)
	e.co.mu.Unlock()
	if n != MaxJobsPerRun {
		t.Errorf("jobs per run = %d", n)
	}
}

type failReader struct{ t *testing.T }

func (f failReader) Read([]byte) (int, error) {
	f.t.Error("body was read")
	return 0, io.EOF
}

func rawHandler(t *testing.T) (*Handler, *env) {
	e := newEnv(t, "")
	key := make([]byte, 32)
	return New(e.st, e.hub, key, 0, 0, e.co), e
}

func TestUnknownIntegrationDoesNotReadBody(t *testing.T) {
	h, _ := rawHandler(t)
	mux := http.NewServeMux()
	mux.Handle("POST /ingest/github/{id}", h)
	req := httptest.NewRequest("POST", "/ingest/github/nope", failReader{t})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestBusyReturns503AfterWait(t *testing.T) {
	h, e := rawHandler(t)
	h.wait = 20 * time.Millisecond
	for i := 0; i < maxReaders; i++ {
		h.sem <- struct{}{}
	}
	mux := http.NewServeMux()
	mux.Handle("POST /ingest/github/{id}", h)
	req := httptest.NewRequest("POST", "/ingest/github/"+e.id, failReader{t})
	rec := httptest.NewRecorder()
	start := time.Now()
	mux.ServeHTTP(rec, req)
	if rec.Code != 503 || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	if time.Since(start) < 20*time.Millisecond {
		t.Fatal("did not wait")
	}
	<-h.sem // a freed slot lets the next one through to the body read
	if len(h.sem) != maxReaders-1 {
		t.Fatal("slot accounting")
	}
}

func TestSlotReleasedAfterRequest(t *testing.T) {
	e := newEnv(t, "")
	if code, _ := e.send("ping", "d-slot", map[string]any{"hook": map[string]any{"events": []string{"push"}}}); code != 202 {
		t.Fatalf("got %d", code)
	}
}
