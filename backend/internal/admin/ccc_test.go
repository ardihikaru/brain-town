package admin_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

func TestSettingsTimezone(t *testing.T) {
	e := newEnv(t)
	e.login()
	if c, m, _ := e.do("GET", "/api/admin/settings", "", ""); c == 200 && m["timezone"] != "Asia/Jakarta" {
		t.Fatalf("default %v", m)
	}
	if got := e.st.Settings().Timezone; got != "Asia/Jakarta" {
		t.Fatalf("store default %q", got)
	}
	if c, m, b := e.do("PUT", "/api/admin/settings", "", `{"retentionDays":10,"animation":true,"timezone":"America/New_York"}`); c != 200 || m["timezone"] != "America/New_York" {
		t.Fatalf("round trip %d %s", c, b)
	}
	// Omitting the timezone keeps the current value.
	if c, m, b := e.do("PUT", "/api/admin/settings", "", `{"retentionDays":12,"animation":false}`); c != 200 || m["timezone"] != "America/New_York" {
		t.Fatalf("partial %d %s", c, b)
	}
	if c, m, _ := e.do("PUT", "/api/admin/settings", "", `{"retentionDays":12,"animation":false,"timezone":"UTC"}`); c != 200 || m["timezone"] != "UTC" {
		t.Fatalf("utc %d %v", c, m)
	}
	for _, bad := range []string{"Mars/Olympus", "Local", "local", "../etc/passwd"} {
		c, m, b := e.do("PUT", "/api/admin/settings", "", `{"retentionDays":12,"animation":false,"timezone":"`+bad+`"}`)
		if c != 422 || !strings.Contains(m["error"].(string), "timezone") {
			t.Fatalf("%q: %d %s", bad, c, b)
		}
	}
	if e.st.Settings().Timezone != "UTC" {
		t.Fatalf("bad zone changed the setting: %q", e.st.Settings().Timezone)
	}
	// /api/town is public and carries the zone.
	if c, m, b := e.do("GET", "/api/town", "", ""); c != 200 || m["timezone"] != "UTC" {
		t.Fatalf("town %d %s", c, b)
	}
}

func TestAnimoraConcept(t *testing.T) {
	e := newEnv(t)
	e.login()
	id, tok := e.integration("animora", "A")
	long := strings.Repeat("é", 130)
	cases := []struct{ id, typ, data string }{
		{"c1", "video.published", `{"vendor":"youtube","title":"T","url":"https://youtu.be/x","concept":" Seri ` + long + `","publishedAt":"2026-11-23T07:00:00Z"}`},
		{"c2", "video.started", `{"run":"r1","stage":"naskah","concept":"Seri"}`},
		{"c3", "video.rendered", `{"vendor":"youtube","title":"T","concept":"Seri"}`},
		{"c4", "video.scheduled", `{"vendor":"youtube","title":"T","concept":"Seri","dueAt":"2026-11-24T07:00:00Z"}`},
		{"c5", "video.render_failed", `{"run":"r2","stage":"render","concept":"Seri"}`},
		{"c6", "video.publish_failed", `{"vendor":"youtube","title":"T","concept":"Seri"}`},
		{"c7", "video.published", `{"vendor":"youtube","title":"T","url":"https://youtu.be/y","concept":"  ","publishedAt":"2026-11-23T07:00:00Z"}`},
	}
	for _, c := range cases {
		if code, _, b := e.do("POST", "/ingest/animora/"+id, tok, animoraBody(c.id, c.typ, c.data)); code != 202 {
			t.Fatalf("%s %d %s", c.id, code, b)
		}
	}
	data := map[string]map[string]any{}
	for _, ev := range e.st.Events(store.Query{Delivery: "ok"}) {
		data[ev.ID] = ev.Raw["data"].(map[string]any)
	}
	if got := data["c1"]["concept"].(string); len([]rune(got)) != 120 || !strings.HasPrefix(got, "Seri ") {
		t.Fatalf("cap/trim: %d runes", len([]rune(got)))
	}
	for _, k := range []string{"c2", "c3", "c4", "c5", "c6"} {
		if data[k]["concept"] != "Seri" {
			t.Fatalf("%s lost concept: %v", k, data[k])
		}
	}
	if _, has := data["c7"]["concept"]; has {
		t.Fatalf("blank concept kept: %v", data["c7"])
	}
	// Hidden product drops the concept in the public view.
	h := store.Hidden
	e.st.SetProduct("animora", &h, nil, nil)
	for _, ev := range e.st.Events(store.Query{Delivery: "ok"}) {
		out, _ := json.Marshal(visibility.View(e.st, ev))
		if strings.Contains(string(out), "concept") || strings.Contains(string(out), "Seri") {
			t.Fatalf("hidden leaks concept: %s", out)
		}
	}
}
