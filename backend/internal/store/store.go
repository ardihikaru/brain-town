// Package store holds integrations, orgs, products and events in memory, with an
// optional JSON snapshot on disk. Token plaintext is never stored, only its SHA-256.
package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	Public    = "public"
	Hidden    = "hidden"
	OK        = "ok"
	Reject    = "rejected"
	maxEvents = 5000
)

type Integration struct {
	ID             string    `json:"id"`
	Kind           string    `json:"kind"` // github | qa | gaos | site
	Name           string    `json:"name"`
	Org            string    `json:"org,omitempty"`
	TokenHash      string    `json:"tokenHash,omitempty"`
	TokenHint      string    `json:"tokenHint,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	LastEventAt    time.Time `json:"lastEventAt"`
	LastRejectedAt time.Time `json:"lastRejectedAt"`
}

type Org struct {
	Key        string `json:"key"`
	Visibility string `json:"visibility"`
	Alias      string `json:"alias"`
}

type Product struct {
	Key        string   `json:"key"`
	Org        string   `json:"org,omitempty"`
	Name       string   `json:"name,omitempty"`
	Visibility string   `json:"visibility"`
	Alias      string   `json:"alias"`
	Hall       string   `json:"hall"`
	Sources    []string `json:"sources"`
}

type Event struct {
	Seq         int64          `json:"seq"`
	ID          string         `json:"id"`
	Integration string         `json:"integration"`
	Kind        string         `json:"kind"`
	Type        string         `json:"type"`
	At          time.Time      `json:"at"`
	Received    time.Time      `json:"received"`
	Delivery    string         `json:"delivery"` // ok | rejected
	Status      int            `json:"status"`
	Reason      string         `json:"reason,omitempty"`
	Product     string         `json:"product,omitempty"`
	Org         string         `json:"org,omitempty"`
	Raw         map[string]any `json:"raw,omitempty"`
}

type Settings struct {
	RetentionDays int  `json:"retentionDays"`
	Animation     bool `json:"animation"`
}

type state struct {
	Integrations map[string]*Integration `json:"integrations"`
	Orgs         map[string]*Org         `json:"orgs"`
	Products     map[string]*Product     `json:"products"`
	Events       []Event                 `json:"events"` // oldest first
	Seen         map[string]time.Time    `json:"seen"`
	NextSeq      int64                   `json:"nextSeq"`
	Settings     Settings                `json:"settings"`
}

type Store struct {
	mu    sync.RWMutex
	s     state
	path  string
	dirty bool
}

func New(path string) (*Store, error) {
	st := &Store{path: path, s: state{
		Integrations: map[string]*Integration{}, Orgs: map[string]*Org{}, Products: map[string]*Product{},
		Seen: map[string]time.Time{}, NextSeq: 1, Settings: Settings{RetentionDays: 30, Animation: true},
	}}
	if path != "" {
		// Fail at startup, not silently later, when the snapshot location is not writable.
		if err := os.WriteFile(path+".tmp", nil, 0o600); err != nil {
			return nil, err
		}
		_ = os.Remove(path + ".tmp")
		if b, err := os.ReadFile(path); err == nil {
			if err := json.Unmarshal(b, &st.s); err != nil {
				return nil, err
			}
			if st.s.Integrations == nil {
				st.s.Integrations = map[string]*Integration{}
			}
			if st.s.Orgs == nil {
				st.s.Orgs = map[string]*Org{}
			}
			if st.s.Products == nil {
				st.s.Products = map[string]*Product{}
			}
			if st.s.Seen == nil {
				st.s.Seen = map[string]time.Time{}
			}
			if st.s.NextSeq < 1 {
				st.s.NextSeq = 1
			}
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	return st, nil
}

// Run flushes the snapshot every two seconds while dirty, and prunes by retention hourly.
func (st *Store) Run(stop <-chan struct{}) {
	flush, prune := time.NewTicker(2*time.Second), time.NewTicker(time.Hour)
	defer flush.Stop()
	defer prune.Stop()
	for {
		select {
		case <-flush.C:
			st.Flush()
		case <-prune.C:
			st.Prune(time.Now())
		case <-stop:
			st.Flush()
			return
		}
	}
}

func (st *Store) Flush() {
	if st.path == "" {
		return
	}
	st.mu.Lock()
	if !st.dirty {
		st.mu.Unlock()
		return
	}
	b, err := json.Marshal(st.s)
	st.dirty = false
	st.mu.Unlock()
	if err != nil {
		return
	}
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Printf("store: snapshot write failed: %v", err)
		st.mu.Lock()
		st.dirty = true
		st.mu.Unlock()
		return
	}
	if err := os.Rename(tmp, st.path); err != nil {
		log.Printf("store: snapshot rename failed: %v", err)
	}
}

// Prune drops events and dedupe entries older than the retention window.
func (st *Store) Prune(now time.Time) int {
	st.mu.Lock()
	defer st.mu.Unlock()
	cut := now.AddDate(0, 0, -st.s.Settings.RetentionDays)
	keep := st.s.Events[:0]
	n := 0
	for _, e := range st.s.Events {
		if e.Received.Before(cut) {
			n++
			continue
		}
		keep = append(keep, e)
	}
	st.s.Events = keep
	for k, t := range st.s.Seen {
		if t.Before(cut) {
			delete(st.s.Seen, k)
		}
	}
	st.dirty = true
	return n
}

// ---- tokens ----

func NewToken() (plain, hash, hint string) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	plain = "bt_live_" + hex.EncodeToString(b)
	return plain, HashToken(plain), plain[len(plain)-4:]
}

func HashToken(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }

func (st *Store) CheckToken(id, token string) (*Integration, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	i, ok := st.s.Integrations[id]
	if !ok {
		return nil, false
	}
	c := *i
	good := i.TokenHash != "" && subtle.ConstantTimeCompare([]byte(i.TokenHash), []byte(HashToken(token))) == 1
	return &c, good
}

// ---- integrations ----

func (st *Store) Integrations() []Integration {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]Integration, 0, len(st.s.Integrations))
	for _, i := range st.s.Integrations {
		c := *i
		c.TokenHash = ""
		out = append(out, c)
	}
	sort.Slice(out, func(a, b int) bool {
		return out[a].CreatedAt.Before(out[b].CreatedAt) || (out[a].CreatedAt.Equal(out[b].CreatedAt) && out[a].ID < out[b].ID)
	})
	return out
}

func (st *Store) GetIntegration(id string) (Integration, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	i, ok := st.s.Integrations[id]
	if !ok {
		return Integration{}, false
	}
	c := *i
	c.TokenHash = ""
	return c, true
}

// CreateIntegration returns the plaintext token once.
func (st *Store) CreateIntegration(kind, name, org string) (Integration, string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	plain, hash, hint := NewToken()
	idb := make([]byte, 3)
	_, _ = rand.Read(idb)
	i := &Integration{ID: kind + "-" + hex.EncodeToString(idb), Kind: kind, Name: name, Org: org, TokenHash: hash, TokenHint: hint, CreatedAt: time.Now().UTC()}
	st.s.Integrations[i.ID] = i
	st.dirty = true
	c := *i
	c.TokenHash = ""
	return c, plain
}

func (st *Store) UpdateIntegration(id string, name *string, org *string) (Integration, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok {
		return Integration{}, false
	}
	if name != nil {
		i.Name = *name
	}
	if org != nil {
		i.Org = *org
	}
	st.dirty = true
	c := *i
	c.TokenHash = ""
	return c, true
}

func (st *Store) RotateToken(id string) (string, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok {
		return "", false
	}
	plain, hash, hint := NewToken()
	i.TokenHash, i.TokenHint = hash, hint
	st.dirty = true
	return plain, true
}

func (st *Store) DeleteIntegration(id string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	_, ok := st.s.Integrations[id]
	delete(st.s.Integrations, id)
	st.dirty = ok || st.dirty
	return ok
}

// ---- orgs / products ----

func nextAlias(prefix string, taken map[string]bool) string {
	for c := 'A'; c <= 'Z'; c++ {
		a := prefix + " " + string(c)
		if !taken[a] {
			return a
		}
	}
	return prefix + " " + time.Now().Format("150405")
}

func (st *Store) orgAliases() map[string]bool {
	m := map[string]bool{}
	for _, o := range st.s.Orgs {
		m[o.Alias] = true
	}
	return m
}
func (st *Store) productAliases() map[string]bool {
	m := map[string]bool{}
	for _, p := range st.s.Products {
		m[p.Alias] = true
	}
	return m
}

func (st *Store) ensureOrg(key string) *Org {
	if key == "" {
		return nil
	}
	if o, ok := st.s.Orgs[key]; ok {
		return o
	}
	o := &Org{Key: key, Visibility: Public, Alias: key}
	st.s.Orgs[key] = o
	return o
}

// Touch registers the org and product an event is about, with the source kind. A new product
// takes the visibility the sender reports; after that the back-office setting wins.
func (st *Store) touch(org, product, name, reportedVis, kind string) {
	st.ensureOrg(org)
	if product == "" {
		return
	}
	p, ok := st.s.Products[product]
	if !ok {
		p = &Product{Key: product, Org: org, Name: name, Visibility: Public, Alias: product, Hall: defaultHall(kind)}
		if reportedVis == Hidden {
			p.Visibility = Hidden
			p.Alias = nextAlias("Product", st.productAliases())
		}
		st.s.Products[product] = p
	}
	if p.Org == "" && org != "" {
		p.Org = org
	}
	if p.Name == "" && name != "" {
		p.Name = name
	}
	label := map[string]string{"github": "GitHub", "qa": "QA", "gaos": "GAOS", "site": "Site"}[kind]
	for _, s := range p.Sources {
		if s == label {
			return
		}
	}
	if label != "" {
		p.Sources = append(p.Sources, label)
	}
}

func defaultHall(kind string) string {
	if kind == "gaos" {
		return "Article Bureau"
	}
	return "GitHub Valley hall"
}

func (st *Store) Orgs() []Org {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]Org, 0, len(st.s.Orgs))
	for _, o := range st.s.Orgs {
		out = append(out, *o)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Key < out[b].Key })
	return out
}

func (st *Store) Products() []Product {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]Product, 0, len(st.s.Products))
	for _, p := range st.s.Products {
		c := *p
		c.Sources = append([]string{}, p.Sources...)
		out = append(out, c)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Key < out[b].Key })
	return out
}

func (st *Store) GetOrg(k string) (Org, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	o, ok := st.s.Orgs[k]
	if !ok {
		return Org{}, false
	}
	return *o, true
}

func (st *Store) GetProduct(k string) (Product, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	p, ok := st.s.Products[k]
	if !ok {
		return Product{}, false
	}
	return *p, true
}

// SetOrg changes visibility and/or alias. Hidden items without a custom alias get "Org A".
func (st *Store) SetOrg(key string, vis, alias *string) (Org, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	o, ok := st.s.Orgs[key]
	if !ok {
		return Org{}, false
	}
	if vis != nil {
		o.Visibility = *vis
		if *vis == Public {
			o.Alias = o.Key
		} else if o.Alias == o.Key {
			o.Alias = nextAlias("Org", st.orgAliases())
		}
	}
	if alias != nil && strings.TrimSpace(*alias) != "" {
		o.Alias = strings.TrimSpace(*alias)
	}
	st.dirty = true
	return *o, true
}

func (st *Store) SetProduct(key string, vis, alias, hall *string) (Product, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	p, ok := st.s.Products[key]
	if !ok {
		return Product{}, false
	}
	if vis != nil {
		p.Visibility = *vis
		if *vis == Public {
			p.Alias = p.Key
		} else if p.Alias == p.Key {
			p.Alias = nextAlias("Product", st.productAliases())
		}
	}
	if alias != nil && strings.TrimSpace(*alias) != "" {
		p.Alias = strings.TrimSpace(*alias)
	}
	if hall != nil {
		p.Hall = *hall
	}
	st.dirty = true
	return *p, true
}

// ---- events ----

// Seen reports whether this (integration,key) pair was already accepted.
func (st *Store) Seen(integration, key string) bool {
	st.mu.RLock()
	defer st.mu.RUnlock()
	_, ok := st.s.Seen[integration+"\x00"+key]
	return ok
}

type Accept struct {
	Integration, Kind, Key, ID, Type string
	At                               time.Time
	Product, ProductName, Vis, Org   string
	Raw                              map[string]any
}

// AddAccepted atomically dedupes, registers org/product and appends an ok event.
// It returns false when the key was already accepted.
func (st *Store) AddAccepted(a Accept) (Event, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	k := a.Integration + "\x00" + a.Key
	if _, dup := st.s.Seen[k]; dup {
		return Event{}, false
	}
	now := time.Now().UTC()
	st.s.Seen[k] = now
	st.touch(a.Org, a.Product, a.ProductName, a.Vis, a.Kind)
	if i, ok := st.s.Integrations[a.Integration]; ok {
		i.LastEventAt = now
	}
	ev := Event{Seq: st.s.NextSeq, ID: a.ID, Integration: a.Integration, Kind: a.Kind, Type: a.Type, At: a.At, Received: now,
		Delivery: OK, Status: 202, Product: a.Product, Org: a.Org, Raw: a.Raw}
	st.s.NextSeq++
	st.append(ev)
	return ev, true
}

func (st *Store) AddRejected(integration, kind, typ string, status int, reason string) Event {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now().UTC()
	if i, ok := st.s.Integrations[integration]; ok {
		i.LastRejectedAt = now
	}
	ev := Event{Seq: st.s.NextSeq, Integration: integration, Kind: kind, Type: typ, At: now, Received: now, Delivery: Reject, Status: status, Reason: reason}
	st.s.NextSeq++
	st.append(ev)
	return ev
}

func (st *Store) append(ev Event) {
	st.s.Events = append(st.s.Events, ev)
	if len(st.s.Events) > maxEvents {
		st.s.Events = append([]Event(nil), st.s.Events[len(st.s.Events)-maxEvents:]...)
	}
	st.dirty = true
}

type Query struct {
	Integration, Type, Delivery, Text string
	AfterSeq                          int64
	Limit                             int
	Newest                            bool // newest first
}

func (st *Store) Events(q Query) []Event {
	st.mu.RLock()
	defer st.mu.RUnlock()
	if q.Limit <= 0 || q.Limit > 500 {
		q.Limit = 100
	}
	text := strings.ToLower(q.Text)
	var out []Event
	match := func(e Event) bool {
		if e.Seq <= q.AfterSeq {
			return false
		}
		if q.Integration != "" && e.Integration != q.Integration {
			return false
		}
		if q.Type != "" && !strings.HasPrefix(e.Type, q.Type) {
			return false
		}
		if q.Delivery != "" && e.Delivery != q.Delivery {
			return false
		}
		if text != "" {
			b, _ := json.Marshal(e)
			if !strings.Contains(strings.ToLower(string(b)), text) {
				return false
			}
		}
		return true
	}
	ev := st.s.Events
	if q.Newest {
		for i := len(ev) - 1; i >= 0 && len(out) < q.Limit; i-- {
			if match(ev[i]) {
				out = append(out, ev[i])
			}
		}
	} else {
		for i := 0; i < len(ev) && len(out) < q.Limit; i++ {
			if match(ev[i]) {
				out = append(out, ev[i])
			}
		}
	}
	return out
}

func (st *Store) Settings() Settings { st.mu.RLock(); defer st.mu.RUnlock(); return st.s.Settings }
func (st *Store) SetSettings(s Settings) Settings {
	st.mu.Lock()
	defer st.mu.Unlock()
	if s.RetentionDays < 1 {
		s.RetentionDays = 1
	}
	if s.RetentionDays > 3650 {
		s.RetentionDays = 3650
	}
	st.s.Settings = s
	st.dirty = true
	return s
}

type Counts struct {
	Integrations, Orgs, Products, Events, Rejected int
}

func (st *Store) Counts() Counts {
	st.mu.RLock()
	defer st.mu.RUnlock()
	c := Counts{Integrations: len(st.s.Integrations), Orgs: len(st.s.Orgs), Products: len(st.s.Products), Events: len(st.s.Events)}
	for _, e := range st.s.Events {
		if e.Delivery == Reject {
			c.Rejected++
		}
	}
	return c
}
