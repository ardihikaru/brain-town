// Package animora holds the receiver-side contract of the Animora integration (docs/integrations/animora.md).
// Push (ingest) and pull (feed) both build the stored event through Build, so they store the same shape.
package animora

import (
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

// Product is the product key, and Name its display name, of every accepted Animora event.
// The key starts with "@", which a GitHub repository name can never contain, so it cannot collide with the
// GitHub product of a repo called "animora". LegacyProduct is the key used before the split; only the startup
// migration in internal/store refers to it.
const (
	Product       = "@animora-video"
	LegacyProduct = "animora"
	Name          = "Animora"
)

// Types are the accepted event types.
var Types = map[string]bool{
	"video.rendered": true, "video.scheduled": true, "video.published": true,
	"video.publish_failed": true, "channel.connected": true,
	"video.started": true, "video.render_failed": true,
}

var vendors = map[string]bool{"youtube": true, "facebook": true, "instagram": true, "tiktok": true}

// ValidVendor reports whether v is one of the four supported platforms.
func ValidVendor(v string) bool { return vendors[v] }

// Err is a validation failure: the field name (data.<name>) and a message.
type Err struct{ Field, Msg string }

func (e Err) Error() string { return e.Field + ": " + e.Msg }

func text(d map[string]any, k string, max int) string {
	s, _ := d[k].(string)
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return strings.TrimSpace(s)
}

func required(d map[string]any, k string, max int) (string, error) {
	s := text(d, k, max)
	if s == "" {
		return "", Err{"data." + k, "data." + k + " is required"}
	}
	return s, nil
}

func stamp(d map[string]any, k string, must bool) (string, error) {
	s := text(d, k, 64)
	if s == "" && !must {
		return "", nil
	}
	if _, err := time.Parse(time.RFC3339, s); err != nil {
		return "", Err{"data." + k, "data." + k + " must be an RFC 3339 timestamp"}
	}
	return s, nil
}

// validCode reports whether c is an opaque video code: 1 to 32 characters of [A-Za-z0-9_-].
func validCode(c string) bool { return validOpaque(c, 32) }

// validOpaque reports whether c is 1 to max characters of [A-Za-z0-9_-].
func validOpaque(c string, max int) bool {
	if c == "" || len(c) > max {
		return false
	}
	for _, r := range c {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

// Clean validates the data of one event and returns only the allowlisted keys. Everything else (including
// prompt, script and failure text) is dropped.
func Clean(typ string, in map[string]any) (map[string]any, error) {
	out := map[string]any{}
	put := func(k, v string) {
		if v != "" {
			out[k] = v
		}
	}
	if typ == "video.started" || typ == "video.render_failed" {
		return cleanProgress(typ, in)
	}
	if typ != "video.rendered" {
		v := text(in, "vendor", 32)
		if !ValidVendor(v) {
			return nil, Err{"data.vendor", "vendor must be youtube, facebook, instagram or tiktok"}
		}
		out["vendor"] = v
	}
	title, err := required(in, "title", 200)
	if typ != "channel.connected" {
		if err != nil {
			return nil, err
		}
		out["title"] = title
	}
	// The optional video code correlates render, schedule and publish. An invalid one is dropped, never a 422.
	if typ != "channel.connected" {
		if c := strings.TrimSpace(strInput(in, "code")); validCode(c) {
			out["code"] = c
		}
	}
	switch typ {
	case "video.rendered":
		// The optional autodaily run id clears the in-production item of that run. Invalid is dropped, never a 422.
		if r := strings.TrimSpace(strInput(in, "run")); validOpaque(r, 64) {
			out["run"] = r
		}
		put("channel", text(in, "channel", 120))
		put("concept", text(in, "concept", 120))
		put("language", text(in, "language", 16))
		if f := text(in, "format", 8); f == "video" || f == "reel" {
			out["format"] = f
		}
		if d, ok := in["duration"].(float64); ok && d >= 0 {
			out["duration"] = d
		}
	case "video.scheduled":
		put("channel", text(in, "channel", 120))
		put("concept", text(in, "concept", 120))
		due, err := stamp(in, "dueAt", true)
		if err != nil {
			return nil, err
		}
		out["dueAt"] = due
	case "video.published":
		put("channel", text(in, "channel", 120))
		put("concept", text(in, "concept", 120))
		u := strings.TrimSpace(strInput(in, "url"))
		pu, perr := url.Parse(u)
		if u == "" || len(u) > 512 || perr != nil || pu.Scheme != "https" || pu.Host == "" {
			return nil, Err{"data.url", "data.url must be an https URL (max 512 characters)"}
		}
		out["url"] = u
		pub, err := stamp(in, "publishedAt", false)
		if err != nil {
			return nil, err
		}
		put("publishedAt", pub)
	case "video.publish_failed":
		put("channel", text(in, "channel", 120))
		put("concept", text(in, "concept", 120))
	case "channel.connected":
		ch, err := required(in, "channel", 120)
		if err != nil {
			return nil, err
		}
		out["channel"] = ch
		if a := text(in, "account", 120); a != "" && !strings.Contains(a, "@") {
			out["account"] = a
		}
	}
	return out, nil
}

// cleanProgress validates the in-progress types video.started and video.render_failed: run and stage are
// required (run is checked first), the title is optional, there is no vendor, and only allowlisted keys survive.
func cleanProgress(typ string, in map[string]any) (map[string]any, error) {
	out := map[string]any{}
	run := strings.TrimSpace(strInput(in, "run"))
	if !validOpaque(run, 64) {
		return nil, Err{"data.run", "data.run is required: 1 to 64 characters of A-Z a-z 0-9 _ -"}
	}
	out["run"] = run
	stage := text(in, "stage", 16)
	if stage != "naskah" && stage != "render" {
		return nil, Err{"data.stage", "data.stage must be naskah or render"}
	}
	out["stage"] = stage
	if c := strings.TrimSpace(strInput(in, "code")); validCode(c) {
		out["code"] = c
	}
	if ch := text(in, "channel", 120); ch != "" {
		out["channel"] = ch
	}
	if c := text(in, "concept", 120); c != "" {
		out["concept"] = c
	}
	if typ == "video.started" {
		if t := text(in, "title", 200); t != "" {
			out["title"] = t
		}
		if f := text(in, "format", 8); f == "video" || f == "reel" {
			out["format"] = f
		}
	}
	return out, nil
}

func strInput(d map[string]any, k string) string { s, _ := d[k].(string); return s }

// Build returns the stored raw event: only id, type, at, product, org (when set) and the cleaned data.
func Build(id, typ string, at time.Time, org string, data map[string]any) map[string]any {
	raw := map[string]any{"id": id, "type": typ, "at": at.UTC().Format(time.RFC3339), "product": Product, "data": data}
	if org != "" {
		raw["org"] = org
	}
	return raw
}
