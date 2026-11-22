// Package ingest implements POST /ingest/{gaos,qa,site}/{integration-id}.
package ingest

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

type Handler struct {
	St  *store.Store
	Hub *hub.Hub

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

const (
	rate  = 20.0 // events per second per integration
	burst = 60.0
)

func New(st *store.Store, h *hub.Hub) *Handler {
	return &Handler{St: st, Hub: h, buckets: map[string]*bucket{}}
}

type verr struct{ Field, Msg string }

func (e verr) Error() string { return e.Field + ": " + e.Msg }

func (h *Handler) allow(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	b, ok := h.buckets[id]
	if !ok {
		b = &bucket{tokens: burst, last: now}
		h.buckets[id] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * rate
	if b.tokens > burst {
		b.tokens = burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	kind, id := r.PathValue("kind"), r.PathValue("id")
	if kind != "gaos" && kind != "qa" && kind != "site" {
		reply(w, 404, "unknown source", "")
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	integ, good := h.St.CheckToken(id, token)
	if integ == nil || integ.Kind != kind {
		reply(w, 401, "token missing or wrong", "") // do not reveal whether the id exists
		return
	}
	if !good {
		h.reject(integ, kind, "", 401, "token missing or wrong")
		reply(w, 401, "token missing or wrong", "")
		return
	}
	if !h.allow(id) {
		w.Header().Set("Retry-After", "1")
		reply(w, 429, "slow down", "")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	var raw map[string]any
	if err == nil {
		err = json.Unmarshal(body, &raw)
	}
	if err != nil || raw == nil {
		h.reject(integ, kind, "", 422, "body is not a JSON object")
		reply(w, 422, "body is not a JSON object", "body")
		return
	}
	a, err := validate(kind, raw)
	if err != nil {
		var ve verr
		errors.As(err, &ve)
		typ, _ := raw["type"].(string)
		h.reject(integ, kind, typ, 422, err.Error())
		reply(w, 422, ve.Msg, ve.Field)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		key = a.ID
	}
	a.Integration, a.Kind, a.Key = id, kind, key
	ev, fresh := h.St.AddAccepted(a)
	if !fresh {
		reply(w, 409, "already accepted", "id")
		return
	}
	h.Hub.Publish(ev)
	reply(w, 202, "accepted", "")
}

func (h *Handler) reject(i *store.Integration, kind, typ string, status int, reason string) {
	h.Hub.Publish(h.St.AddRejected(i.ID, kind, typ, status, reason))
}

func reply(w http.ResponseWriter, status int, msg, field string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	out := map[string]string{"message": msg}
	if status >= 400 {
		out = map[string]string{"error": msg}
		if field != "" {
			out["field"] = field
		}
	} else {
		out["status"] = msg
	}
	_ = json.NewEncoder(w).Encode(out)
}

var (
	gaosTypes = set("product.upserted", "task.created", "task.moved", "gate.requested", "gate.decided", "task.claimed", "task.qa", "task.done", "task.failed")
	qaTypes   = set("qa.run.started", "qa.step", "qa.run.finished")
	siteTypes = set("article.published", "illustration.published", "site.visit")
)

func set(v ...string) map[string]bool {
	m := map[string]bool{}
	for _, s := range v {
		m[s] = true
	}
	return m
}

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func obj(m map[string]any, k string) map[string]any {
	o, _ := m[k].(map[string]any)
	return o
}

// validate checks the body against the integration contract in docs/integrations/.
func validate(kind string, raw map[string]any) (store.Accept, error) {
	var a store.Accept
	a.ID, a.Type, a.Raw = str(raw, "id"), str(raw, "type"), raw
	if a.ID == "" || len(a.ID) > 128 {
		return a, verr{"id", "id is required (max 128 characters)"}
	}
	at, err := time.Parse(time.RFC3339, str(raw, "at"))
	if err != nil {
		return a, verr{"at", "at must be an RFC 3339 timestamp"}
	}
	a.At = at.UTC()
	allowed := map[string]map[string]bool{"gaos": gaosTypes, "qa": qaTypes, "site": siteTypes}[kind]
	if !allowed[a.Type] {
		return a, verr{"type", "unknown type for this integration"}
	}
	data := obj(raw, "data")
	switch kind {
	case "gaos":
		p := obj(raw, "product")
		if str(p, "key") == "" {
			return a, verr{"product.key", "product.key is required"}
		}
		if v := str(p, "visibility"); v != store.Public && v != store.Hidden {
			return a, verr{"product.visibility", "must be public or hidden"}
		}
		if a.Type != "product.upserted" && str(obj(raw, "task"), "id") == "" {
			return a, verr{"task.id", "task.id is required"}
		}
		a.Product, a.ProductName, a.Vis = str(p, "key"), str(p, "name"), str(p, "visibility")
	case "qa":
		if str(raw, "product") == "" {
			return a, verr{"product", "product is required"}
		}
		if str(raw, "run") == "" {
			return a, verr{"run", "run is required"}
		}
		a.Product, a.Org = str(raw, "product"), str(raw, "org")
	case "site":
		if a.Type == "site.visit" {
			// Privacy: keep only the page, the country and an optional blog title.
			if pg := str(data, "page"); pg != "home" && pg != "blog" {
				return a, verr{"data.page", "page must be home or blog"}
			}
			c := str(data, "country")
			if len(c) != 2 || c != strings.ToUpper(c) || c[0] < 'A' || c[0] > 'Z' || c[1] < 'A' || c[1] > 'Z' {
				return a, verr{"data.country", "country must be a two-letter code"}
			}
			clean := map[string]any{"page": data["page"], "country": c}
			if t := str(data, "title"); t != "" {
				clean["title"] = t
			}
			a.Raw = map[string]any{"id": a.ID, "type": a.Type, "at": raw["at"], "data": clean}
		} else if str(data, "title") == "" || str(data, "url") == "" {
			return a, verr{"data", "data.title and data.url are required"}
		}
	}
	return a, nil
}
