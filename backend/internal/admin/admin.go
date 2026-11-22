// Package admin implements the back-office API, admin login and the two SSE streams.
package admin

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/config"
	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

const (
	cookie     = "bt_session"
	sessionTTL = 12 * time.Hour
	heartbeat  = 15 * time.Second
)

type API struct {
	St  *store.Store
	Hub *hub.Hub
	Cfg config.Config

	mu       sync.Mutex
	sessions map[string]time.Time
	fails    []time.Time
}

func New(st *store.Store, h *hub.Hub, cfg config.Config) *API {
	return &API{St: st, Hub: h, Cfg: cfg, sessions: map[string]time.Time{}}
}

func (a *API) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/admin/login", a.login)
	mux.HandleFunc("POST /api/admin/logout", a.logout)
	mux.HandleFunc("GET /api/admin/session", a.auth(a.session))
	mux.HandleFunc("GET /api/admin/integrations", a.auth(a.listIntegrations))
	mux.HandleFunc("POST /api/admin/integrations", a.auth(a.createIntegration))
	mux.HandleFunc("PATCH /api/admin/integrations/{id}", a.auth(a.updateIntegration))
	mux.HandleFunc("DELETE /api/admin/integrations/{id}", a.auth(a.deleteIntegration))
	mux.HandleFunc("POST /api/admin/integrations/{id}/token", a.auth(a.rotate))
	mux.HandleFunc("GET /api/admin/products", a.auth(a.products))
	mux.HandleFunc("PUT /api/admin/orgs/{key}", a.auth(a.putOrg))
	mux.HandleFunc("PUT /api/admin/products/{key}", a.auth(a.putProduct))
	mux.HandleFunc("GET /api/admin/events", a.auth(a.listEvents))
	mux.HandleFunc("GET /api/admin/settings", a.auth(a.getSettings))
	mux.HandleFunc("PUT /api/admin/settings", a.auth(a.putSettings))
	mux.HandleFunc("GET /api/admin/stats", a.auth(a.stats))
	mux.HandleFunc("GET /admin/events", a.auth(a.stream(true)))
	mux.HandleFunc("GET /events", a.stream(false))
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		fail(w, 415, "Content-Type must be application/json")
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(v); err != nil {
		fail(w, 400, "invalid JSON body")
		return false
	}
	return true
}

// ---- auth ----

func (a *API) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookie)
		if err != nil || !a.validSession(c.Value) {
			fail(w, 401, "sign in required")
			return
		}
		// Mutations must come from JSON requests (cookie is also SameSite=Strict).
		if r.Method != http.MethodGet && r.Method != http.MethodDelete && r.ContentLength != 0 && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			fail(w, 415, "Content-Type must be application/json")
			return
		}
		next(w, r)
	}
}

func (a *API) validSession(tok string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	exp, ok := a.sessions[tok]
	if ok && time.Now().After(exp) {
		delete(a.sessions, tok)
		return false
	}
	return ok
}

func (a *API) tooManyFails() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	cut := time.Now().Add(-time.Minute)
	keep := a.fails[:0]
	for _, t := range a.fails {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	a.fails = keep
	return len(a.fails) >= 10
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if !decode(w, r, &in) {
		return
	}
	if a.tooManyFails() {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "too many attempts, try again in a minute")
		return
	}
	okE := subtle.ConstantTimeCompare([]byte(strings.ToLower(in.Email)), []byte(strings.ToLower(a.Cfg.AdminEmail)))
	okP := subtle.ConstantTimeCompare([]byte(in.Password), []byte(a.Cfg.AdminPassword))
	if okE&okP != 1 {
		a.mu.Lock()
		a.fails = append(a.fails, time.Now())
		a.mu.Unlock()
		fail(w, 401, "email or password is wrong")
		return
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	a.mu.Lock()
	a.sessions[tok] = time.Now().Add(sessionTTL)
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: cookie, Value: tok, Path: "/", HttpOnly: true, Secure: a.Cfg.SecureCookies(),
		SameSite: http.SameSiteStrictMode, MaxAge: int(sessionTTL.Seconds())})
	writeJSON(w, 200, map[string]string{"email": a.Cfg.AdminEmail})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookie); err == nil {
		a.mu.Lock()
		delete(a.sessions, c.Value)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: cookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(204)
}

func (a *API) session(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"email": a.Cfg.AdminEmail, "mode": a.Cfg.Mode})
}

// ---- integrations ----

var kinds = map[string]bool{"github": true, "qa": true, "gaos": true, "site": true}

func (a *API) listIntegrations(w http.ResponseWriter, r *http.Request) {
	list := a.St.Integrations()
	today := time.Now().UTC().Truncate(24 * time.Hour)
	type row struct {
		store.Integration
		Today  int `json:"today"`
		Errors int `json:"errors"`
	}
	out := make([]row, 0, len(list))
	evs := a.St.Events(store.Query{Limit: 500, Newest: true})
	for _, i := range list {
		rw := row{Integration: i}
		for _, e := range evs {
			if e.Integration != i.ID || e.Received.Before(today) {
				continue
			}
			if e.Delivery == store.OK {
				rw.Today++
			} else {
				rw.Errors++
			}
		}
		out = append(out, rw)
	}
	writeJSON(w, 200, out)
}

