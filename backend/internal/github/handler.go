// Package github implements POST /ingest/github/{integration-id}: signed GitHub organisation webhooks.
// The GitHub payload is never stored; only the small town envelope (docs/integrations/github.md).
package github

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/ratelimit"
	"github.com/ardihikaru/brain-town/backend/internal/secret"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

const (
	maxBody      = 2 << 20
	maxReaders   = 4               // concurrent body reads: at most 8 MB of bodies in memory
	defaultQueue = 2 * time.Second // how long a request waits for a read slot before 503
)

type Handler struct {
	St  *store.Store
	Hub *hub.Hub
	Key []byte // BRAIN_TOWN_SECRET_KEY
	Co  *Coalescer

	lim  *ratelimit.Limiter
	now  func() time.Time
	sem  chan struct{} // bounds concurrent body reads
	wait time.Duration // max wait for a slot
}

func New(st *store.Store, h *hub.Hub, key []byte, rate, burst float64, co *Coalescer) *Handler {
	return &Handler{St: st, Hub: h, Key: key, Co: co, lim: ratelimit.New(rate, burst), now: co.Now,
		sem: make(chan struct{}, maxReaders), wait: defaultQueue}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Cheap checks first: nothing is read from an unauthenticated sender for an unknown integration.
	iid := r.PathValue("id")
	integ, ok := h.St.Lookup(iid)
	if !ok || integ.Kind != "github" {
		reply(w, 401, "signature missing or wrong", "") // do not reveal whether the id exists
		return
	}
	if r.ContentLength > maxBody {
		reply(w, 413, "body over 2 MB", "")
		return
	}
	// Bound the bodies held in memory (64 MB container): wait briefly for a slot, then 503.
	t := time.NewTimer(h.wait)
	defer t.Stop()
	select {
	case h.sem <- struct{}{}:
		defer func() { <-h.sem }()
	case <-t.C:
		w.Header().Set("Retry-After", "1")
		reply(w, 503, "busy: too many deliveries in flight, retry shortly", "")
		return
	case <-r.Context().Done():
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			reply(w, 413, "body over 2 MB", "")
		} else {
			reply(w, 400, "could not read the body", "")
		}
		return
	}
	event, delivery := r.Header.Get("X-GitHub-Event"), r.Header.Get("X-GitHub-Delivery")
	plain, err := secret.Open(h.Key, integ.SecretEnc)
	if err != nil || integ.SecretEnc == "" {
		reply(w, 503, "the webhook secret cannot be decrypted: BRAIN_TOWN_SECRET_KEY is not configured or has changed", "")
		return
	}
	if !validSignature(plain, body, r.Header.Get("X-Hub-Signature-256")) {
		h.reject(iid, event, 401, "signature missing or wrong")
		reply(w, 401, "signature missing or wrong", "")
		return
	}
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		reply(w, 415, "Content-Type must be application/json", "")
		return
	}
	if event == "" {
		h.reject(iid, event, 422, "X-GitHub-Event is required")
		reply(w, 422, "X-GitHub-Event is required", "X-GitHub-Event")
		return
	}
	if delivery == "" || len(delivery) > 128 {
		h.reject(iid, event, 422, "X-GitHub-Delivery is required (max 128 characters)")
		reply(w, 422, "X-GitHub-Delivery is required (max 128 characters)", "X-GitHub-Delivery")
		return
	}
	if !h.lim.Allow(iid) {
		w.Header().Set("Retry-After", "1")
		reply(w, 429, "slow down", "")
		return
	}
	if event != "ping" {
		h.St.AddEvent(iid, event) // a valid signature proves the event is delivered, so it is subscribed
	}
	if !known[event] {
		reply(w, 202, ignored, "")
		return
	}
	var p map[string]any
	if json.Unmarshal(body, &p) != nil || p == nil {
		h.reject(iid, event, 422, "body is not a JSON object")
		reply(w, 422, "body is not a JSON object", "body")
		return
	}

	// Org check: organization.login, else repository.owner.login.
	org := str(obj(p, "organization"), "login")
	if org == "" {
		org = str(obj(p, "repository", "owner"), "login")
	}
	if integ.Org != "" && org != "" && !strings.EqualFold(integ.Org, org) {
		h.reject(iid, event, 422, "delivery is for another organisation")
		reply(w, 422, "this delivery is for another organisation than the integration's", "organization")
		return
	}
	if integ.Org != "" {
		org = integ.Org
	}

	at := h.now().UTC()
	id := "gh-" + delivery
	if event == "ping" {
		events := strList(obj(p, "hook")["events"])
		ev, fresh := h.St.AddAccepted(store.Accept{Integration: iid, Kind: "github", Key: delivery, ID: id, Type: "ping", At: at, Org: org,
			Raw: envelope(id, "ping", org, "", false, at, nil, map[string]any{"events": events})})
		if !fresh {
			reply(w, 409, "delivery already accepted", "X-GitHub-Delivery")
			return
		}
		h.St.SetEvents(iid, events)
		h.St.AdoptOrg(iid, org)
		h.Hub.Publish(ev)
		reply(w, 202, accepted, "")
		return
	}

	ct, outcome := translate(event, p, integ.Events)
	if outcome != accepted {
		reply(w, 202, outcome, "")
		return
	}
	repo := str(obj(p, "repository"), "name")
	if repo == "" {
		h.reject(iid, event, 422, "repository.name is required")
		reply(w, 422, "repository.name is required", "repository")
		return
	}
	hidden := boolean(obj(p, "repository"), "private")
	if ct.Grouped {
		if !h.St.ClaimDelivery(iid, delivery) {
			reply(w, 409, "delivery already accepted", "X-GitHub-Delivery")
			return
		}
		h.St.AdoptOrg(iid, org)
		h.Co.Add(base{Integration: iid, Org: org, Repo: repo, Hidden: hidden, Delivery: delivery, At: at}, ct)
		reply(w, 202, accepted, "")
		return
	}
	vis := ""
	if hidden {
		vis = store.Hidden
	}
	ev, fresh := h.St.AddAccepted(store.Accept{Integration: iid, Kind: "github", Key: delivery, ID: id, Type: ct.Type, At: at,
		Product: repo, ProductName: repo, Vis: vis, Org: org,
		Raw: envelope(id, ct.Type, org, repo, hidden, at, ct.Task, ct.Data)})
	if !fresh {
		reply(w, 409, "delivery already accepted", "X-GitHub-Delivery")
		return
	}
	h.St.AdoptOrg(iid, org)
	h.Hub.Publish(ev)
	reply(w, 202, accepted, "")
}

// validSignature checks "sha256=<hex>" against HMAC-SHA256(secret, body) in constant time.
func validSignature(secret string, body []byte, header string) bool {
	hexSum, ok := strings.CutPrefix(header, "sha256=")
	if !ok {
		return false
	}
	got, err := hex.DecodeString(hexSum)
	if err != nil {
		return false
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return hmac.Equal(m.Sum(nil), got)
}

func (h *Handler) reject(id, typ string, status int, reason string) {
	h.Hub.Publish(h.St.AddRejected(id, "github", typ, status, reason))
}

func reply(w http.ResponseWriter, status int, msg, field string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	out := map[string]string{"status": msg}
	if status >= 400 {
		out = map[string]string{"error": msg}
		if field != "" {
			out["field"] = field
		}
	}
	_ = json.NewEncoder(w).Encode(out)
}
