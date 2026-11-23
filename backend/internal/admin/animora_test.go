package admin_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

func animoraBody(id, typ, data string) string {
	return `{"id":"` + id + `","type":"` + typ + `","at":"2026-11-23T08:00:00Z","data":` + data + `}`
}

func TestAnimoraIngest(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("animora", "Animora prod")
	if id == "" || !strings.HasPrefix(id, "animora-") {
		t.Fatalf("id %q", id)
	}
	// A second animora integration with the same name is allowed (no unique-name rule).
	if c, _, b := e.do("POST", "/api/admin/integrations", "", `{"kind":"animora","name":"Animora prod"}`); c != 201 {
		t.Fatalf("duplicate name %d %s", c, b)
	}
	path := "/ingest/animora/" + id
	pub := animoraBody("video-a1-youtube-x1", "video.published", `{"vendor":"youtube","title":" Hello ","url":"https://youtu.be/x1","channel":"Kanal","publishedAt":"2026-11-23T07:00:00Z"}`)
	if c, _, b := e.do("POST", path, tok, pub); c != 202 {
		t.Fatalf("accept %d %s", c, b)
	}
	if c, _, _ := e.do("POST", path, tok, pub); c != 409 {
		t.Fatalf("dedupe %d", c)
	}
	if c, _, _ := e.do("POST", path, "bt_live_wrong", pub); c != 401 {
		t.Fatalf("wrong token %d", c)
	}
	_, qaTok := e.integration("qa", "QA x")
	if c, _, _ := e.do("POST", path, qaTok, pub); c != 401 {
		t.Fatalf("token of another kind %d", c)
	}
	evs := e.st.Events(store.Query{Delivery: "ok"})
	if len(evs) != 1 {
		t.Fatalf("events %d", len(evs))
	}
	ev := evs[0]
	if ev.Product != "animora" || ev.Kind != "animora" || ev.Raw["product"] != "animora" {
		t.Fatalf("%+v", ev)
	}
	if d := ev.Raw["data"].(map[string]any); d["title"] != "Hello" {
		t.Fatalf("title not trimmed: %v", d)
	}
	for _, p := range e.st.Products() {
		if p.Key == "animora" && (p.Name != "Animora" || p.Hall != "Video Studio hall" || len(p.Sources) != 1 || p.Sources[0] != "Animora" || p.Visibility != store.Public) {
			t.Fatalf("product %+v", p)
		}
	}
}

func TestAnimoraValidation(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("animora", "A")
	path := "/ingest/animora/" + id
	cases := []struct{ name, body, field string }{
		{"bad vendor", animoraBody("a1", "video.published", `{"vendor":"vimeo","title":"t","url":"https://x.id/v"}`), "data.vendor"},
		{"missing vendor", animoraBody("a2", "video.scheduled", `{"title":"t","dueAt":"2026-11-24T00:00:00Z"}`), "data.vendor"},
		{"missing title", animoraBody("a3", "video.rendered", `{"channel":"c"}`), "data.title"},
		{"blank title", animoraBody("a3b", "video.publish_failed", `{"vendor":"youtube","title":"   "}`), "data.title"},
		{"http url", animoraBody("a4", "video.published", `{"vendor":"youtube","title":"t","url":"http://x.id/v"}`), "data.url"},
		{"missing url", animoraBody("a4b", "video.published", `{"vendor":"youtube","title":"t"}`), "data.url"},
		{"bad dueAt", animoraBody("a5", "video.scheduled", `{"vendor":"youtube","title":"t","dueAt":"tomorrow"}`), "data.dueAt"},
		{"missing dueAt", animoraBody("a5b", "video.scheduled", `{"vendor":"youtube","title":"t"}`), "data.dueAt"},
		{"bad publishedAt", animoraBody("a6", "video.published", `{"vendor":"youtube","title":"t","url":"https://x.id/v","publishedAt":"x"}`), "data.publishedAt"},
		{"channel.connected without channel", animoraBody("a7", "channel.connected", `{"vendor":"youtube"}`), "data.channel"},
		{"unknown type", animoraBody("a8", "video.deleted", `{}`), "type"},
		{"bad at", `{"id":"a9","type":"video.rendered","at":"x","data":{"title":"t"}}`, "at"},
	}
	for _, c := range cases {
		code, m, b := e.do("POST", path, tok, c.body)
		if code != 422 || m["field"] != c.field {
			t.Errorf("%s: %d %s, want 422 field %s", c.name, code, b, c.field)
		}
	}
	if n := len(e.st.Events(store.Query{Delivery: "ok"})); n != 0 {
		t.Fatalf("%d events accepted", n)
	}
}

