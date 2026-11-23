package admin_test

import (
	"strings"
	"testing"

	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

func (e *env) create(kind, name string) (int, map[string]any) {
	c, m, _ := e.do("POST", "/api/admin/integrations", "", `{"kind":"`+kind+`","name":"`+name+`"}`)
	return c, m
}

func TestQANameUniqueOnCreate(t *testing.T) {
	e := newEnv(t)
	e.login()
	if c, _ := e.create("qa", "QA · Sismedika"); c != 201 {
		t.Fatalf("first qa want 201 got %d", c)
	}
	for _, n := range []string{"QA · Sismedika", "qa · sismedika", "  QA · SISMEDIKA  "} {
		if c, m := e.create("qa", n); c != 409 || m["error"] == nil {
			t.Fatalf("dup %q want 409 got %d %v", n, c, m)
		}
	}
	if c, _ := e.create("qa", "QA · Personal"); c != 201 {
		t.Fatalf("different name want 201 got %d", c)
	}
	// Other kinds are not constrained by QA names.
	if c, _ := e.create("gaos", "QA · Sismedika"); c != 201 {
		t.Fatalf("gaos same name want 201 got %d", c)
	}
	if c, _ := e.create("gaos", "QA · Sismedika"); c != 201 {
		t.Fatalf("gaos dup want 201 got %d", c)
	}
	if c, _ := e.create("github", "QA · Sismedika"); c == 409 {
		t.Fatalf("github must not 409 on qa name")
	}
}

func TestQANameUniqueOnRename(t *testing.T) {
	e := newEnv(t)
	e.login()
	_, _ = e.integration("qa", "Alpha")
	idB, _ := e.integration("qa", "Beta")
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+idB, "", `{"name":"alpha"}`); c != 409 {
		t.Fatalf("rename dup want 409 got %d", c)
	}
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+idB, "", `{"name":"BETA"}`); c != 200 {
		t.Fatalf("rename to own name (case) want 200 got %d", c)
	}
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+idB, "", `{"org":"x"}`); c != 200 {
		t.Fatalf("patch without name want 200 got %d", c)
	}
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+idB, "", `{"name":"Gamma"}`); c != 200 {
		t.Fatalf("rename unique want 200 got %d", c)
	}
}

func TestQAOrgFilledAndToolOnView(t *testing.T) {
	e := newEnv(t)
	e.login()
	c, m := e.create("qa", "QA · Personal")
	if c != 201 {
		t.Fatal(c)
	}
	id, tok := m["integration"].(map[string]any)["id"].(string), m["token"].(string)
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+id, "", `{"org":"acme"}`); c != 200 {
		t.Fatalf("patch org %d", c)
	}
	post := func(body string) {
		if c, _, b := e.do("POST", "/ingest/qa/"+id, tok, body); c != 202 {
			t.Fatalf("ingest %d %s", c, b)
		}
	}
	post(`{"id":"q1","type":"qa.run.started","at":"2026-11-21T09:00:00Z","product":"web","run":"r1"}`)
	post(`{"id":"q2","type":"qa.run.started","at":"2026-11-21T09:00:01Z","product":"web","run":"r2","org":"other"}`)
	evs := e.st.Events(store.Query{})
	orgs := map[string]string{}
	for _, ev := range evs {
		orgs[ev.ID] = ev.Org
		if ev.Raw["org"] != ev.Org {
			t.Fatalf("raw org %v != %q", ev.Raw["org"], ev.Org)
		}
		v := visibility.View(e.st, ev)
		if v["tool"] != "QA · Personal" {
			t.Fatalf("tool = %v", v["tool"])
		}
	}
	if orgs["q1"] != "acme" || orgs["q2"] != "other" {
		t.Fatalf("orgs %v", orgs)
	}
	// Deleted integration: no tool.
	if c, _, _ := e.do("DELETE", "/api/admin/integrations/"+id, "", ""); c != 204 {
		t.Fatalf("delete %d", c)
	}
	left := e.st.Events(store.Query{})
	if len(left) != 2 {
		t.Fatalf("events kept after delete: %d", len(left))
	}
	for _, ev := range left {
		if _, has := visibility.View(e.st, ev)["tool"]; has {
			t.Fatal("deleted integration must omit tool")
		}
	}
}

func TestNonQAEventHasNoTool(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("gaos", "GAOS")
	if c, _, b := e.do("POST", "/ingest/gaos/"+id, tok, gaosEv); c != 202 {
		t.Fatalf("%d %s", c, b)
	}
	for _, ev := range e.st.Events(store.Query{}) {
		if _, has := visibility.View(e.st, ev)["tool"]; has {
			t.Fatal("non-qa must not carry tool")
		}
	}
}

