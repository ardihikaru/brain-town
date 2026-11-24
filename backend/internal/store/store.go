// Package store holds integrations, orgs, products and events in memory and writes every change
// to a Persister (ArcadeDB). Token plaintext is never stored, only its SHA-256.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	Public    = "public"
	Hidden    = "hidden"
	OK        = "ok"
	Reject    = "rejected"
	maxEvents = 5000
)

type Integration struct {
	ID             string               `json:"id"`
	Kind           string               `json:"kind"` // github | qa | gaos | site | animora
	Name           string               `json:"name"`
	Org            string               `json:"org,omitempty"`
	FeedURL        string               `json:"feedUrl,omitempty"` // site or animora: JSON Feed 1.1 URL pulled by internal/feed (https)
	TokenHash      string               `json:"tokenHash,omitempty"`
	TokenHint      string               `json:"tokenHint,omitempty"`
	SecretEnc      string               `json:"secretEnc,omitempty"` // github only: AES-256-GCM sealed webhook secret; never sent by the admin API
	Events         []string             `json:"events"`              // github only: events subscribed on the webhook, from the last ping
	OwnerType      string               `json:"ownerType"`           // github only: "user" | "organization" | "" (unknown), adopted once from the payload
	Repos          map[string]RepoState `json:"-"`                   // github only: per-repo state, keyed by repo name; the admin list emits it as a sorted slice
	CreatedAt      time.Time            `json:"createdAt"`
	LastEventAt    time.Time            `json:"lastEventAt"`
	LastRejectedAt time.Time            `json:"lastRejectedAt"`
}

// RepoState is what the town knows about one repository of a GitHub integration. A personal account has no
// account-wide webhook, so each repo carries its own hook and its own subscribed events.
type RepoState struct {
	Name           string    `json:"name"`
	Private        bool      `json:"private"`
	HookEvents     []string  `json:"hookEvents"`
	LastEventAt    time.Time `json:"lastEventAt"`
	LastRejectedAt time.Time `json:"lastRejectedAt"`
}

// MaxRepos caps the repos kept on one integration.
const MaxRepos = 500

// clone returns a deep copy: the events slice and the repos map are never shared with the store.
func (i *Integration) clone() Integration {
	c := *i
	c.Events = append([]string{}, i.Events...)
	if i.Repos != nil {
		c.Repos = make(map[string]RepoState, len(i.Repos))
		for k, r := range i.Repos {
			r.HookEvents = append([]string{}, r.HookEvents...)
			c.Repos[k] = r
		}
	}
	return c
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
	RetentionDays int    `json:"retentionDays"`
	Animation     bool   `json:"animation"`
	Timezone      string `json:"timezone"` // IANA name used for every time the town shows
}

// DefaultTimezone is used when no timezone was ever stored.
const DefaultTimezone = "Asia/Jakarta"

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
	mu  sync.RWMutex
	s   state
	p   Persister // nil = memory only
	ops []Op      // changes not yet written
}

const maxOps = 50000 // cap on the unwritten queue if the database is down for long

