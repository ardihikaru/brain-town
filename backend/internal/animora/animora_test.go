package animora

import (
	"strings"
	"testing"
)

func TestCleanCode(t *testing.T) {
	base := func(typ string) map[string]any {
		return map[string]any{"vendor": "youtube", "title": "T", "dueAt": "2026-11-24T08:00:00Z", "url": "https://youtu.be/x", "channel": "K"}
	}
	for _, typ := range []string{"video.rendered", "video.scheduled", "video.published", "video.publish_failed"} {
		in := base(typ)
		in["code"] = " Ab_9-z "
		out, err := Clean(typ, in)
		if err != nil || out["code"] != "Ab_9-z" {
			t.Fatalf("%s: %v %v", typ, out, err)
		}
		for _, bad := range []any{"a b", strings.Repeat("a", 33), "a/b", "é", "", 7, nil} {
			in := base(typ)
			in["code"] = bad
			out, err := Clean(typ, in)
			if err != nil || out["code"] != nil {
				t.Fatalf("%s bad %v: %v %v", typ, bad, out, err)
			}
		}
		in = base(typ)
		in["code"] = strings.Repeat("a", 32)
		if out, _ := Clean(typ, in); out["code"] == nil {
			t.Fatalf("%s: 32 chars must be kept", typ)
		}
	}
}

func TestCleanTypes(t *testing.T) {
	if _, err := Clean("video.rendered", map[string]any{"title": " "}); err == nil {
		t.Fatal("rendered needs title")
	}
	if _, err := Clean("video.scheduled", map[string]any{"vendor": "youtube", "title": "T"}); err == nil {
		t.Fatal("scheduled needs dueAt")
	}
	if _, err := Clean("video.published", map[string]any{"vendor": "youtube", "title": "T", "url": "http://x"}); err == nil {
		t.Fatal("published needs https url")
	}
	if _, err := Clean("video.publish_failed", map[string]any{"vendor": "vimeo", "title": "T"}); err == nil {
		t.Fatal("vendor must be known")
	}
	out, err := Clean("channel.connected", map[string]any{"vendor": "tiktok", "channel": "K", "account": "a@b", "code": "x"})
	if err != nil || out["account"] != nil || out["code"] != nil || out["channel"] != "K" {
		t.Fatalf("%v %v", out, err)
	}
	out, _ = Clean("video.publish_failed", map[string]any{"vendor": "youtube", "title": "T", "failure": "secret", "prompt": "p"})
	if len(out) != 2 {
		t.Fatalf("allowlist: %v", out)
	}
}

func TestCleanProgress(t *testing.T) {
	out, err := Clean("video.started", map[string]any{"run": " r-1_A ", "stage": "naskah", "code": "c1", "channel": "K", "format": "reel", "vendor": "x", "script": "s", "prompt": "p"})
	if err != nil || len(out) != 5 || out["run"] != "r-1_A" || out["stage"] != "naskah" || out["code"] != "c1" || out["channel"] != "K" || out["format"] != "reel" {
		t.Fatalf("%v %v", out, err)
	}
	out, err = Clean("video.started", map[string]any{"run": "r", "stage": "render", "title": "T", "format": "gif", "code": "a b"})
	if err != nil || out["title"] != "T" || out["format"] != nil || out["code"] != nil {
		t.Fatalf("%v %v", out, err)
	}
	out, err = Clean("video.render_failed", map[string]any{"run": "r", "stage": "render", "title": "T", "error": "boom", "message": "m", "failure": "f", "channel": "K", "code": "c"})
	if err != nil || len(out) != 4 || out["title"] != nil || out["run"] != "r" {
		t.Fatalf("%v %v", out, err)
	}
	for _, typ := range []string{"video.started", "video.render_failed"} {
		for _, run := range []any{nil, "", "a b", "é", strings.Repeat("a", 65), 5} {
			_, err := Clean(typ, map[string]any{"run": run, "stage": "render"})
			if e, ok := err.(Err); !ok || e.Field != "data.run" {
				t.Fatalf("%s run %v: %v", typ, run, err)
			}
		}
		for _, stage := range []any{nil, "", "publish", "Render", 3} {
			_, err := Clean(typ, map[string]any{"run": "r", "stage": stage})
			if e, ok := err.(Err); !ok || e.Field != "data.stage" {
				t.Fatalf("%s stage %v: %v", typ, stage, err)
			}
		}
		// run is checked before stage.
		if _, err := Clean(typ, map[string]any{}); err == nil || err.(Err).Field != "data.run" {
			t.Fatalf("order: %v", err)
		}
	}
	if out, err := Clean("video.started", map[string]any{"run": strings.Repeat("a", 64), "stage": "naskah"}); err != nil || len(out) != 2 {
		t.Fatalf("64-char run: %v %v", out, err)
	}
}

func TestCleanRenderedRun(t *testing.T) {
	out, err := Clean("video.rendered", map[string]any{"title": "T", "run": "run-9"})
	if err != nil || out["run"] != "run-9" {
		t.Fatalf("%v %v", out, err)
	}
	for _, bad := range []any{"a b", strings.Repeat("a", 65), "", 4, nil} {
		out, err := Clean("video.rendered", map[string]any{"title": "T", "run": bad})
		if err != nil || out["run"] != nil {
			t.Fatalf("bad run %v: %v %v", bad, out, err)
		}
	}
	// run is not kept on other types.
	if out, _ := Clean("video.scheduled", map[string]any{"vendor": "youtube", "title": "T", "dueAt": "2026-11-24T08:00:00Z", "run": "r"}); out["run"] != nil {
		t.Fatalf("%v", out)
	}
}
