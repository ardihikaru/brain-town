package admin_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/store"
)

func TestGithubOwnerTypeCreateAndUpdate(t *testing.T) {
	e := newEnv(t)
	e.login()
	cases := []struct {
		body string
		code int
		want string
	}{
		{`{"kind":"github","name":"a","org":"alice","ownerType":"user"}`, 201, "user"},
		{`{"kind":"github","name":"b","org":"acme","ownerType":"organization"}`, 201, "organization"},
		{`{"kind":"github","name":"c"}`, 201, ""},
		{`{"kind":"github","name":"d","ownerType":"team"}`, 422, ""},
		{`{"kind":"qa","name":"q","ownerType":"team"}`, 201, ""}, // ignored for other kinds
	}
	var first string
	for _, c := range cases {
		code, m, _ := e.do("POST", "/api/admin/integrations", "", c.body)
		if code != c.code {
			t.Fatalf("%s: got %d", c.body, code)
		}
		if code != 201 {
			continue
		}
		i := m["integration"].(map[string]any)
		if i["ownerType"] != c.want {
			t.Errorf("%s: ownerType = %v, want %q", c.body, i["ownerType"], c.want)
		}
		if first == "" {
			first = i["id"].(string)
		}
	}
	if c, m, _ := e.do("PATCH", "/api/admin/integrations/"+first, "", `{"ownerType":"organization"}`); c != 200 || m["ownerType"] != "organization" {
		t.Errorf("patch: %d %v", c, m)
	}
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+first, "", `{"ownerType":"bogus"}`); c != 422 {
		t.Errorf("patch invalid: %d", c)
	}
}

func TestListShowsOwnerTypeAndRepos(t *testing.T) {
	e := newEnv(t)
	e.login()
	g := e.st.CreateSecretIntegration("github", "alice", "alice", "sealed", "wxyz")
	e.st.AdoptOwnerType(g.ID, "user")
	e.st.SetRepoHook(g.ID, "zeta", false, []string{"issues"})
	e.st.SetRepoHook(g.ID, "gaos", true, []string{"pull_request", "issues"})
	e.st.RegisterProduct("alice", "zeta", "github", false)
	e.st.RegisterProduct("alice", "gaos", "github", true)
	e.st.TouchRepo(g.ID, "gaos", true, "issues", time.Now())
	for _, k := range []string{"d1", "d2", "d3"} {
		e.st.AddAccepted(store.Accept{Integration: g.ID, Kind: "github", Key: k, ID: k, Type: "issue.opened", At: time.Now(),
			Product: "gaos", ProductName: "gaos", Vis: store.Hidden, Org: "alice", Raw: map[string]any{}})
	}
	e.st.AddRejectedRepo(g.ID, "github", "issues", 422, "bad", "zeta")
	qa, _ := e.st.CreateIntegration("qa", "QA", "")

	_, _, raw := e.do("GET", "/api/admin/integrations", "", "")
	var list []map[string]any
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	by := map[string]map[string]any{}
	for _, r := range list {
		by[r["id"].(string)] = r
	}
	if r, ok := by[qa.ID]["repos"].([]any); !ok || len(r) != 0 || by[qa.ID]["ownerType"] != "" {
		t.Errorf("non-github row: repos=%#v ownerType=%v", by[qa.ID]["repos"], by[qa.ID]["ownerType"])
	}
	row := by[g.ID]
	if row["ownerType"] != "user" {
		t.Errorf("ownerType = %v", row["ownerType"])
	}
	repos := row["repos"].([]any)
	if len(repos) != 2 || repos[0].(map[string]any)["name"] != "gaos" || repos[1].(map[string]any)["name"] != "zeta" {
		t.Fatalf("repos not sorted by name: %s", raw)
	}
	r := repos[0].(map[string]any)
	if r["private"] != true || r["today"].(float64) != 3 || r["rejected"].(float64) != 0 || r["product"] != "gaos" ||
		r["visibility"] != "hidden" || r["alias"] != "Product A" || r["aliasCustom"] != false || r["defaultAlias"] != "Product A" ||
		!reflect.DeepEqual(r["hookEvents"], []any{"issues", "pull_request"}) || r["lastEventAt"] == nil || r["lastRejectedAt"] == nil {
		t.Errorf("gaos row: %v", r)
	}
	z := repos[1].(map[string]any)
	if z["today"].(float64) != 0 || z["rejected"].(float64) != 1 || z["visibility"] != "public" || z["alias"] != "zeta" || z["aliasCustom"] != false {
		t.Errorf("zeta row: %v", z)
	}
	if row["today"].(float64) != 3 || row["errors"].(float64) != 1 {
		t.Errorf("integration totals: %v %v", row["today"], row["errors"])
	}
}