func TestRenameEveryKind(t *testing.T) {
	e := newEnv(t)
	e.login()
	long := make([]byte, 81)
	for i := range long {
		long[i] = 'x'
	}
	for _, kind := range []string{"qa", "github", "gaos", "site"} {
		id, _ := e.integration(kind, "Orig "+kind)
		e.integration(kind, "Other "+kind)
		url := "/api/admin/integrations/" + id
		c, m, _ := e.do("PATCH", url, "", `{"name":"  New `+kind+`  "}`)
		if c != 200 || m["name"] != "New "+kind {
			t.Fatalf("%s rename %d %v", kind, c, m)
		}
		for _, bad := range []string{"", "   ", string(long)} {
			if c, _, _ := e.do("PATCH", url, "", `{"name":"`+bad+`"}`); c != 422 {
				t.Fatalf("%s bad name len %d want 422 got %d", kind, len(bad), c)
			}
		}
		if c, _, _ := e.do("PATCH", url, "", `{"name":"OTHER `+kind+`"}`); c != 409 {
			t.Fatalf("%s dup want 409 got %d", kind, c)
		}
		if c, _, _ := e.do("PATCH", url, "", `{"name":"NEW `+kind+`"}`); c != 200 {
			t.Fatalf("%s own name case want 200 got %d", kind, c)
		}
	}
	// Same name on a different kind is fine.
	a, _ := e.integration("gaos", "Shared")
	e.integration("site", "Taken")
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+a, "", `{"name":"taken"}`); c != 200 {
		t.Fatalf("cross-kind want 200 got %d", c)
	}
	for _, body := range []string{`{"name":""}`, `{"name":"x"}`} {
		if c, _, _ := e.do("PATCH", "/api/admin/integrations/nope", "", body); c != 404 {
			t.Fatalf("unknown id %s want 404 got %d", body, c)
		}
	}
}

func TestGithubRenameKeepsOwner(t *testing.T) {
	e := newEnv(t)
	e.login()
	c, m, b := e.do("POST", "/api/admin/integrations", "", `{"kind":"github","name":"GH","org":"acme","ownerType":"organization"}`)
	if c != 201 {
		t.Fatalf("create %d %s", c, b)
	}
	id := m["integration"].(map[string]any)["id"].(string)
	c, m, _ = e.do("PATCH", "/api/admin/integrations/"+id, "", `{"name":"Renamed"}`)
	if c != 200 || m["name"] != "Renamed" || m["org"] != "acme" || m["ownerType"] != "organization" {
		t.Fatalf("rename %d %v", c, m)
	}
}

func TestRenameShowsOnNextView(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("qa", "Before")
	if c, _, b := e.do("POST", "/ingest/qa/"+id, tok, `{"id":"q1","type":"qa.run.started","at":"2026-11-21T09:00:00Z","product":"web","run":"r1"}`); c != 202 {
		t.Fatalf("ingest %d %s", c, b)
	}
	view := func() any {
		for _, ev := range e.st.Events(store.Query{}) {
			return visibility.View(e.st, ev)["tool"]
		}
		return nil
	}
	if view() != "Before" {
		t.Fatalf("tool %v", view())
	}
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+id, "", `{"name":" After "}`); c != 200 {
		t.Fatal(c)
	}
	if view() != "After" {
		t.Fatalf("tool after rename %v", view())
	}
}

func TestIntegrationNameLengthCountsCharacters(t *testing.T) {
	e := newEnv(t)
	e.login()
	ok := strings.Repeat("·", 80)
	if c, _ := e.create("qa", ok); c != 201 {
		t.Fatalf("80 runes create want 201 got %d", c)
	}
	if c, _ := e.create("qa", ok+"·"); c != 422 {
		t.Fatalf("81 runes create want 422 got %d", c)
	}
	if c, _ := e.create("gaos", "  "+ok+"  "); c != 201 {
		t.Fatalf("80 runes padded create want 201 got %d", c)
	}
	id, _ := e.integration("qa", "Short")
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+id, "", `{"name":"`+strings.Repeat("é", 80)+`"}`); c != 200 {
		t.Fatalf("80 runes rename want 200 got %d", c)
	}
	if c, _, _ := e.do("PATCH", "/api/admin/integrations/"+id, "", `{"name":"`+strings.Repeat("·", 81)+`"}`); c != 422 {
		t.Fatalf("81 runes rename want 422 got %d", c)
	}
}
