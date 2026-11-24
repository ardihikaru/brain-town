package store_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/animora"
	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

// fakeP serves a fixed snapshot and records every applied op.
type fakeP struct {
	sn  store.Snapshot
	got []store.Op
}

func (f *fakeP) Init(context.Context) error                   { return nil }
func (f *fakeP) Load(context.Context) (store.Snapshot, error) { return f.sn, nil }
func (f *fakeP) Apply(_ context.Context, ops []store.Op) error {
	f.got = append(f.got, ops...)
	return nil
}

func captureLog(t *testing.T) *bytes.Buffer {
	var b bytes.Buffer
	log.SetOutput(&b)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &b
}

func kinds(ops []store.Op) []store.OpKind {
	var k []store.OpKind
	for _, o := range ops {
		k = append(k, o.Kind)
	}
	return k
}

var t0 = time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC)

func ev(seq int64, kind, product string, rawProduct any) store.Event {
	raw := map[string]any{"id": "e", "data": map[string]any{"title": "T", "channel": "Kanal", "concept": "Seri", "repo": "x"}}
	if rawProduct != nil {
		raw["product"] = rawProduct
	}
	return store.Event{Seq: seq, ID: "id" + string(rune('a'+seq)), Integration: "i-" + kind, Kind: kind, Type: "x", At: t0, Received: t0,
		Delivery: store.OK, Status: 202, Product: product, Org: "ardihikaru", Raw: raw}
}

func oldSnapshot(old *store.Product) store.Snapshot {
	sn := store.Snapshot{
		Integrations: []store.Integration{{ID: "animora-1", Kind: "animora", Name: "A", Org: "ardihikaru"}, {ID: "github-1", Kind: "github", Name: "G"}},
		Orgs:         []store.Org{{Key: "ardihikaru", Visibility: store.Public, Alias: "ardihikaru"}},
		Events: []store.Event{
			ev(1, "github", "animora", "animora"),
			ev(2, "animora", "animora", "animora"),
			ev(3, "animora", "animora", "animora"),
		},
		Seen:    map[string]time.Time{"animora-1\x00vid-1": t0},
		LastSeq: 3,
	}
	if old != nil {
		sn.Products = []store.Product{*old}
	}
	return sn
}

func mixedOld() *store.Product {
	return &store.Product{Key: "animora", Org: "ardihikaru", Name: "animora", Visibility: store.Hidden, Alias: "Animora", Hall: "GitHub Valley hall", Sources: []string{"GitHub", "Animora"}}
}

func prod(t *testing.T, st *store.Store, key string) store.Product {
	p, ok := st.GetProduct(key)
	if !ok {
		t.Fatalf("product %q missing", key)
	}
	return p
}

func TestMigrateAnimoraMixedProduct(t *testing.T) {
	buf := captureLog(t)
	f := &fakeP{sn: oldSnapshot(mixedOld())}
	st, err := store.New(f)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range st.Events(store.Query{Limit: 10}) {
		want := "animora"
		if e.Kind == "animora" {
			want = animora.Product
		}
		if e.Product != want || e.Raw["product"] != want {
			t.Errorf("event %d (%s): product %q raw %v, want %q", e.Seq, e.Kind, e.Product, e.Raw["product"], want)
		}
	}
	np := prod(t, st, animora.Product)
	if np.Visibility != store.Public || np.Alias != animora.Product || np.Name != "Animora" || np.Hall != "Video Studio hall" ||
		!slices.Equal(np.Sources, []string{"Animora"}) || np.Org != "ardihikaru" {
		t.Errorf("new product: %+v", np)
	}
	op := prod(t, st, "animora")
	if !slices.Equal(op.Sources, []string{"GitHub"}) || op.Visibility != store.Hidden || op.Alias != "Animora" || op.Hall != "GitHub Valley hall" {
		t.Errorf("old product: %+v", op)
	}
	if err := st.Flush(); err != nil {
		t.Fatal(err)
	}
	want := []store.OpKind{store.OpProduct, store.OpEventUpdate, store.OpEventUpdate, store.OpRekeyEvents, store.OpProduct}
	if got := kinds(f.got); !slices.Equal(got, want) {
		t.Errorf("ops %v, want %v", got, want)
	}
	for _, l := range []string{
		`store: migrate animora product: re-keyed 2 event(s) from "animora" to "@animora-video"`,
		`store: migrate animora product: created product "@animora-video" (visibility public, org "ardihikaru")`,
		`store: migrate animora product: removed source Animora from product "animora"`,
	} {
		if !strings.Contains(buf.String(), l) {
			t.Errorf("log lacks %q:\n%s", l, buf)
		}
	}
	t.Logf("log:\n%s", buf)

	// a second start over the migrated data queues nothing
	sn2 := store.Snapshot{Integrations: f.sn.Integrations, Orgs: f.sn.Orgs, Events: st.Events(store.Query{Limit: 10}), Seen: f.sn.Seen, LastSeq: 3,
		Products: st.Products()}
	buf.Reset()
	f2 := &fakeP{sn: sn2}
	st2, err := store.New(f2)
	if err != nil {
		t.Fatal(err)
	}
	st2.Flush()
	if len(f2.got) != 0 {
		t.Errorf("second start queued %v", kinds(f2.got))
	}
	if !strings.Contains(buf.String(), "store: migrate animora product: nothing to do") {
		t.Errorf("log: %s", buf)
	}
	t.Logf("log:\n%s", buf)
}

