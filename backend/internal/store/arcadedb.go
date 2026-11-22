package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Arcade persists to ArcadeDB over its HTTP API.
//
// Graph: vertices Integration, Org, Product, Event, Seen, Meta; edges
// BELONGS_TO (Product -> Org), PRODUCED (Integration -> Event), ABOUT (Event -> Product).
type Arcade struct {
	base, db, user, pass string
	hc                   *http.Client
}

func NewArcade(baseURL, db, user, pass string) *Arcade {
	return &Arcade{base: strings.TrimRight(baseURL, "/"), db: db, user: user, pass: pass, hc: &http.Client{Timeout: 20 * time.Second}}
}

func (a *Arcade) do(ctx context.Context, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, rd)
	if err != nil {
		return err
	}
	req.SetBasicAuth(a.user, a.pass)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		var e struct{ Error, Detail string }
		_ = json.Unmarshal(b, &e)
		return fmt.Errorf("arcadedb %s %s: %d %s %s", method, path, resp.StatusCode, e.Error, e.Detail)
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

func (a *Arcade) script(ctx context.Context, sql string, params map[string]any) error {
	return a.do(ctx, "POST", "/api/v1/command/"+url.PathEscape(a.db), map[string]any{"language": "sqlscript", "command": sql, "params": params}, nil)
}

func (a *Arcade) query(ctx context.Context, sql string, params map[string]any) ([]map[string]any, error) {
	var out struct{ Result []map[string]any }
	err := a.do(ctx, "POST", "/api/v1/query/"+url.PathEscape(a.db), map[string]any{"language": "sql", "command": sql, "params": params}, &out)
	return out.Result, err
}

const schema = `
CREATE VERTEX TYPE Integration IF NOT EXISTS;
CREATE PROPERTY Integration.id IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Integration (id) UNIQUE;
CREATE VERTEX TYPE Org IF NOT EXISTS;
CREATE PROPERTY Org.key IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Org (key) UNIQUE;
CREATE VERTEX TYPE Product IF NOT EXISTS;
CREATE PROPERTY Product.key IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Product (key) UNIQUE;
CREATE VERTEX TYPE Event IF NOT EXISTS;
CREATE PROPERTY Event.seq IF NOT EXISTS LONG;
CREATE INDEX IF NOT EXISTS ON Event (seq) UNIQUE;
CREATE PROPERTY Event.received IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Event (received) NOTUNIQUE;
CREATE VERTEX TYPE Seen IF NOT EXISTS;
CREATE PROPERTY Seen.k IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Seen (k) UNIQUE;
CREATE PROPERTY Seen.at IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Seen (at) NOTUNIQUE;
CREATE VERTEX TYPE Meta IF NOT EXISTS;
CREATE PROPERTY Meta.name IF NOT EXISTS STRING;
CREATE INDEX IF NOT EXISTS ON Meta (name) UNIQUE;
CREATE EDGE TYPE BELONGS_TO IF NOT EXISTS;
CREATE EDGE TYPE PRODUCED IF NOT EXISTS;
CREATE EDGE TYPE ABOUT IF NOT EXISTS;
`

// Init creates the database when missing (needs a user allowed to) and the schema.
func (a *Arcade) Init(ctx context.Context) error {
	var ex struct{ Result bool }
	if err := a.do(ctx, "GET", "/api/v1/exists/"+url.PathEscape(a.db), nil, &ex); err != nil {
		return err
	}
	if !ex.Result {
		if err := a.do(ctx, "POST", "/api/v1/server", map[string]string{"command": "create database " + a.db}, nil); err != nil {
			return fmt.Errorf("database %q does not exist and could not be created: %w", a.db, err)
		}
	}
	return a.script(ctx, schema, nil)
}

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func num(m map[string]any, k string) int64  { f, _ := m[k].(float64); return int64(f) }
func parseT(s string) time.Time             { t, _ := time.Parse(TimeFmt, s); return t }
func jsonStr(v any) string                  { b, _ := json.Marshal(v); return string(b) }

