// site-init prepares the mfardiansyah.id services of the e2e stack (docker compose profile "site"):
//
//  1. writes a GeoIP .mmdb that maps every 203.0.113.N/32 (RFC 5737 TEST-NET-3, never routed) to a two-letter
//     code derived from N, so each parallel Playwright worker has its own visitor country;
//  2. creates the throwaway site databases in the stack's ArcadeDB and applies the site's schema, migrations and
//     seed the same way the site's backend/db/apply.sh builds its statements (apply.sh itself ships to production
//     over ssh and is never run).
//
// It exits non-zero on any unexpected error, so the site services never start on a half-built database.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "site-init:", err)
		os.Exit(1)
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func run() error {
	password := os.Getenv("ARCADEDB_PASSWORD")
	if password == "" {
		return errors.New("ARCADEDB_PASSWORD is required")
	}
	if err := writeGeo(env("GEO_OUT", "/geo/e2e-country.mmdb")); err != nil {
		return fmt.Errorf("geoip: %w", err)
	}
	a := &arcade{base: strings.TrimRight(env("ARCADEDB_URL", "http://arcadedb:2480"), "/"), password: password,
		client: &http.Client{Timeout: 30 * time.Second}}
	if err := a.waitReady(2 * time.Minute); err != nil {
		return err
	}
	dir := env("SITE_DB_DIR", "/site-db")
	for _, db := range strings.Split(env("DATABASES", "site_push,site_pull,site_offline"), ",") {
		db = strings.TrimSpace(db)
		if err := a.createDatabase(db); err != nil {
			return fmt.Errorf("create %s: %w", db, err)
		}
		n, err := a.apply(db, dir)
		if err != nil {
			return fmt.Errorf("apply %s: %w", db, err)
		}
		fmt.Printf("site-init: %s ready (%d statements)\n", db, n)
	}
	return nil
}

// countryOf is the visitor country of slot n: "AA" + n (first letter A+n/26, second A+n%26). The specs compute
// the same value (e2e/src/api/stream/integrations/mfardiansyah-id/visitor.ts).
func countryOf(n int) string {
	return string([]byte{byte('A' + n/26), byte('A' + n%26)})
}

func writeGeo(path string) error {
	w, err := mmdbwriter.New(mmdbwriter.Options{
		DatabaseType:            "E2E-Country",
		RecordSize:              24,
		IPVersion:               4,
		IncludeReservedNetworks: true,
		Languages:               []string{"en"},
	})
	if err != nil {
		return err
	}
	for n := 0; n < 256; n++ {
		code := countryOf(n)
		record := mmdbtype.Map{"country": mmdbtype.Map{
			"iso_code": mmdbtype.String(code),
			"names":    mmdbtype.Map{"en": mmdbtype.String("E2E " + code)},
		}}
		ipnet := &net.IPNet{IP: net.IPv4(203, 0, 113, byte(n)).To4(), Mask: net.CIDRMask(32, 32)}
		if err := w.Insert(ipnet, record); err != nil {
			return err
		}
	}
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := w.WriteTo(f); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

type arcade struct {
	base     string
	password string
	client   *http.Client
}

func (a *arcade) do(method, path string, body any) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, a.base+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.SetBasicAuth("root", a.password)
	req.Header.Set("Content-Type", "application/json")
	res, err := a.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	return res.StatusCode, out, nil
}

func (a *arcade) waitReady(limit time.Duration) error {
	deadline := time.Now().Add(limit)
	for {
		if code, _, err := a.do(http.MethodGet, "/api/v1/ready", nil); err == nil && code == http.StatusNoContent {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("ArcadeDB at %s was not ready within %s", a.base, limit)
		}
		time.Sleep(time.Second)
	}
}

func (a *arcade) createDatabase(name string) error {
	code, body, err := a.do(http.MethodGet, "/api/v1/exists/"+name, nil)
	if err != nil {
		return err
	}
	if code == http.StatusOK && bytes.Contains(body, []byte(`"result":true`)) {
		return nil
	}
	code, body, err = a.do(http.MethodPost, "/api/v1/server", map[string]string{"command": "create database " + name})
	if err != nil {
		return err
	}
	if code != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", code, trim(body))
	}
	return nil
}

