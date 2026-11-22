// Package visibility is the single place where hidden orgs and products are masked.
// Every public output (the /events stream) goes through View.
package visibility

import (
	"encoding/json"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/store"
)

type Resolver interface {
	GetOrg(key string) (store.Org, bool)
	GetProduct(key string) (store.Product, bool)
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
	return map[string]any{
		"seq": ev.Seq, "id": ev.ID, "type": ev.Type, "source": ev.Kind,
		"at": ev.At.UTC().Format(time.RFC3339), "payload": payload,
	}
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