func (a *Arcade) Load(ctx context.Context) (Snapshot, error) {
	var sn Snapshot
	rows, err := a.query(ctx, "SELECT FROM Integration", nil)
	if err != nil {
		return sn, err
	}
	for _, r := range rows {
		sn.Integrations = append(sn.Integrations, Integration{ID: str(r, "id"), Kind: str(r, "kind"), Name: str(r, "name"), Org: str(r, "org"), FeedURL: str(r, "feedUrl"),
			TokenHash: str(r, "tokenHash"), TokenHint: str(r, "tokenHint"), CreatedAt: parseT(str(r, "createdAt")),
			LastEventAt: parseT(str(r, "lastEventAt")), LastRejectedAt: parseT(str(r, "lastRejectedAt"))})
	}
	if rows, err = a.query(ctx, "SELECT FROM Org", nil); err != nil {
		return sn, err
	}
	for _, r := range rows {
		sn.Orgs = append(sn.Orgs, Org{Key: str(r, "key"), Visibility: str(r, "visibility"), Alias: str(r, "alias")})
	}
	if rows, err = a.query(ctx, "SELECT FROM Product", nil); err != nil {
		return sn, err
	}
	for _, r := range rows {
		p := Product{Key: str(r, "key"), Org: str(r, "org"), Name: str(r, "name"), Visibility: str(r, "visibility"), Alias: str(r, "alias"), Hall: str(r, "hall")}
		_ = json.Unmarshal([]byte(str(r, "sources")), &p.Sources)
		sn.Products = append(sn.Products, p)
	}
	if rows, err = a.query(ctx, fmt.Sprintf("SELECT FROM Event ORDER BY seq DESC LIMIT %d", maxEvents), nil); err != nil {
		return sn, err
	}
	for i := len(rows) - 1; i >= 0; i-- {
		r := rows[i]
		e := Event{Seq: num(r, "seq"), ID: str(r, "eventId"), Integration: str(r, "integration"), Kind: str(r, "kind"), Type: str(r, "type"),
			At: parseT(str(r, "at")), Received: parseT(str(r, "received")), Delivery: str(r, "delivery"), Status: int(num(r, "status")),
			Reason: str(r, "reason"), Product: str(r, "product"), Org: str(r, "org")}
		_ = json.Unmarshal([]byte(str(r, "raw")), &e.Raw)
		sn.Events = append(sn.Events, e)
	}
	sn.Seen = map[string]time.Time{}
	if rows, err = a.query(ctx, "SELECT k, at FROM Seen", nil); err != nil {
		return sn, err
	}
	for _, r := range rows {
		sn.Seen[str(r, "k")] = parseT(str(r, "at"))
	}
	if rows, err = a.query(ctx, "SELECT FROM Meta", nil); err != nil {
		return sn, err
	}
	for _, r := range rows {
		switch str(r, "name") {
		case "settings":
			var s Settings
			if json.Unmarshal([]byte(str(r, "v")), &s) == nil {
				sn.Settings = &s
			}
		case "seq":
			sn.LastSeq = num(r, "n")
		}
	}
	return sn, nil
}

// Apply writes ops in order. Each chunk is one transaction, so a failed chunk leaves nothing partial.
func (a *Arcade) Apply(ctx context.Context, ops []Op) error {
	for len(ops) > 0 {
		n := min(len(ops), 100)
		sql, params := buildScript(ops[:n])
		if err := a.script(ctx, sql, params); err != nil {
			return err
		}
		ops = ops[n:]
	}
	return nil
}