func TestMigrateAnimoraRawOnlyLeftover(t *testing.T) {
	captureLog(t)
	sn := oldSnapshot(nil)
	sn.Events = []store.Event{ev(1, "animora", animora.Product, "animora")} // a crash re-keyed the column but not raw
	st, _ := store.New(&fakeP{sn: sn})
	e := st.Events(store.Query{Limit: 1})[0]
	if e.Raw["product"] != animora.Product {
		t.Errorf("raw: %v", e.Raw["product"])
	}
}

func TestMigrateAnimoraOnlyOldProduct(t *testing.T) {
	buf := captureLog(t)
	old := &store.Product{Key: "animora", Org: "ardihikaru", Name: "Animora", Visibility: store.Hidden, Alias: "Product B", Hall: "Imago", Sources: []string{"Animora"}}
	sn := oldSnapshot(old)
	sn.Events = sn.Events[1:] // no GitHub event
	f := &fakeP{sn: sn}
	st, _ := store.New(f)
	np := prod(t, st, animora.Product)
	if np.Visibility != store.Hidden || np.Alias != "Product B" || np.Hall != "Imago" {
		t.Errorf("new product did not inherit: %+v", np)
	}
	if _, ok := st.GetProduct("animora"); ok {
		t.Error("old product not deleted")
	}
	st.Flush()
	want := []store.OpKind{store.OpProduct, store.OpEventUpdate, store.OpEventUpdate, store.OpRekeyEvents, store.OpProductDel}
	if got := kinds(f.got); !slices.Equal(got, want) {
		t.Errorf("ops %v, want %v", got, want)
	}
	if !strings.Contains(buf.String(), `deleted product "animora" (no sources left)`) {
		t.Errorf("log: %s", buf)
	}
}

func TestMigrateAnimoraHall(t *testing.T) {
	captureLog(t)
	for hall, want := range map[string]string{"Video Studio hall": "GitHub Valley hall", "Imago": "Imago"} {
		o := mixedOld()
		o.Hall = hall
		st, _ := store.New(&fakeP{sn: oldSnapshot(o)})
		if got := prod(t, st, "animora").Hall; got != want {
			t.Errorf("hall %q became %q, want %q", hall, got, want)
		}
	}
}

func TestMigrateAnimoraVisibility(t *testing.T) {
	captureLog(t)
	st, _ := store.New(&fakeP{sn: oldSnapshot(mixedOld())})
	for _, e := range st.Events(store.Query{Limit: 10}) {
		out, _ := json.Marshal(visibility.View(st, e))
		s := string(out)
		if e.Kind == "github" {
			if strings.Contains(s, "Kanal") || strings.Contains(s, `"concept"`) || strings.Contains(s, `"title"`) {
				t.Errorf("hidden GitHub repo animora leaks: %s", s)
			}
			continue
		}
		for _, w := range []string{"Kanal", "Seri", `"T"`} {
			if !strings.Contains(s, w) {
				t.Errorf("video event lost %s: %s", w, s)
			}
		}
	}
	h := store.Hidden
	if _, ok := st.SetProduct(animora.Product, &h, nil, nil); !ok {
		t.Fatal("SetProduct")
	}
	for _, e := range st.Events(store.Query{Kind: "animora", Limit: 10}) {
		out, _ := json.Marshal(visibility.View(st, e))
		for _, w := range []string{"Kanal", "Seri", `"title"`} {
			if strings.Contains(string(out), w) {
				t.Errorf("hidden video product leaks %s: %s", w, out)
			}
		}
	}
}

func TestMigrateKeepsDedupe(t *testing.T) {
	captureLog(t)
	st, _ := store.New(&fakeP{sn: oldSnapshot(mixedOld())})
	if !st.Seen("animora-1", "vid-1") {
		t.Fatal("seen key lost")
	}
	// the feed pull and the push of the same video id both use integration + id and now both name the new product
	for _, kind := range []string{"push", "pull"} {
		_, ok := st.AddAccepted(store.Accept{Integration: "animora-1", Kind: "animora", Key: "vid-1", ID: "vid-1", Type: "video.published", At: t0,
			Product: animora.Product, ProductName: animora.Name, Vis: store.Public})
		if ok {
			t.Errorf("%s of an already seen id was accepted again", kind)
		}
	}
	if _, ok := st.AddAccepted(store.Accept{Integration: "animora-1", Kind: "animora", Key: "vid-2", ID: "vid-2", Type: "video.published", At: t0,
		Product: animora.Product, ProductName: animora.Name, Vis: store.Public}); !ok {
		t.Fatal("new id rejected")
	}
	if _, ok := st.AddAccepted(store.Accept{Integration: "animora-1", Kind: "animora", Key: "vid-2", ID: "vid-2", Type: "video.published", At: t0,
		Product: animora.Product, ProductName: animora.Name, Vis: store.Public}); ok {
		t.Error("second delivery of vid-2 not deduped")
	}
}
