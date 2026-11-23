package admin_test

import (
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
