package visibility_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

func aliasStore(t *testing.T, alias string) *store.Store {
	st := newStore(t)
	st.RegisterProduct("sismedika", "web", "gaos", false)
	if alias != "" {
		if _, err := st.SetOrg("sismedika", nil, &alias); err != nil {
			t.Fatal(err)
		}
	}
	return st
}

const rawEv = `{"org":"sismedika","product":{"key":"web","name":"web"},"repo":"sismedika-web","task":{"title":"Fix SisMedika login"},
"data":{"url":"https://github.com/sismedika/web","link":"https://x.test/a","text":"by sismedika, developersismedika, sismedika-web, sismedika_x",
"list":["Sismedika","xsismedika",{"url":"https://github.com/other/Sismedika/pull/1","note":"see (sismedika)"}],"n":3}}`

func viewOf(t *testing.T, st *store.Store, raw string) map[string]any {
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	return visibility.View(st, store.Event{Org: "sismedika", Product: "web", Kind: "gaos", Raw: m})
}

func TestViewPublicCustomAliasSubstitutes(t *testing.T) {
	st := aliasStore(t, "Team Sis")
	out := viewOf(t, st, rawEv)
	p := out["payload"].(map[string]any)
	if p["org"] != "Team Sis" {
		t.Fatalf("org %v", p["org"])
	}
	if p["task"].(map[string]any)["title"] != "Fix Team Sis login" {
		t.Fatalf("title %v", p["task"])
	}
	if p["repo"] != "sismedika-web" || !reflect.DeepEqual(p["product"], map[string]any{"key": "web", "name": "web"}) {
		t.Fatalf("product/repo touched: %v %v", p["product"], p["repo"])
	}
	d := p["data"].(map[string]any)
	if _, ok := d["url"]; ok {
		t.Fatal("url with key must be deleted")
	}
	if d["link"] != "https://x.test/a" || d["n"] != float64(3) {
		t.Fatalf("unrelated data changed: %v", d)
	}
	if d["text"] != "by Team Sis, developersismedika, sismedika-web, sismedika_x" {
		t.Fatalf("text %q", d["text"])
	}
	l := d["list"].([]any)
	nested := l[2].(map[string]any)
	if l[0] != "Team Sis" || l[1] != "xsismedika" || nested["note"] != "see (Team Sis)" {
		t.Fatalf("list %v", l)
	}
	if _, ok := nested["url"]; ok {
		t.Fatal("nested url must be deleted")
	}
}

func TestViewPublicAliasEqualsKeyUnchanged(t *testing.T) {
	st := aliasStore(t, "")
	out := viewOf(t, st, rawEv)
	var want map[string]any
	_ = json.Unmarshal([]byte(rawEv), &want)
	if !reflect.DeepEqual(out["payload"], want) {
		t.Fatalf("payload changed: %v", out["payload"])
	}
	st2 := aliasStore(t, "SISMEDIKA") // reset to key
	if !reflect.DeepEqual(viewOf(t, st2, rawEv)["payload"], want) {
		t.Fatal("alias equal to key must be unchanged")
	}
}

func TestViewHiddenUnchangedAndToolKept(t *testing.T) {
	st := aliasStore(t, "Team Sis")
	h := store.Hidden
	if _, err := st.SetOrg("sismedika", &h, nil); err != nil {
		t.Fatal(err)
	}
	p := viewOf(t, st, rawEv)["payload"].(map[string]any)
	if p["org"] != "Team Sis" {
		t.Fatalf("hidden org name %v", p["org"])
	}
	if _, ok := p["task"].(map[string]any)["title"]; ok {
		t.Fatal("title must be stripped")
	}
	if _, ok := p["data"].(map[string]any)["url"]; ok {
		t.Fatal("url must be stripped")
	}
}

func TestViewHiddenProductPublicCustomOrgShowsAlias(t *testing.T) {
	st := aliasStore(t, "Team Sis")
	h := store.Hidden
	st.SetProduct("web", &h, nil, nil)
	p := viewOf(t, st, rawEv)["payload"].(map[string]any)
	if p["org"] != "Team Sis" {
		t.Fatalf("org %v", p["org"])
	}
	if _, ok := p["task"].(map[string]any)["title"]; ok {
		t.Fatal("title must be stripped")
	}
}

func TestTownOwnerNameUsesPublicAlias(t *testing.T) {
	st := newStore(t)
	g := st.CreateSecretIntegration("github", "g", "sismedika", "s", "h")
	st.AdoptOwnerType(g.ID, "organization")
	st.RegisterProduct("sismedika", "web", "github", false)
	a := "Team Sis"
	if _, err := st.SetOrg("sismedika", nil, &a); err != nil {
		t.Fatal(err)
	}
	v, _ := town(t, st)
	if len(v.Owners) != 1 || v.Owners[0].Name != "Team Sis" || v.Owners[0].Type != "organization" || v.Owners[0].Hidden {
		t.Fatalf("%+v", v.Owners)
	}
	if v.Owners[0].Repos[0].Name != "web" {
		t.Fatalf("%+v", v.Owners[0].Repos)
	}
	h := store.Hidden
	st.SetOrg("sismedika", &h, nil)
	v, _ = town(t, st)
	if v.Owners[0].Name != "Team Sis" || v.Owners[0].Type != "" || !v.Owners[0].Hidden {
		t.Fatalf("%+v", v.Owners)
	}
}
