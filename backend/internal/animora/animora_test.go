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
