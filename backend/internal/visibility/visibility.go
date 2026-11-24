// Package visibility is the single place where hidden orgs and products are masked.
// Every public output (the /events stream through View, the /api/town snapshot through Town) goes through
// Aliases, so hidden names are masked in exactly one place.
//
// Org naming: a hidden org shows its alias ("Hidden org" when empty); a public org shows its alias when it is a
// custom one that differs from the key (store.OrgAliasCustom), else its key (PublicOrgName). For a public org with
// a custom alias, View also replaces the org key, as a whole token, inside payload.data and payload.task.title and
// drops data "url" fields that contain it. It still reveals product/repo names that contain the key, the QA tool
// name, and free text where the key is glued to letters, digits, "-" or "_".
package visibility

import (
	"encoding/json"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/store"
)

type Resolver interface {
	GetOrg(key string) (store.Org, bool)
	GetProduct(key string) (store.Product, bool)
	GetIntegration(id string) (store.Integration, bool)
}

// sensitive data fields removed when the event is about a hidden org or product.
var sensitive = []string{"title", "url", "reason", "step", "spec", "steps", "ref", "label", "branch", "workflow", "check", "channel", "concept", "account", "prompt", "script", "failure"}

// PublicOrgName is the one place that decides how an org is named in public output.
func PublicOrgName(o store.Org) string {
	if o.Visibility == store.Hidden {
		if o.Alias == "" {
			return "Hidden org"
		}
		return o.Alias
	}
	if store.OrgAliasCustom(o) {
		return o.Alias
	}
	return o.Key
}

// orgOf finds the org an event belongs to (the event's own org, else its product's org).
func orgOf(r Resolver, ev store.Event) (store.Org, bool) {
	orgKey := ev.Org
	if orgKey == "" {
		if p, ok := r.GetProduct(ev.Product); ok {
			orgKey = p.Org
		}
	}
	return r.GetOrg(orgKey)
}

// Aliases reports whether the event is hidden and, if so, the public names to show.
func Aliases(r Resolver, ev store.Event) (hidden bool, orgAlias, productAlias string) {
	orgKey := ev.Org
	if p, ok := r.GetProduct(ev.Product); ok {
		productAlias = p.Alias
		if p.Visibility == store.Hidden {
			hidden = true
		}
		if orgKey == "" {
			orgKey = p.Org
		}
	}
	if o, ok := r.GetOrg(orgKey); ok {
		orgAlias = PublicOrgName(o)
		if o.Visibility == store.Hidden {
			hidden = true
			if productAlias == "" || productAlias == ev.Product {
				productAlias = o.Alias
			}
		}
	}
	return
}

// keyRegexps caches the compiled case-insensitive key matcher per org key (bounded by the org count).
var keyRegexps sync.Map

func keyRegexp(key string) *regexp.Regexp {
	if re, ok := keyRegexps.Load(key); ok {
		return re.(*regexp.Regexp)
	}
	re := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(key))
	keyRegexps.Store(key, re)
	return re
}

// View returns the public form of an event. For hidden events the product and org are
// replaced by their aliases and titles, URLs and other free text are removed.
func View(r Resolver, ev store.Event) map[string]any {
	payload := clone(ev.Raw)
	hidden, orgAlias, prodAlias := Aliases(r, ev)
	if o, ok := orgOf(r, ev); ok && o.Visibility == store.Public && store.OrgAliasCustom(o) {
		if _, ok := payload["org"].(string); ok {
			payload["org"] = o.Alias
		}
		re := keyRegexp(o.Key)
		if d, ok := payload["data"]; ok {
			payload["data"] = scrub(d, re, o.Alias)
		}
		if t, ok := payload["task"].(map[string]any); ok {
			if title, ok := t["title"].(string); ok {
				t["title"] = replaceToken(title, re, o.Alias)
			}
		}
	}
	if hidden {
		switch p := payload["product"].(type) {
		case map[string]any:
			p["key"], p["name"], p["visibility"] = prodAlias, prodAlias, store.Hidden
		case string:
			payload["product"] = prodAlias
		}
		if _, ok := payload["org"].(string); ok {
			payload["org"] = orgAlias
		}
		if t, ok := payload["task"].(map[string]any); ok {
			delete(t, "title")
		}
		if d, ok := payload["data"].(map[string]any); ok {
			for _, k := range sensitive {
				delete(d, k)
			}
		}
	}
	out := map[string]any{
		"seq": ev.Seq, "id": ev.ID, "type": ev.Type, "source": ev.Kind,
		"at": ev.At.UTC().Format(time.RFC3339), "payload": payload,
	}
	// QA events carry the admin-chosen tool name (public by design, not masked). Looked up only for qa events.
	if ev.Kind == "qa" {
		if i, ok := r.GetIntegration(ev.Integration); ok && i.Name != "" {
			out["tool"] = i.Name
		}
	}
	return out
}

func isKeyChar(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '_' || b == '-'
}

// tokenSpans returns the spans of s where re matches as a whole token (not glued to [A-Za-z0-9_-]).
func tokenSpans(s string, re *regexp.Regexp) [][]int {
	var out [][]int
	for _, m := range re.FindAllStringIndex(s, -1) {
		if m[0] > 0 && isKeyChar(s[m[0]-1]) || m[1] < len(s) && isKeyChar(s[m[1]]) {
			continue
		}
		out = append(out, m)
	}
	return out
}

func replaceToken(s string, re *regexp.Regexp, alias string) string {
	spans := tokenSpans(s, re)
	if len(spans) == 0 {
		return s
	}
	var b strings.Builder
	last := 0
	for _, m := range spans {
		b.WriteString(s[last:m[0]])
		b.WriteString(alias)
		last = m[1]
	}
	b.WriteString(s[last:])
	return b.String()
}

