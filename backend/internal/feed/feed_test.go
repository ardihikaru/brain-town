package feed

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

const sample = `{"version":"https://jsonfeed.org/version/1.1","items":[
 {"id":"post-a","url":"https://x.id/blog/a","title":"A","date_published":"2026-11-20T09:00:00Z"},
 {"id":"post-b","url":"https://x.id/blog/b","title":"B","date_published":"2026-11-21T09:00:00+07:00"},
 {"id":"","url":"https://x.id/blog/c","title":"bad","date_published":"2026-11-21T09:00:00Z"}]}`

func setup(t *testing.T, h http.Handler) (*Puller, *store.Store, store.Integration, *httptest.Server) {
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	st, _ := store.New(nil)
	i, _ := st.CreateIntegration("site", "Site", "")
	f := srv.URL + "/feed.json"
	i2, _ := st.UpdateIntegration(i.ID, nil, nil, &f)
	return &Puller{St: st, Hub: hub.New(), Client: srv.Client()}, st, i2, srv
}

func TestPullDedupesAndPublishes(t *testing.T) {
	p, st, i, _ := setup(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, sample) }))
	ch, _ := p.Hub.Subscribe()
	// post-a was already pushed by the site: the pull must not duplicate it.
	if _, ok := st.AddAccepted(store.Accept{Integration: i.ID, Kind: "site", Key: "post-a", ID: "post-a", Type: "article.published", At: time.Now()}); !ok {
		t.Fatal("push failed")
	}
	n, err := p.Pull(i)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v, want 1 new", n, err)
	}
	if ev := <-ch; ev.ID != "post-b" || ev.Type != "article.published" || ev.Raw["data"].(map[string]any)["to"] != "blog" {
		t.Fatalf("unexpected event %+v", ev)
	}
	if n, _ := p.Pull(i); n != 0 {
		t.Fatalf("second pull added %d", n)
	}
}

func TestPullAllSkipsIntegrationsWithoutFeed(t *testing.T) {
	p, st, _, _ := setup(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, sample) }))
	st.CreateIntegration("site", "Other", "")
	p.PullAll()
	if got := len(st.Events(store.Query{})); got != 2 {
		t.Fatalf("events=%d, want 2", got)
	}
}

func TestRejects(t *testing.T) {
	p, _, i, srv := setup(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redir":
			http.Redirect(w, r, "http://example.invalid/feed", 302)
		case "/big":
			fmt.Fprint(w, `{"version":"https://jsonfeed.org/version/1.1","pad":"`+strings.Repeat("x", 2<<20)+`"}`)
		case "/notfeed":
			fmt.Fprint(w, `{"items":[]}`)
		default:
			fmt.Fprint(w, `{not json`)
		}
	}))
	for _, c := range []struct{ name, url string }{
		{"http", "http://example.com/feed.json"},
		{"malformed", srv.URL + "/feed.json"},
		{"not a feed", srv.URL + "/notfeed"},
		{"redirect to http", srv.URL + "/redir"},
		{"too big", srv.URL + "/big"},
	} {
		i.FeedURL = c.url
		if n, err := p.Pull(i); err == nil || n != 0 {
			t.Errorf("%s: n=%d err=%v, want error", c.name, n, err)
		}
	}
}

func TestLatest20(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"version":"https://jsonfeed.org/version/1.1","items":[`)
	for k := 0; k < 30; k++ {
		if k > 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `{"id":"post-%d","url":"https://x.id/%d","title":"t","date_published":"2026-11-%02dT00:00:00Z"}`, k, k, k+1)
	}
	sb.WriteString("]}")
	p, _, i, _ := setup(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, sb.String()) }))
	if n, err := p.Pull(i); err != nil || n != 20 {
		t.Fatalf("n=%d err=%v, want 20", n, err)
	}
}
