package admin_test

import (
	"strings"
	"testing"
)

func putOrg(e *env, key, body string) (int, map[string]any) {
	c, m, _ := e.do("PUT", "/api/admin/orgs/"+key, "", body)
	return c, m
}

func TestOrgAliasRules(t *testing.T) {
	e := newEnv(t)
	e.login()
	e.st.RegisterProduct("sismedika", "web", "gaos", false)
	e.st.RegisterProduct("acme", "api", "gaos", false)
	e.st.RegisterProduct("other", "x", "gaos", false)

	// custom alias on a public org
	if c, m := putOrg(e, "sismedika", `{"alias":"  Team Sis  "}`); c != 200 || m["alias"] != "Team Sis" || m["visibility"] != "public" {
		t.Fatalf("custom: %d %v", c, m)
	}
	// reset via empty string and via the key (case-insensitive)
	for _, body := range []string{`{"alias":""}`, `{"alias":"  "}`} {
		putOrg(e, "sismedika", `{"alias":"Team Sis"}`)
		if c, m := putOrg(e, "sismedika", body); c != 200 || m["alias"] != "sismedika" {
			t.Fatalf("reset %s: %d %v", body, c, m)
		}
	}
	putOrg(e, "sismedika", `{"alias":"Team Sis"}`)
	if c, m := putOrg(e, "sismedika", `{"alias":"SISMEDIKA"}`); c != 200 || m["alias"] != "sismedika" {
		t.Fatalf("reset by key: %d %v", c, m)
	}

	// hidden: alias equal to the key is refused, empty resets to a generated alias
	if c, m := putOrg(e, "sismedika", `{"visibility":"hidden"}`); c != 200 || m["alias"] != "Org A" {
		t.Fatalf("hide: %d %v", c, m)
	}
	if c, m := putOrg(e, "sismedika", `{"alias":"SisMedika"}`); c != 422 || !strings.Contains(m["error"].(string), "cannot be its key") {
		t.Fatalf("hidden key alias: %d %v", c, m)
	}
	if c, m := putOrg(e, "sismedika", `{"visibility":"hidden","alias":"sismedika"}`); c != 422 {
		t.Fatalf("hidden+key alias: %d %v", c, m)
	}
	if c, m := putOrg(e, "sismedika", `{"alias":""}`); c != 200 || m["alias"] != "Org A" {
		t.Fatalf("hidden reset: %d %v", c, m)
	}

	// validation
	for _, a := range []string{strings.Repeat("a", 61), `a<b`, `a/b`, "tab\\tx", `emoji 😀`} {
		if c, m := putOrg(e, "acme", `{"alias":"`+a+`"}`); c != 422 {
			t.Fatalf("alias %q: %d %v", a, c, m)
		}
	}
	if c, _ := putOrg(e, "acme", `{"alias":"`+strings.Repeat("é", 60)+`"}`); c != 200 {
		t.Fatalf("60 runes should pass: %d", c)
	}
	if c, m := putOrg(e, "acme", `{"alias":"R&D (Ops)_+-:#! v1.2, it's"}`); c != 200 {
		t.Fatalf("charset: %d %v", c, m)
	}

	// uniqueness against other aliases and other keys, case-insensitive
	putOrg(e, "acme", `{"alias":"Shared Name"}`)
	for _, a := range []string{"shared name", "SHARED NAME", "org a", "ACME"} {
		if c, m := putOrg(e, "other", `{"alias":"`+a+`"}`); c != 409 {
			t.Fatalf("dup %q: %d %v", a, c, m)
		}
	}
	if c, _ := putOrg(e, "acme", `{"alias":"shared NAME"}`); c != 200 {
		t.Fatalf("own alias, other case: %d", c)
	}
}

func TestOrgVisibilityToggleKeepsCustomAlias(t *testing.T) {
	e := newEnv(t)
	e.login()
	e.st.RegisterProduct("acme", "api", "gaos", false)
	putOrg(e, "acme", `{"alias":"Studio X"}`)
	if c, m := putOrg(e, "acme", `{"visibility":"hidden"}`); c != 200 || m["alias"] != "Studio X" {
		t.Fatalf("hide keeps custom: %d %v", c, m)
	}
	if c, m := putOrg(e, "acme", `{"visibility":"public"}`); c != 200 || m["alias"] != "Studio X" {
		t.Fatalf("show keeps custom: %d %v", c, m)
	}
	putOrg(e, "acme", `{"alias":""}`)
	putOrg(e, "acme", `{"visibility":"hidden"}`)
	if c, m := putOrg(e, "acme", `{"visibility":"public"}`); c != 200 || m["alias"] != "acme" {
		t.Fatalf("show resets generated: %d %v", c, m)
	}
	// both fields: visibility first, then alias
	if c, m := putOrg(e, "acme", `{"visibility":"hidden","alias":"Quiet"}`); c != 200 || m["alias"] != "Quiet" || m["visibility"] != "hidden" {
		t.Fatalf("both: %d %v", c, m)
	}
}

func TestOrgCreatedFromIntegrationOrg(t *testing.T) {
	e := newEnv(t)
	e.login()
	if c, _ := putOrg(e, "ghost", `{"alias":"X"}`); c != 404 {
		t.Fatalf("unknown org: %d", c)
	}
	e.st.CreateIntegration("qa", "QA", "lab")
	if c, m := putOrg(e, "lab", `{"alias":"The Lab"}`); c != 200 || m["alias"] != "The Lab" || m["visibility"] != "public" {
		t.Fatalf("create from integration: %d %v", c, m)
	}
	if _, ok := e.st.GetOrg("lab"); !ok {
		t.Fatal("org not stored")
	}
	// a failed change must not create the org
	e.st.CreateIntegration("qa", "QA2", "lab2")
	if c, _ := putOrg(e, "lab2", `{"alias":"bad<"}`); c != 422 {
		t.Fatal("want 422")
	}
	if _, ok := e.st.GetOrg("lab2"); ok {
		t.Fatal("org created despite error")
	}
}

func TestOrgAliasReservedPattern(t *testing.T) {
	e := newEnv(t)
	e.login()
	e.st.RegisterProduct("sismedika", "web", "gaos", false)
	for _, a := range []string{"Org B", "Org Z", "Org 123456"} {
		c, m := putOrg(e, "sismedika", `{"alias":"`+a+`"}`)
		if c != 422 || !strings.Contains(m["error"].(string), "reserved") {
			t.Fatalf("alias %q: %d %v", a, c, m)
		}
	}
	// case differs from the pattern: allowed
	if c, m := putOrg(e, "sismedika", `{"alias":"org b"}`); c != 200 {
		t.Fatalf("lowercase: %d %v", c, m)
	}
}