func TestRepoWithoutProductFallsBackToPrivacy(t *testing.T) {
	e := newEnv(t)
	e.login()
	g := e.st.CreateSecretIntegration("github", "alice", "alice", "sealed", "wxyz")
	e.st.TouchRepo(g.ID, "solo", true, "push", time.Now())
	_, _, raw := e.do("GET", "/api/admin/integrations", "", "")
	var list []map[string]any
	_ = json.Unmarshal(raw, &list)
	r := list[0]["repos"].([]any)[0].(map[string]any)
	if r["product"] != "" || r["visibility"] != "hidden" || r["alias"] != "" {
		t.Errorf("no product yet: %v", r)
	}
}

func TestEmptyAliasResetsHiddenProductOnly(t *testing.T) {
	e := newEnv(t)
	e.login()
	e.st.RegisterProduct("alice", "gaos", "github", true)  // hidden, "Product A"
	e.st.RegisterProduct("alice", "site", "github", false) // public
	put := func(key, body string) map[string]any {
		c, m, _ := e.do("PUT", "/api/admin/products/"+key, "", body)
		if c != 200 {
			t.Fatalf("%s %s: %d", key, body, c)
		}
		return m
	}
	if a := put("gaos", `{"alias":"Falcon"}`)["alias"]; a != "Falcon" {
		t.Fatalf("custom alias: %v", a)
	}
	_, _, raw := e.do("GET", "/api/admin/products", "", "")
	if !strings.Contains(string(raw), "Falcon") {
		t.Fatal("alias missing from products")
	}
	if a := put("gaos", `{"alias":"  "}`)["alias"]; a != "Product A" {
		t.Errorf("reset: alias = %v, want Product A", a)
	}
	if a := put("gaos", `{"alias":""}`)["alias"]; a != "Product A" {
		t.Errorf("reset of a generated alias must keep it: %v", a)
	}
	if a := put("site", `{"alias":""}`)["alias"]; a != "site" {
		t.Errorf("public empty alias must be a no-op: %v", a)
	}
	if m := put("gaos", `{"hall":"Imago"}`); m["alias"] != "Product A" || m["hall"] != "Imago" {
		t.Errorf("other fields unchanged: %v", m)
	}
}

func TestPublicStreamNeverCarriesRejectedOrHiddenRepo(t *testing.T) {
	e := newEnv(t)
	e.login()
	g := e.st.CreateSecretIntegration("github", "alice", "alice", "sealed", "wxyz")
	acc := func(k, repo, vis string) {
		e.st.AddAccepted(store.Accept{Integration: g.ID, Kind: "github", Key: k, ID: k, Type: "issue.opened", At: time.Now(),
			Product: repo, ProductName: repo, Vis: vis, Org: "alice",
			Raw: map[string]any{"id": k, "product": map[string]any{"key": repo, "name": repo}, "org": "alice", "data": map[string]any{"title": "Top secret"}}})
	}
	acc("k0", "open-repo", "")
	e.st.AddRejectedRepo(g.ID, "github", "issues", 422, "delivery is for another organisation", "hidden-repo")
	acc("k2", "hidden-repo", store.Hidden)

	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.srv.URL+"/events", nil)
	req.Header.Set("Last-Event-ID", "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body) // returns when the context times out
	out := string(b)
	if !strings.Contains(out, "id: 3") {
		t.Fatalf("accepted event not replayed: %q", out)
	}
	for _, leak := range []string{"id: 2", "another organisation", "hidden-repo", "Top secret"} {
		if strings.Contains(out, leak) {
			t.Errorf("public stream leaks %q: %s", leak, out)
		}
	}
}
