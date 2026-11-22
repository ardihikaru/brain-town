package store

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

// Runs against a real ArcadeDB: ARCADEDB_TEST_URL=http://127.0.0.1:19480 ARCADEDB_TEST_USER=root
// ARCADEDB_TEST_PASSWORD=... go test ./internal/store. Skipped when the URL is not set.
func arcade(t *testing.T) *Arcade {
	url := os.Getenv("ARCADEDB_TEST_URL")
	if url == "" {
		t.Skip("ARCADEDB_TEST_URL not set")
	}
	a := NewArcade(url, fmt.Sprintf("bttest%d", time.Now().UnixNano()%1e9), os.Getenv("ARCADEDB_TEST_USER"), os.Getenv("ARCADEDB_TEST_PASSWORD"))
	t.Cleanup(func() {
		_ = a.do(context.Background(), "POST", "/api/v1/server", map[string]string{"command": "drop database " + a.db}, nil)
	})
	return a
}

func count(t *testing.T, a *Arcade, sql string) int {
	rows, err := a.query(context.Background(), sql, nil)
	if err != nil || len(rows) != 1 {
		t.Fatalf("%s: %v %v", sql, rows, err)
	}
	return int(num(rows[0], "c"))
}

func TestArcadeRoundTrip(t *testing.T) {
	a := arcade(t)
	st, err := New(a)
	if err != nil {
		t.Fatal(err)
	}
	i, tok := st.CreateIntegration("qa", "QA", "")
	_, ok := st.AddAccepted(Accept{Integration: i.ID, Kind: "qa", Key: "k1", ID: "e1", Type: "qa.step", At: time.Now(),
		Product: "sipreport", Org: "sismedika", Raw: map[string]any{"id": "e1", "data": map[string]any{"step": "Sign in"}}})
	if !ok {
		t.Fatal("not accepted")
	}
	st.AddRejected(i.ID, "qa", "qa.step", 422, "bad")
	st.SetOrg("sismedika", ptr(Hidden), nil)
	st.SetProduct("sipreport", nil, nil, ptr("Imago"))
	st.SetSettings(Settings{RetentionDays: 7, Animation: false})
	if err := st.Flush(); err != nil {
		t.Fatal(err)
	}

	// graph: 2 events produced by the integration, one about the product, product belongs to the org
	if n := count(t, a, "SELECT count(*) AS c FROM PRODUCED"); n != 2 {
		t.Errorf("PRODUCED edges = %d", n)
	}
	if n := count(t, a, "SELECT count(*) AS c FROM ABOUT"); n != 1 {
		t.Errorf("ABOUT edges = %d", n)
	}
	if n := count(t, a, "SELECT count(*) AS c FROM BELONGS_TO"); n != 1 {
		t.Errorf("BELONGS_TO edges = %d", n)
	}

	// a fresh store (a restart) sees everything
	st2, err := New(a)
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := st2.GetIntegration(i.ID); !ok || got.TokenHint != i.TokenHint || got.LastRejectedAt.IsZero() || got.LastEventAt.IsZero() {
		t.Errorf("integration after restart: %+v", got)
	}
	if _, good := st2.CheckToken(i.ID, tok); !good {
		t.Error("token no longer verifies after restart")
	}
	if o, _ := st2.GetOrg("sismedika"); o.Visibility != Hidden || o.Alias != "Org A" {
		t.Errorf("org: %+v", o)
	}
	if p, _ := st2.GetProduct("sipreport"); p.Hall != "Imago" || len(p.Sources) != 1 || p.Org != "sismedika" {
		t.Errorf("product: %+v", p)
	}
	evs := st2.Events(Query{Limit: 10})
	if len(evs) != 2 || evs[0].Raw["id"] != "e1" || evs[1].Delivery != Reject {
		t.Errorf("events: %+v", evs)
	}
	if s := st2.Settings(); s.RetentionDays != 7 || s.Animation {
		t.Errorf("settings: %+v", s)
	}
	if !st2.Seen(i.ID, "k1") {
		t.Error("dedupe key lost: a retried event would be accepted twice")
	}
	if ev, _ := st2.AddAccepted(Accept{Integration: i.ID, Kind: "qa", Key: "k2", ID: "e2", Type: "qa.step", At: time.Now(), Raw: map[string]any{}}); ev.Seq != 3 {
		t.Errorf("next seq after restart = %d, want 3", ev.Seq)
	}

	// rotate + delete + prune persist too
	tok2, _ := st2.RotateToken(i.ID)
	st2.Prune(time.Now().AddDate(0, 0, 8)) // retention is 7 days, so everything is older than the window
	if err := st2.Flush(); err != nil {
		t.Fatal(err)
	}
	st3, _ := New(a)
	if _, good := st3.CheckToken(i.ID, tok2); !good {
		t.Error("rotated token lost")
	}
	if n := len(st3.Events(Query{Limit: 10})); n != 0 {
		t.Errorf("events after prune = %d", n)
	}
	st3.DeleteIntegration(i.ID)
	st3.Flush()
	if n := count(t, a, "SELECT count(*) AS c FROM Integration"); n != 0 {
		t.Errorf("integration not deleted: %d", n)
	}
}

func TestFlushRetriesAfterFailure(t *testing.T) {
	a := arcade(t)
	st, err := New(a)
	if err != nil {
		t.Fatal(err)
	}
	st.CreateIntegration("gaos", "G", "")
	good := a.base
	a.base = "http://127.0.0.1:1" // unreachable
	if st.Flush() == nil {
		t.Fatal("expected a write error")
	}
	a.base = good
	if err := st.Flush(); err != nil {
		t.Fatal(err)
	}
	if n := count(t, a, "SELECT count(*) AS c FROM Integration"); n != 1 {
		t.Errorf("queued change was lost: %d", n)
	}
}

func ptr(s string) *string { return &s }
