package visibility_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

func town(t *testing.T, st *store.Store) (visibility.TownView, string) {
	t.Helper()
	v := visibility.Town(st, st.Orgs(), st.Products(), st.Integrations(), st.LastEventByProduct())
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return v, string(b)
}

func newStore(t *testing.T) *store.Store {
	st, err := store.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func hide(st *store.Store, org string) {
	h := store.Hidden
	st.SetOrg(org, &h, nil)
}

func TestTownEmpty(t *testing.T) {
	_, body := town(t, newStore(t))
	if body != `{"owners":[],"unowned":[]}` {
		t.Fatalf("got %s", body)
	}
}

func TestTownMasking(t *testing.T) {
	at := time.Date(2026, 11, 23, 8, 0, 0, 0, time.UTC)
	cases := []struct {
		name  string
		setup func(st *store.Store)
		check func(t *testing.T, v visibility.TownView, body string)
	}{
		{"public org and repo, type from integration", func(st *store.Store) {
			g := st.CreateSecretIntegration("github", "g", "alice", "s", "h")
			st.AdoptOwnerType(g.ID, "user")
			st.RegisterProduct("alice", "brain-town", "github", false)
		}, func(t *testing.T, v visibility.TownView, _ string) {
			if len(v.Owners) != 1 || v.Owners[0].Name != "alice" || v.Owners[0].Type != "user" || v.Owners[0].Hidden {
				t.Fatalf("%+v", v)
			}
			if r := v.Owners[0].Repos; len(r) != 1 || r[0].Name != "brain-town" || r[0].Hidden || r[0].LastEventAt != "" {
				t.Fatalf("%+v", r)
			}
		}},
		{"hidden github owner does not reveal its type", func(st *store.Store) {
			g := st.CreateSecretIntegration("github", "g", "acme-secret", "s", "h")
			st.AdoptOwnerType(g.ID, "user")
			st.RegisterProduct("acme-secret", "repo", "github", false)
			hide(st, "acme-secret")
		}, func(t *testing.T, v visibility.TownView, body string) {
			if len(v.Owners) != 1 || !v.Owners[0].Hidden || v.Owners[0].Type != "" {
				t.Fatalf("%+v", v)
			}
			if strings.Contains(body, `"type":"user"`) {
				t.Fatal("owner type leaked: " + body)
			}
		}},
		{"private repo shows alias", func(st *store.Store) {
			st.RegisterProduct("alice", "secret-repo", "github", true)
			st.RegisterProduct("alice", "open", "github", false)
		}, func(t *testing.T, v visibility.TownView, body string) {
			r := v.Owners[0].Repos
			if len(r) != 2 || r[0].Name != "Product A" || !r[0].Hidden || r[1].Name != "open" || r[1].Hidden {
				t.Fatalf("%+v", r)
			}
			if strings.Contains(body, "secret-repo") {
				t.Fatal("real key leaked: " + body)
			}
		}},
		{"hidden org collapses repos to distinct aliases", func(st *store.Store) {
			st.RegisterProduct("acme-secret", "repo-one", "github", false)
			st.RegisterProduct("acme-secret", "repo-two", "github", false)
			hide(st, "acme-secret")
		}, func(t *testing.T, v visibility.TownView, body string) {
			if len(v.Owners) != 1 || v.Owners[0].Name != "Org A" || !v.Owners[0].Hidden {
				t.Fatalf("%+v", v)
			}
			if r := v.Owners[0].Repos; len(r) != 1 || r[0].Name != "Org A" || !r[0].Hidden {
				t.Fatalf("not merged: %+v", r)
			}
			for _, s := range []string{"acme-secret", "repo-one", "repo-two"} {
				if strings.Contains(body, s) {
					t.Fatalf("%q leaked: %s", s, body)
				}
			}
		}},
		{"product without org is unowned", func(st *store.Store) {
			st.RegisterProduct("", "gaos-site", "gaos", false)
			st.RegisterProduct("", "hidden-thing", "gaos", true)
		}, func(t *testing.T, v visibility.TownView, body string) {
			if len(v.Owners) != 0 || len(v.Unowned) != 2 || v.Unowned[0].Name != "Product A" || !v.Unowned[0].Hidden || v.Unowned[1].Name != "gaos-site" {
				t.Fatalf("%+v", v)
			}
			if strings.Contains(body, "hidden-thing") {
				t.Fatal("leak")
			}
		}},
		{"lastEventAt from events and repo state", func(st *store.Store) {
			g := st.CreateSecretIntegration("github", "g", "alice", "s", "h")
			st.AddAccepted(store.Accept{Integration: g.ID, Kind: "github", Key: "k1", ID: "1", Type: "push", At: at, Product: "a", Org: "alice"})
			st.AddAccepted(store.Accept{Integration: g.ID, Kind: "github", Key: "k2", ID: "2", Type: "push", At: at.Add(-time.Hour), Product: "a", Org: "alice"})
			st.RegisterProduct("alice", "b", "github", false)
			st.TouchRepo(g.ID, "b", false, "push", at.Add(time.Minute))
			st.RegisterProduct("alice", "c", "github", false)
		}, func(t *testing.T, v visibility.TownView, _ string) {
			o := v.Owners[0]
			if o.LastEventAt != "2026-11-23T08:01:00Z" {
				t.Fatalf("owner last %q", o.LastEventAt)
			}
			if o.Repos[0].LastEventAt != "2026-11-23T08:00:00Z" || o.Repos[1].LastEventAt != "2026-11-23T08:01:00Z" || o.Repos[2].LastEventAt != "" {
				t.Fatalf("%+v", o.Repos)
			}
		}},
		{"integration org without products still lists, owners sorted", func(st *store.Store) {
			st.CreateSecretIntegration("github", "g", "zed", "s", "h")
			st.RegisterProduct("alpha", "r", "github", false)
		}, func(t *testing.T, v visibility.TownView, body string) {
			if len(v.Owners) != 2 || v.Owners[0].Name != "alpha" || v.Owners[1].Name != "zed" || v.Owners[1].Repos == nil {
				t.Fatalf("%s", body)
			}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := newStore(t)
			c.setup(st)
			v, body := town(t, st)
			c.check(t, v, body)
		})
	}
}