// scrub walks decoded JSON: strings get the key replaced by the alias; a "url" field containing the key is deleted.
func scrub(v any, re *regexp.Regexp, alias string) any {
	switch x := v.(type) {
	case string:
		return replaceToken(x, re, alias)
	case []any:
		for i := range x {
			x[i] = scrub(x[i], re, alias)
		}
	case map[string]any:
		for k, e := range x {
			if str, ok := e.(string); ok && strings.EqualFold(k, "url") && len(tokenSpans(str, re)) > 0 {
				delete(x, k)
				continue
			}
			x[k] = scrub(e, re, alias)
		}
	}
	return v
}

func clone(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	b, _ := json.Marshal(m)
	out := map[string]any{}
	_ = json.Unmarshal(b, &out)
	return out
}

// TownRepo is one hall of the public town snapshot.
type TownRepo struct {
	Name        string `json:"name"`
	Hidden      bool   `json:"hidden"`
	LastEventAt string `json:"lastEventAt,omitempty"`
}

// TownOwner is one gate of the public town snapshot.
type TownOwner struct {
	Name        string     `json:"name"`
	Type        string     `json:"type"`
	Hidden      bool       `json:"hidden"`
	LastEventAt string     `json:"lastEventAt,omitempty"`
	Repos       []TownRepo `json:"repos"`
}

// TownView is the public, masked GET /api/town body.
type TownView struct {
	Owners  []TownOwner `json:"owners"`
	Unowned []TownRepo  `json:"unowned"`
	// Timezone is the configured IANA zone for every time the town shows (set by the /api/town handler).
	Timezone string `json:"timezone,omitempty"`
}

// Town builds the public snapshot of owners and repos. Names go through Aliases, so a hidden org or product shows
// only its alias; repos that share a public name inside one owner are merged. lastProduct is the newest accepted
// event time per product key; integrations contribute the owner type and per-repo state of github integrations.
func Town(r Resolver, orgs []store.Org, products []store.Product, integrations []store.Integration, lastProduct map[string]time.Time) TownView {
	type acc struct {
		hidden bool
		last   time.Time
	}
	type owner struct {
		name, typ string
		hidden    bool
		repos     map[string]*acc
	}
	repoState := map[string]time.Time{} // org\x00repo -> newest RepoState.LastEventAt
	typeOf := map[string]string{}
	withGH := map[string]bool{}
	for _, in := range integrations {
		if in.Kind != "github" || in.Org == "" {
			continue
		}
		withGH[in.Org] = true
		if typeOf[in.Org] == "" {
			typeOf[in.Org] = in.OwnerType
		}
		for name, rs := range in.Repos {
			if k := in.Org + "\x00" + name; rs.LastEventAt.After(repoState[k]) {
				repoState[k] = rs.LastEventAt
			}
		}
	}
	orgByKey := map[string]store.Org{}
	for _, o := range orgs {
		orgByKey[o.Key] = o
	}
	for k := range withGH { // a github integration's org that has no stored org yet is public by default
		if _, ok := orgByKey[k]; !ok {
			orgByKey[k] = store.Org{Key: k, Visibility: store.Public, Alias: k}
			orgs = append(orgs[:len(orgs):len(orgs)], orgByKey[k])
		}
	}
	add := func(m map[string]*acc, p store.Product, org string) {
		hidden, _, alias := Aliases(r, store.Event{Product: p.Key, Org: p.Org})
		name := p.Key
		if hidden {
			name = alias
			if name == "" {
				name = "Hidden"
			}
		}
		a := m[name]
		if a == nil {
			a = &acc{}
			m[name] = a
		}
		a.hidden = a.hidden || hidden
		if t := lastProduct[p.Key]; t.After(a.last) {
			a.last = t
		}
		if t := repoState[org+"\x00"+p.Key]; org != "" && t.After(a.last) {
			a.last = t
		}
	}
	flat := func(m map[string]*acc) ([]TownRepo, time.Time) {
		out := make([]TownRepo, 0, len(m))
		var last time.Time
		for n, a := range m {
			tr := TownRepo{Name: n, Hidden: a.hidden}
			if !a.last.IsZero() {
				tr.LastEventAt = a.last.UTC().Format(time.RFC3339)
				if a.last.After(last) {
					last = a.last
				}
			}
			out = append(out, tr)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		return out, last
	}

	byOrg := map[string]map[string]*acc{}
	unowned := map[string]*acc{}
	for _, p := range products {
		if slices.Contains(p.Sources, "Animora") && !slices.Contains(p.Sources, "GitHub") {
			continue // Animora is a video studio, not a GitHub Valley gate or hall
		}
		if _, ok := orgByKey[p.Org]; p.Org == "" || !ok {
			add(unowned, p, "")
			continue
		}
		if byOrg[p.Org] == nil {
			byOrg[p.Org] = map[string]*acc{}
		}
		add(byOrg[p.Org], p, p.Org)
	}

	view := TownView{Owners: []TownOwner{}}
	for _, o := range orgs {
		repos, has := byOrg[o.Key]
		if !has && !withGH[o.Key] {
			continue
		}
		name := PublicOrgName(o)
		hidden := o.Visibility == store.Hidden
		typ := typeOf[o.Key]
		if hidden {
			typ = "" // the type of an alias would reveal a personal account
		}
		rs, last := flat(repos)
		ow := TownOwner{Name: name, Type: typ, Hidden: hidden, Repos: rs}
		if !last.IsZero() {
			ow.LastEventAt = last.UTC().Format(time.RFC3339)
		}
		view.Owners = append(view.Owners, ow)
	}
	sort.Slice(view.Owners, func(i, j int) bool { return view.Owners[i].Name < view.Owners[j].Name })
	view.Unowned, _ = flat(unowned)
	return view
}
