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
const (
	Product = "animora"
	Name    = "Animora"
)

// Types are the accepted event types.
var Types = map[string]bool{
	"video.rendered": true, "video.scheduled": true, "video.published": true,
	"video.publish_failed": true, "channel.connected": true,
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

// Clean validates the data of one event and returns only the allowlisted keys. Everything else (including
// prompt, script and failure text) is dropped.
func Clean(typ string, in map[string]any) (map[string]any, error) {
	out := map[string]any{}
	put := func(k, v string) {
		if v != "" {
			out[k] = v
		}
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
	switch typ {
	case "video.rendered":
		put("channel", text(in, "channel", 120))
		put("language", text(in, "language", 16))
		if f := text(in, "format", 8); f == "video" || f == "reel" {
			out["format"] = f
		}
		if d, ok := in["duration"].(float64); ok && d >= 0 {
			out["duration"] = d
		}
	case "video.scheduled":
		put("channel", text(in, "channel", 120))
		due, err := stamp(in, "dueAt", true)
		if err != nil {
			return nil, err
		}
		out["dueAt"] = due
	case "video.published":
		put("channel", text(in, "channel", 120))
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

func strInput(d map[string]any, k string) string { s, _ := d[k].(string); return s }

// Build returns the stored raw event: only id, type, at, product, org (when set) and the cleaned data.
func Build(id, typ string, at time.Time, org string, data map[string]any) map[string]any {
	raw := map[string]any{"id": id, "type": typ, "at": at.UTC().Format(time.RFC3339), "product": Product, "data": data}
	if org != "" {
		raw["org"] = org
	}
	return raw
}
