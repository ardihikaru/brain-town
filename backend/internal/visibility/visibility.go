// Package visibility is the single place where hidden orgs and products are masked.
// Every public output (the /events stream through View, the /api/town snapshot through Town) goes through
// Aliases, so hidden names are masked in exactly one place.
package visibility

import (
	"encoding/json"
	"sort"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/store"
)

type Resolver interface {
	GetOrg(key string) (store.Org, bool)
	GetProduct(key string) (store.Product, bool)
	GetIntegration(id string) (store.Integration, bool)
}

// sensitive data fields removed when the event is about a hidden org or product.
var sensitive = []string{"title", "url", "reason", "step", "spec", "steps", "ref", "label", "branch", "workflow", "check"}

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
		orgAlias = o.Alias
		if o.Visibility == store.Hidden {
			hidden = true
			if productAlias == "" || productAlias == ev.Product {
				productAlias = o.Alias
			}
		}
	}
	return
}

// View returns the public form of an event. For hidden events the product and org are
// replaced by their aliases and titles, URLs and other free text are removed.
func View(r Resolver, ev store.Event) map[string]any {
	payload := clone(ev.Raw)
	if hidden, orgAlias, prodAlias := Aliases(r, ev); hidden {
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
		name := o.Key
		hidden := o.Visibility == store.Hidden
		typ := typeOf[o.Key]
		if hidden {
			typ = "" // the type of an alias would reveal a personal account
			if name = o.Alias; name == "" {
				name = "Hidden org"
			}
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