func (a *API) createIntegration(w http.ResponseWriter, r *http.Request) {
	var in struct{ Kind, Name, Org string }
	if !decode(w, r, &in) {
		return
	}
	if !kinds[in.Kind] || strings.TrimSpace(in.Name) == "" || len(in.Name) > 80 {
		fail(w, 422, "kind must be github, qa, gaos or site, and name is required")
		return
	}
	i, tok := a.St.CreateIntegration(in.Kind, strings.TrimSpace(in.Name), in.Org)
	// The plaintext token is shown only here and on rotate.
	writeJSON(w, 201, map[string]any{"integration": i, "token": tok, "ingestPath": ingestPath(i)})
}

func ingestPath(i store.Integration) string {
	if i.Kind == "github" {
		return ""
	}
	return "/ingest/" + i.Kind + "/" + i.ID
}

func (a *API) updateIntegration(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Org *string }
	if !decode(w, r, &in) {
		return
	}
	i, ok := a.St.UpdateIntegration(r.PathValue("id"), in.Name, in.Org)
	if !ok {
		fail(w, 404, "no such integration")
		return
	}
	writeJSON(w, 200, i)
}

func (a *API) deleteIntegration(w http.ResponseWriter, r *http.Request) {
	if !a.St.DeleteIntegration(r.PathValue("id")) {
		fail(w, 404, "no such integration")
		return
	}
	w.WriteHeader(204)
}

func (a *API) rotate(w http.ResponseWriter, r *http.Request) {
	tok, ok := a.St.RotateToken(r.PathValue("id"))
	if !ok {
		fail(w, 404, "no such integration")
		return
	}
	writeJSON(w, 200, map[string]string{"token": tok})
}

// ---- products ----

func (a *API) products(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"orgs": a.St.Orgs(), "products": a.St.Products()})
}

type visIn struct{ Visibility, Alias, Hall *string }

func (v visIn) bad() bool {
	return v.Visibility != nil && *v.Visibility != store.Public && *v.Visibility != store.Hidden
}

func (a *API) putOrg(w http.ResponseWriter, r *http.Request) {
	var in visIn
	if !decode(w, r, &in) {
		return
	}
	if in.bad() {
		fail(w, 422, "visibility must be public or hidden")
		return
	}
	o, ok := a.St.SetOrg(r.PathValue("key"), in.Visibility, in.Alias)
	if !ok {
		fail(w, 404, "no such org")
		return
	}
	writeJSON(w, 200, o)
}

func (a *API) putProduct(w http.ResponseWriter, r *http.Request) {
	var in visIn
	if !decode(w, r, &in) {
		return
	}
	if in.bad() {
		fail(w, 422, "visibility must be public or hidden")
		return
	}
	p, ok := a.St.SetProduct(r.PathValue("key"), in.Visibility, in.Alias, in.Hall)
	if !ok {
		fail(w, 404, "no such product")
		return
	}
	writeJSON(w, 200, p)
}

// ---- events, settings, stats ----

type adminEvent struct {
	store.Event
	Public map[string]any `json:"public"`
}

func (a *API) listEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lim, _ := strconv.Atoi(q.Get("limit"))
	evs := a.St.Events(store.Query{Integration: q.Get("integration"), Type: q.Get("type"), Delivery: q.Get("delivery"),
		Text: q.Get("q"), Limit: lim, Newest: true})
	out := make([]adminEvent, len(evs))
	for i, e := range evs {
		out[i] = adminEvent{e, visibility.View(a.St, e)}
	}
	writeJSON(w, 200, out)
}

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, a.St.Settings()) }

func (a *API) putSettings(w http.ResponseWriter, r *http.Request) {
	var in store.Settings
	if !decode(w, r, &in) {
		return
	}
	writeJSON(w, 200, a.St.SetSettings(in))
}

func (a *API) stats(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, a.St.Counts()) }

// ---- SSE ----

// stream serves /events (public, accepted events only, masked) and /admin/events
// (admin: every delivery, raw plus the public view).
func (a *API) stream(admin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			fail(w, 500, "streaming unsupported")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		ch, cancel := a.Hub.Subscribe() // subscribe first so nothing is lost during replay
		defer cancel()
		last, _ := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
		send := func(e store.Event) {
			if !admin && e.Delivery != store.OK {
				return
			}
			var data any = visibility.View(a.St, e)
			if admin {
				data = adminEvent{e, visibility.View(a.St, e)}
			}
			b, _ := json.Marshal(data)
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", e.Seq, e.Type, b)
			last = e.Seq
		}
		fmt.Fprint(w, "retry: 3000\n\n")
		if last > 0 {
			for _, e := range a.St.Events(store.Query{AfterSeq: last, Limit: 500}) {
				send(e)
			}
		}
		fl.Flush()
		tick := time.NewTicker(heartbeat)
		defer tick.Stop()
		for {
			select {
			case e := <-ch:
				if e.Seq > last {
					send(e)
				}
			case <-tick.C:
				fmt.Fprint(w, ": heartbeat\n\n")
			case <-r.Context().Done():
				return
			}
			fl.Flush()
		}
	}
}