func trim(b []byte) string {
	s := string(b)
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// statement is one SQL line plus the migration number it belongs to (0 for schema and seed).
type statement struct {
	sql       string
	migration int
}

// statements builds the list exactly like backend/db/apply.sh: every non-comment, non-empty line of schema.sql, of
// each numbered migration followed by its SchemaVersion upsert, then the seed UPSERTs.
func statements(dir string) ([]statement, error) {
	var out []statement
	lines := func(file string, migration int) error {
		b, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		for _, l := range strings.Split(string(b), "\n") {
			l = strings.TrimRight(l, "\r")
			if l == "" || strings.HasPrefix(l, "--") {
				continue
			}
			out = append(out, statement{l, migration})
		}
		return nil
	}
	if err := lines(filepath.Join(dir, "schema.sql"), 0); err != nil {
		return nil, err
	}
	files, err := filepath.Glob(filepath.Join(dir, "migrations", "[0-9][0-9][0-9]_*.sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	nameRe := regexp.MustCompile(`^(\d{3})_`)
	for _, f := range files {
		base := filepath.Base(f)
		m := nameRe.FindStringSubmatch(base)
		n, _ := strconv.Atoi(m[1])
		if err := lines(f, n); err != nil {
			return nil, err
		}
		out = append(out, statement{fmt.Sprintf("UPDATE SchemaVersion SET name = '%s', appliedAt = sysdate() UPSERT WHERE version = %d",
			strings.TrimSuffix(base, ".sql"), n), n})
	}
	seed, err := os.ReadFile(filepath.Join(dir, "seed.json"))
	if err != nil {
		return nil, err
	}
	var s struct {
		Categories []json.RawMessage `json:"categories"`
		Profile    json.RawMessage   `json:"profile"`
		Posts      []json.RawMessage `json:"posts"`
	}
	if err := json.Unmarshal(seed, &s); err != nil {
		return nil, err
	}
	upsert := func(typ, key string, raw json.RawMessage) error {
		var k map[string]any
		if err := json.Unmarshal(raw, &k); err != nil {
			return err
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, raw); err != nil {
			return err
		}
		out = append(out, statement{fmt.Sprintf("UPDATE %s CONTENT %s UPSERT WHERE %s = %q", typ, compact.String(), key, fmt.Sprint(k[key])), 0})
		return nil
	}
	for _, c := range s.Categories {
		if err := upsert("Category", "slug", c); err != nil {
			return nil, err
		}
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, s.Profile); err != nil {
		return nil, err
	}
	out = append(out, statement{"UPDATE Profile CONTENT " + compact.String() + ` UPSERT WHERE key = "main"`, 0})
	for _, p := range s.Posts {
		if err := upsert("Post", "slug", p); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// tolerated lists the errors the skill documents as expected on a fresh database: SchemaVersion does not exist
// before migration 004, and `trigger` is a reserved word in LinkedinShare.
func tolerated(st statement) bool {
	if strings.HasPrefix(st.sql, "UPDATE SchemaVersion") && st.migration < 4 {
		return true
	}
	return strings.Contains(st.sql, "LinkedinShare.trigger")
}

// hasError looks at the top-level "error" key only: a reply may mention the word inside a property name.
func hasError(body []byte) bool {
	var reply map[string]json.RawMessage
	if json.Unmarshal(body, &reply) != nil {
		return false
	}
	_, failed := reply["error"]
	return failed
}

func (a *arcade) apply(db, dir string) (int, error) {
	list, err := statements(dir)
	if err != nil {
		return 0, err
	}
	for _, st := range list {
		code, body, err := a.do(http.MethodPost, "/api/v1/command/"+db, map[string]string{"language": "sql", "command": st.sql})
		if err != nil {
			return 0, err
		}
		if (code != http.StatusOK || hasError(body)) && !tolerated(st) {
			return 0, fmt.Errorf("HTTP %d for %.100q: %s", code, st.sql, trim(body))
		}
	}
	return len(list), nil
}