// New builds a store. With a Persister it initialises the schema and loads existing data.
func New(p Persister) (*Store, error) {
	st := &Store{p: p, s: state{
		Integrations: map[string]*Integration{}, Orgs: map[string]*Org{}, Products: map[string]*Product{},
		Seen: map[string]time.Time{}, NextSeq: 1, Settings: Settings{RetentionDays: 30, Animation: true, Timezone: DefaultTimezone},
	}}
	if p == nil {
		return st, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := p.Init(ctx); err != nil {
		return nil, err
	}
	sn, err := p.Load(ctx)
	if err != nil {
		return nil, err
	}
	for i := range sn.Integrations {
		v := sn.Integrations[i]
		st.s.Integrations[v.ID] = &v
	}
	for i := range sn.Orgs {
		v := sn.Orgs[i]
		st.s.Orgs[v.Key] = &v
	}
	for i := range sn.Products {
		v := sn.Products[i]
		st.s.Products[v.Key] = &v
	}
	st.s.Events = sn.Events
	if sn.Seen != nil {
		st.s.Seen = sn.Seen
	}
	if sn.Settings != nil {
		st.s.Settings = *sn.Settings
		if st.s.Settings.Timezone == "" {
			st.s.Settings.Timezone = DefaultTimezone
		}
	}
	last := sn.LastSeq
	for _, e := range sn.Events {
		if e.Seq > last {
			last = e.Seq
		}
	}
	st.s.NextSeq = last + 1
	st.mu.Lock()
	st.migrateAnimoraProduct()
	st.mu.Unlock()
	return st, nil
}

func (st *Store) q(o Op) {
	if st.p == nil {
		return
	}
	if len(st.ops) >= maxOps {
		st.ops = st.ops[len(st.ops)/10:] // shed the oldest tenth rather than grow without bound
	}
	st.ops = append(st.ops, o)
}

// Run writes queued changes every second and prunes by retention hourly.
func (st *Store) Run(stop <-chan struct{}) {
	flush, prune := time.NewTicker(time.Second), time.NewTicker(time.Hour)
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

// Flush writes the queue to the database. On failure the ops stay queued and are retried.
func (st *Store) Flush() error {
	if st.p == nil {
		return nil
	}
	st.mu.Lock()
	ops := st.ops
	st.ops = nil
	st.mu.Unlock()
	if len(ops) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := st.p.Apply(ctx, ops); err != nil {
		log.Printf("store: write failed, %d changes kept for retry: %v", len(ops), err)
		st.mu.Lock()
		st.ops = append(ops, st.ops...)
		st.mu.Unlock()
		return err
	}
	return nil
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
	st.q(Op{Kind: OpPrune, Cut: cut})
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
	c := i.clone()
	good := i.TokenHash != "" && subtle.ConstantTimeCompare([]byte(i.TokenHash), []byte(HashToken(token))) == 1
	return &c, good
}

// ---- integrations ----

// public returns a copy that is safe to hand out: no token hash, no sealed secret, events never nil.
func (i *Integration) public() Integration {
	c := i.clone()
	c.TokenHash, c.SecretEnc = "", ""
	return c
}

func (st *Store) Integrations() []Integration {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]Integration, 0, len(st.s.Integrations))
	for _, i := range st.s.Integrations {
		out = append(out, i.public())
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
	return i.public(), true
}

// Lookup returns a full copy of an integration, including the sealed secret. Server-side use only;
// never serialise the result.
func (st *Store) Lookup(id string) (Integration, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	i, ok := st.s.Integrations[id]
	if !ok {
		return Integration{}, false
	}
	return i.clone(), true
}

func (st *Store) add(i *Integration) {
	idb := make([]byte, 3)
	_, _ = rand.Read(idb)
	i.ID = i.Kind + "-" + hex.EncodeToString(idb)
	i.CreatedAt = time.Now().UTC()
	st.s.Integrations[i.ID] = i
	st.qIntegration(i)
}

// CreateIntegration returns the plaintext token once.
func (st *Store) CreateIntegration(kind, name, org string) (Integration, string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	plain, hash, hint := NewToken()
	i := &Integration{Kind: kind, Name: name, Org: org, TokenHash: hash, TokenHint: hint}
	st.add(i)
	return i.public(), plain
}

// CreateSecretIntegration creates an integration that authenticates by webhook signature (github).
// It has no token hash, so the bearer-token path can never accept it.
func (st *Store) CreateSecretIntegration(kind, name, org, secretEnc, hint string) Integration {
	st.mu.Lock()
	defer st.mu.Unlock()
	i := &Integration{Kind: kind, Name: name, Org: org, SecretEnc: secretEnc, TokenHint: hint}
	st.add(i)
	return i.public()
}

// RotateSecret replaces the sealed secret of a github integration.
func (st *Store) RotateSecret(id, secretEnc, hint string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok || i.Kind != "github" {
		return false
	}
	i.SecretEnc, i.TokenHint, i.TokenHash = secretEnc, hint, ""
	st.qIntegration(i)
	return true
}

// SetEvents saves the events subscribed on the webhook (from a ping).
func (st *Store) SetEvents(id string, events []string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if i, ok := st.s.Integrations[id]; ok {
		if len(events) > MaxIntegrationEvents {
			events = events[:MaxIntegrationEvents]
		}
		i.Events = append([]string{}, events...)
		st.qIntegration(i)
	}
}

// MaxIntegrationEvents caps the events list kept on an integration.
const MaxIntegrationEvents = 64

// AddEvent records an X-GitHub-Event seen with a valid signature. It persists only when the list changes.
func (st *Store) AddEvent(id, event string) {
	if event == "" || event == "ping" || len(event) > 64 {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok || len(i.Events) >= MaxIntegrationEvents {
		return
	}
	for _, e := range i.Events {
		if e == event {
			return
		}
	}
	i.Events = append(append([]string{}, i.Events...), event)
	st.qIntegration(i)
}

// AdoptOrg sets the integration's org when it has none yet and reports the org now in effect.
func (st *Store) AdoptOrg(id, org string) string {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok {
		return org
	}
	if i.Org == "" && org != "" {
		i.Org = org
		st.qIntegration(i)
	}
	return i.Org
}

// AdoptOwnerType sets the GitHub owner type ("user" or "organization") once; a non-empty value is never overwritten.
func (st *Store) AdoptOwnerType(id, ownerType string) {
	if !ValidOwnerType(ownerType) || ownerType == "" {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if i, ok := st.s.Integrations[id]; ok && i.OwnerType == "" {
		i.OwnerType = ownerType
		st.qIntegration(i)
	}
}

// SetOwnerType overwrites the owner type of a github integration (admin only; "" clears it).
func (st *Store) SetOwnerType(id, ownerType string) (Integration, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok || i.Kind != "github" || !ValidOwnerType(ownerType) {
		return Integration{}, false
	}
	i.OwnerType = ownerType
	st.qIntegration(i)
	return i.public(), true
}

// ValidOwnerType reports whether t is "", "user" or "organization".
func ValidOwnerType(t string) bool { return t == "" || t == "user" || t == "organization" }

// repo returns the state of a repo for update, creating it unless the cap is reached.
func (i *Integration) repo(name string) (RepoState, bool) {
	r, ok := i.Repos[name]
	if !ok {
		if len(i.Repos) >= MaxRepos {
			return r, false
		}
		r = RepoState{Name: name}
	}
	return r, true
}

func (i *Integration) putRepo(r RepoState) {
	if i.Repos == nil {
		i.Repos = map[string]RepoState{}
	}
	i.Repos[r.Name] = r
}

func addEventTo(list []string, event string) []string {
	if event == "" || len(event) > 64 || len(list) >= MaxIntegrationEvents || slices.Contains(list, event) {
		return list
	}
	out := append(append([]string{}, list...), event)
	sort.Strings(out)
	return out
}

// SetRepoHook records the events a repo's own hook subscribes to (from a repo ping) and sets the integration's
// Events to the sorted union over all repos, so the setup page keeps working for personal owners.
func (st *Store) SetRepoHook(id, repo string, private bool, events []string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok || repo == "" {
		return
	}
	r, ok := i.repo(repo)
	if !ok {
		return
	}
	if len(events) > MaxIntegrationEvents {
		events = events[:MaxIntegrationEvents]
	}
	r.Private = private
	r.HookEvents = append([]string{}, events...)
	sort.Strings(r.HookEvents)
	i.putRepo(r)
	var union []string
	for _, rs := range i.Repos {
		for _, e := range rs.HookEvents {
			if !slices.Contains(union, e) {
				union = append(union, e)
			}
		}
	}
	sort.Strings(union)
	if len(union) > MaxIntegrationEvents {
		union = union[:MaxIntegrationEvents]
	}
	i.Events = append([]string{}, union...)
	st.qIntegration(i)
}

// TouchRepo records an accepted delivery for a repo: last event time, privacy and the event name.
func (st *Store) TouchRepo(id, repo string, private bool, event string, at time.Time) {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok || repo == "" {
		return
	}
	r, ok := i.repo(repo)
	if !ok {
		return
	}
	r.Private, r.LastEventAt = private, at.UTC()
	if event != "ping" {
		r.HookEvents = addEventTo(r.HookEvents, event)
	}
	i.putRepo(r)
	st.qIntegration(i)
}

// RegisterProduct registers the org and product for a repo without an event, so an alias can be set early.
func (st *Store) RegisterProduct(org, product, kind string, private bool) {
	vis := ""
	if private {
		vis = Hidden
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	st.touch(org, product, product, vis, kind)
}

// ClaimDelivery atomically records a delivery key for dedupe and bumps the integration's LastEventAt.
// It returns false when the key was already claimed. Single events use AddAccepted instead.
func (st *Store) ClaimDelivery(integration, key string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	k := integration + "\x00" + key
	if _, dup := st.s.Seen[k]; dup {
		return false
	}
	now := time.Now().UTC()
	st.s.Seen[k] = now
	st.q(Op{Kind: OpSeen, Key: k, At: now})
	if i, ok := st.s.Integrations[integration]; ok {
		i.LastEventAt = now
		st.qIntegration(i)
	}
	return true
}

func (st *Store) UpdateIntegration(id string, name, org, feedURL *string) (Integration, bool) {
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
	if feedURL != nil {
		i.FeedURL = *feedURL
	}
	st.qIntegration(i)
	return i.public(), true
}

func (st *Store) RotateToken(id string) (string, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	i, ok := st.s.Integrations[id]
	if !ok || i.Kind == "github" { // github rotates its signing secret via RotateSecret
		return "", false
	}
	plain, hash, hint := NewToken()
	i.TokenHash, i.TokenHint = hash, hint
	st.qIntegration(i)
	return plain, true
}

func (st *Store) DeleteIntegration(id string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	_, ok := st.s.Integrations[id]
	delete(st.s.Integrations, id)
	if ok {
		st.q(Op{Kind: OpIntegrationDel, Key: id})
	}
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

var generatedAlias = regexp.MustCompile(`^Product ([A-Z]|\d{6})$`)

// AliasCustom reports whether an alias was typed by a person: false when it equals the key (public) or matches the
// generated "Product A" / "Product 150405" pattern.
func AliasCustom(alias, key string) bool {
	return alias != key && !generatedAlias.MatchString(alias)
}

// DefaultProductAlias is what resetting the alias of a product would give: the key when public, the current
// alias when it is already generated, else a fresh generated one. "" when the product does not exist.
func (st *Store) DefaultProductAlias(key string) string {
	st.mu.RLock()
	defer st.mu.RUnlock()
	p, ok := st.s.Products[key]
	if !ok {
		return ""
	}
	if !AliasCustom(p.Alias, p.Key) {
		return p.Alias
	}
	if p.Visibility != Hidden {
		return p.Key
	}
	taken := st.productAliases()
	delete(taken, p.Alias)
	return nextAlias("Product", taken)
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

// Touch registers the org and product an event is about, with the source kind. A new product
// takes the visibility the sender reports; after that the back-office setting wins.
func (st *Store) touch(org, product, name, reportedVis, kind string) {
	if org != "" {
		if _, ok := st.s.Orgs[org]; !ok {
			o := &Org{Key: org, Visibility: Public, Alias: org}
			st.s.Orgs[org] = o
			st.qOrg(o)
		}
	}
	if product == "" {
		return
	}
	changed := false
	p, ok := st.s.Products[product]
	if !ok {
		p = &Product{Key: product, Org: org, Name: name, Visibility: Public, Alias: product, Hall: defaultHall(kind)}
		if reportedVis == Hidden {
			p.Visibility = Hidden
			p.Alias = nextAlias("Product", st.productAliases())
		}
		st.s.Products[product] = p
		changed = true
	}
	if p.Org == "" && org != "" {
		p.Org, changed = org, true
	}
	if p.Name == "" && name != "" {
		p.Name, changed = name, true
	}
	if label := map[string]string{"github": "GitHub", "qa": "QA", "gaos": "GAOS", "site": "Site", "animora": "Animora"}[kind]; label != "" && !slices.Contains(p.Sources, label) {
		p.Sources, changed = append(p.Sources, label), true
	}
	if changed {
		st.qProduct(p)
	}
}

func (st *Store) qIntegration(i *Integration) {
	c := i.clone()
	st.q(Op{Kind: OpIntegration, Integration: &c})
}
func (st *Store) qOrg(o *Org) { c := *o; st.q(Op{Kind: OpOrg, Org: &c}) }
func (st *Store) qProduct(p *Product) {
	c := *p
	c.Sources = append([]string(nil), p.Sources...)
	st.q(Op{Kind: OpProduct, Product: &c})
}

func defaultHall(kind string) string {
	if kind == "gaos" {
		return "Article Bureau"
	}
	if kind == "animora" {
		return "Video Studio hall"
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

// LastEventByProduct returns the newest accepted event time per product key, in one pass under the read lock.
func (st *Store) LastEventByProduct() map[string]time.Time {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := map[string]time.Time{}
	for _, e := range st.s.Events {
		if e.Delivery != OK || e.Product == "" {
			continue
		}
		if e.At.After(out[e.Product]) {
			out[e.Product] = e.At
		}
	}
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

// Errors returned by SetOrg. OrgError wraps ErrConflict (409) or ErrInvalid (422) with a message for the client.
var (
	ErrOrgNotFound = errors.New("no such org")
	ErrConflict    = errors.New("conflict")
	ErrInvalid     = errors.New("invalid")
)

type OrgError struct {
	Kind error
	Msg  string
}

func (e *OrgError) Error() string { return e.Msg }
func (e *OrgError) Unwrap() error { return e.Kind }

var (
	generatedOrgAlias = regexp.MustCompile(`^Org ([A-Z]|\d{6})$`)
	orgAliasChars     = regexp.MustCompile(`^[\p{L}\p{N} .,'&()_+\-:#!]+$`)
)

// MaxOrgAliasRunes is the longest public org alias.
const MaxOrgAliasRunes = 60

// OrgAliasCustom reports whether an org alias was typed by a person: non-empty, not the key (any case) and not
// the generated "Org A" / "Org 150405" pattern. A custom alias of a public org is its public display name.
func OrgAliasCustom(o Org) bool {
	return o.Alias != "" && !strings.EqualFold(o.Alias, o.Key) && !generatedOrgAlias.MatchString(o.Alias)
}

// SetOrg changes visibility and/or alias; see docs/api.md for the rules. Visibility is applied first, then the
// alias. Uniqueness is checked under the store lock. An org that does not exist is created (public, alias = key)
// when an integration names it as its org; otherwise ErrOrgNotFound.
func (st *Store) SetOrg(key string, vis, alias *string) (Org, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	o, ok := st.s.Orgs[key]
	if !ok {
		found := false
		for _, in := range st.s.Integrations {
			if in.Org == key && key != "" {
				found = true
				break
			}
		}
		if !found {
			return Org{}, ErrOrgNotFound
		}
		o = &Org{Key: key, Visibility: Public, Alias: key}
	}
	c := *o
	taken := func() map[string]bool { // aliases of the other orgs
		m := st.orgAliases()
		delete(m, o.Alias)
		return m
	}
	if vis != nil && *vis != c.Visibility {
		c.Visibility = *vis
		if *vis == Public {
			if !OrgAliasCustom(c) {
				c.Alias = c.Key
			}
		} else if c.Alias == "" || strings.EqualFold(c.Alias, c.Key) {
			c.Alias = nextAlias("Org", taken())
		}
	}
	if alias != nil {
		a := strings.TrimSpace(*alias)
		switch {
		case a == "" || (c.Visibility == Public && strings.EqualFold(a, c.Key)):
			if c.Visibility == Public {
				c.Alias = c.Key
			} else {
				c.Alias = nextAlias("Org", taken())
			}
		case c.Visibility == Hidden && strings.EqualFold(a, c.Key):
			return Org{}, &OrgError{ErrInvalid, "a hidden org's alias cannot be its key"}
		case utf8.RuneCountInString(a) > MaxOrgAliasRunes:
			return Org{}, &OrgError{ErrInvalid, "alias must be 1-60 characters"}
		case !orgAliasChars.MatchString(a):
			return Org{}, &OrgError{ErrInvalid, "alias may contain only letters, digits, spaces and . , ' & ( ) _ + - : # !"}
		case generatedOrgAlias.MatchString(a):
			return Org{}, &OrgError{ErrInvalid, `"Org A"-style names are reserved; choose another alias`}
		default:
			for _, other := range st.s.Orgs {
				if other.Key == key {
					continue
				}
				if strings.EqualFold(other.Alias, a) || strings.EqualFold(other.Key, a) {
					return Org{}, &OrgError{ErrConflict, "alias is already used by another org"}
				}
			}
			for _, in := range st.s.Integrations {
				// an org that exists only through an integration still owns its key
				if in.Org != "" && in.Org != key && strings.EqualFold(in.Org, a) {
					return Org{}, &OrgError{ErrConflict, "alias is already used by another org"}
				}
			}
			c.Alias = a
		}
	}
	*o = c
	st.s.Orgs[key] = o
	st.qOrg(o)
	return *o, nil
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
	if alias != nil {
		if a := strings.TrimSpace(*alias); a != "" {
			p.Alias = a
		} else if p.Visibility == Hidden && AliasCustom(p.Alias, p.Key) {
			// An empty alias on a hidden product resets it to a generated default.
			taken := st.productAliases()
			delete(taken, p.Alias)
			p.Alias = nextAlias("Product", taken)
		}
	}
	if hall != nil {
		p.Hall = *hall
	}
	st.qProduct(p)
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
	st.q(Op{Kind: OpSeen, Key: k, At: now})
	st.touch(a.Org, a.Product, a.ProductName, a.Vis, a.Kind)
	if i, ok := st.s.Integrations[a.Integration]; ok {
		i.LastEventAt = now
		st.qIntegration(i)
	}
	ev := Event{Seq: st.s.NextSeq, ID: a.ID, Integration: a.Integration, Kind: a.Kind, Type: a.Type, At: a.At, Received: now,
		Delivery: OK, Status: 202, Product: a.Product, Org: a.Org, Raw: a.Raw}
	st.s.NextSeq++
	st.append(ev)
	return ev, true
}

func (st *Store) AddRejected(integration, kind, typ string, status int, reason string) Event {
	return st.AddRejectedRepo(integration, kind, typ, status, reason, "")
}

// AddRejectedRepo is AddRejected for a delivery whose repository is known: the repo becomes the event's Product
// (so rejections can be counted per repo; the event is never public) and, when the repo already exists on the
// integration, its LastRejectedAt is set. A rejection never creates a repo entry.
// The product is not registered: a rejected delivery adds nothing to the town.
func (st *Store) AddRejectedRepo(integration, kind, typ string, status int, reason, repo string) Event {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now().UTC()
	if i, ok := st.s.Integrations[integration]; ok {
		i.LastRejectedAt = now
		if repo != "" {
			// Only a repo the integration already knows: a rejection never adds one.
			if r, ok := i.Repos[repo]; ok {
				r.LastRejectedAt = now
				i.putRepo(r)
			}
		}
		st.qIntegration(i)
	}
	ev := Event{Seq: st.s.NextSeq, Integration: integration, Kind: kind, Type: typ, At: now, Received: now, Delivery: Reject, Status: status, Reason: reason, Product: repo}
	st.s.NextSeq++
	st.append(ev)
	return ev
}

func (st *Store) append(ev Event) {
	st.s.Events = append(st.s.Events, ev)
	if len(st.s.Events) > maxEvents {
		st.s.Events = append([]Event(nil), st.s.Events[len(st.s.Events)-maxEvents:]...)
	}
	e := ev
	st.q(Op{Kind: OpEvent, Event: &e})
}

type Query struct {
	Integration, Type, Delivery, Text, Kind string
	AfterSeq                                int64
	Limit                                   int
	Newest                                  bool // newest first
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
		if q.Kind != "" && e.Kind != q.Kind {
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
	if s.Timezone == "" {
		s.Timezone = st.s.Settings.Timezone
	}
	if s.RetentionDays < 1 {
		s.RetentionDays = 1
	}
	if s.RetentionDays > 3650 {
		s.RetentionDays = 3650
	}
	st.s.Settings = s
	st.q(Op{Kind: OpSettings, Settings: &s})
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