func buildScript(ops []Op) (string, map[string]any) {
	var sb strings.Builder
	p := map[string]any{}
	sb.WriteString("BEGIN;\n")
	for i, o := range ops {
		k := func(f string) string { n := fmt.Sprintf("p%d_%s", i, f); return ":" + n }
		set := func(f string, v any) string { p[fmt.Sprintf("p%d_%s", i, f)] = v; return k(f) }
		switch o.Kind {
		case OpIntegration:
			g := o.Integration
			fmt.Fprintf(&sb, "UPDATE Integration SET id=%s, kind=%s, name=%s, org=%s, feedUrl=%s, tokenHash=%s, tokenHint=%s, createdAt=%s, lastEventAt=%s, lastRejectedAt=%s UPSERT WHERE id=%s;\n",
				set("id", g.ID), set("kind", g.Kind), set("name", g.Name), set("org", g.Org), set("feed", g.FeedURL), set("th", g.TokenHash), set("hint", g.TokenHint),
				set("ca", g.CreatedAt.UTC().Format(TimeFmt)), set("le", g.LastEventAt.UTC().Format(TimeFmt)), set("lr", g.LastRejectedAt.UTC().Format(TimeFmt)), k("id"))
		case OpIntegrationDel:
			fmt.Fprintf(&sb, "DELETE VERTEX FROM Integration WHERE id=%s;\n", set("id", o.Key))
		case OpOrg:
			g := o.Org
			fmt.Fprintf(&sb, "UPDATE Org SET key=%s, visibility=%s, alias=%s UPSERT WHERE key=%s;\n", set("key", g.Key), set("vis", g.Visibility), set("alias", g.Alias), k("key"))
		case OpProduct:
			g := o.Product
			fmt.Fprintf(&sb, "UPDATE Product SET key=%s, org=%s, name=%s, visibility=%s, alias=%s, hall=%s, sources=%s UPSERT WHERE key=%s;\n",
				set("key", g.Key), set("org", g.Org), set("name", g.Name), set("vis", g.Visibility), set("alias", g.Alias), set("hall", g.Hall), set("src", jsonStr(g.Sources)), k("key"))
			// One BELONGS_TO edge per product: replace it when the org changes.
			fmt.Fprintf(&sb, "DELETE FROM BELONGS_TO WHERE @out IN (SELECT @rid FROM Product WHERE key=%s);\n", k("key"))
			if g.Org != "" {
				fmt.Fprintf(&sb, "CREATE EDGE BELONGS_TO FROM (SELECT FROM Product WHERE key=%s) TO (SELECT FROM Org WHERE key=%s);\n", k("key"), set("o", g.Org))
			}
		case OpEvent:
			e := o.Event
			fmt.Fprintf(&sb, "INSERT INTO Event SET seq=%s, eventId=%s, integration=%s, kind=%s, type=%s, at=%s, received=%s, delivery=%s, status=%s, reason=%s, product=%s, org=%s, raw=%s;\n",
				set("seq", e.Seq), set("eid", e.ID), set("int", e.Integration), set("kind", e.Kind), set("type", e.Type), set("at", e.At.UTC().Format(TimeFmt)),
				set("rec", e.Received.UTC().Format(TimeFmt)), set("del", e.Delivery), set("st", e.Status), set("reason", e.Reason), set("prod", e.Product), set("org", e.Org), set("raw", jsonStr(e.Raw)))
			fmt.Fprintf(&sb, "CREATE EDGE PRODUCED FROM (SELECT FROM Integration WHERE id=%s) TO (SELECT FROM Event WHERE seq=%s);\n", k("int"), k("seq"))
			if e.Product != "" {
				fmt.Fprintf(&sb, "CREATE EDGE ABOUT FROM (SELECT FROM Event WHERE seq=%s) TO (SELECT FROM Product WHERE key=%s);\n", k("seq"), k("prod"))
			}
			fmt.Fprintf(&sb, "UPDATE Meta SET name='seq', n=%s UPSERT WHERE name='seq';\n", k("seq"))
		case OpSeen:
			fmt.Fprintf(&sb, "UPDATE Seen SET k=%s, at=%s UPSERT WHERE k=%s;\n", set("k", o.Key), set("at", o.At.UTC().Format(TimeFmt)), k("k"))
		case OpSettings:
			fmt.Fprintf(&sb, "UPDATE Meta SET name='settings', v=%s UPSERT WHERE name='settings';\n", set("v", jsonStr(o.Settings)))
		case OpPrune:
			c := set("cut", o.Cut.UTC().Format(TimeFmt))
			fmt.Fprintf(&sb, "DELETE VERTEX FROM Event WHERE received < %s;\nDELETE FROM Seen WHERE at < %s;\n", c, c)
		}
	}
	sb.WriteString("COMMIT;")
	return sb.String(), p
}