func TestAnimoraScrub(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("animora", "A")
	path := "/ingest/animora/" + id
	post := func(body string) map[string]any {
		t.Helper()
		if c, _, b := e.do("POST", path, tok, body); c != 202 {
			t.Fatalf("%d %s", c, b)
		}
		evs := e.st.Events(store.Query{Newest: true, Limit: 1})
		return evs[0].Raw
	}
	raw := post(`{"id":"r1","type":"video.rendered","at":"2026-11-23T08:00:00Z","product":"evil","org":"evil","secret":1,
	  "data":{"title":"T","channel":"C","language":"id","duration":12.5,"format":"short","prompt":"p","script":"s","failure":"f","extra":"x"}}`)
	if raw["product"] != "animora" {
		t.Fatalf("product %v", raw["product"])
	}
	if _, has := raw["org"]; has {
		t.Fatalf("org taken from body: %v", raw["org"])
	}
	if _, has := raw["secret"]; has {
		t.Fatal("top-level extra kept")
	}
	d := raw["data"].(map[string]any)
	want := map[string]any{"title": "T", "channel": "C", "language": "id", "duration": 12.5}
	if len(d) != len(want) {
		t.Fatalf("data %v", d)
	}
	for k, v := range want {
		if d[k] != v {
			t.Fatalf("data %v", d)
		}
	}
	d = post(animoraBody("r2", "video.rendered", `{"title":"T","format":"reel","duration":-3}`))["data"].(map[string]any)
	if d["format"] != "reel" || d["duration"] != nil {
		t.Fatalf("data %v", d)
	}
	d = post(animoraBody("r3", "channel.connected", `{"vendor":"tiktok","channel":"C","account":"me@mail.com"}`))["data"].(map[string]any)
	if _, has := d["account"]; has {
		t.Fatalf("email account kept: %v", d)
	}
	d = post(animoraBody("r4", "channel.connected", `{"vendor":"tiktok","channel":"C","account":"My Account"}`))["data"].(map[string]any)
	if d["account"] != "My Account" {
		t.Fatalf("data %v", d)
	}
	d = post(animoraBody("r5", "video.publish_failed", `{"vendor":"youtube","title":"`+strings.Repeat("x", 300)+`","failure":"quota"}`))["data"].(map[string]any)
	if len(d["title"].(string)) != 200 || d["failure"] != nil {
		t.Fatalf("data %v", d)
	}
}

func TestAnimoraOrgFromIntegration(t *testing.T) {
	e := newEnv(t)
	e.login()
	c, m, b := e.do("POST", "/api/admin/integrations", "", `{"kind":"animora","name":"A","org":"studio"}`)
	if c != 201 {
		t.Fatalf("%d %s", c, b)
	}
	id, tok := m["integration"].(map[string]any)["id"].(string), m["token"].(string)
	if c, _, b := e.do("POST", "/ingest/animora/"+id, tok, animoraBody("o1", "video.rendered", `{"title":"T"}`)); c != 202 {
		t.Fatalf("%d %s", c, b)
	}
	ev := e.st.Events(store.Query{Delivery: "ok"})[0]
	if ev.Org != "studio" || ev.Raw["org"] != "studio" {
		t.Fatalf("%+v", ev)
	}
	// The Animora product must not appear as a GitHub Valley gate or hall.
	town := visibility.Town(e.st, e.st.Orgs(), e.st.Products(), e.st.Integrations(), e.st.LastEventByProduct())
	if b, _ := json.Marshal(town); string(b) != `{"owners":[],"unowned":[]}` {
		t.Fatalf("town leaks animora: %s", b)
	}
}

func TestAnimoraMasking(t *testing.T) {
	for _, hideWhat := range []string{"product", "org"} {
		e := newEnv(t)
		e.login()
		_, m, _ := e.do("POST", "/api/admin/integrations", "", `{"kind":"animora","name":"A","org":"studio"}`)
		id, tok := m["integration"].(map[string]any)["id"].(string), m["token"].(string)
		body := animoraBody("m1", "video.published", `{"vendor":"youtube","channel":"Kanal","title":"Secret title","url":"https://youtu.be/x","publishedAt":"2026-11-23T07:00:00Z"}`)
		if c, _, b := e.do("POST", "/ingest/animora/"+id, tok, body); c != 202 {
			t.Fatalf("%d %s", c, b)
		}
		h := store.Hidden
		if hideWhat == "product" {
			e.st.SetProduct("animora", &h, nil, nil)
		} else {
			e.st.SetOrg("studio", &h, nil)
		}
		v := visibility.View(e.st, e.st.Events(store.Query{Delivery: "ok"})[0])
		out, _ := json.Marshal(v)
		for _, leak := range []string{"Secret title", "youtu.be", "Kanal", `"title"`, `"channel"`, `"url"`} {
			if strings.Contains(string(out), leak) {
				t.Fatalf("hidden %s leaks %q: %s", hideWhat, leak, out)
			}
		}
		d := v["payload"].(map[string]any)["data"].(map[string]any)
		if d["vendor"] != "youtube" || d["publishedAt"] != "2026-11-23T07:00:00Z" {
			t.Fatalf("hidden %s: vendor/publishedAt lost: %v", hideWhat, d)
		}
		if hideWhat == "org" && strings.Contains(string(out), "studio") {
			t.Fatalf("org name leaks: %s", out)
		}
	}
}
