// Package feed pulls the mfardiansyah.id JSON Feed 1.1 and turns new items into article.published
// events. Item ids are used as event ids, so a push with the same id and a pull dedupe each other.
package feed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/animora"
	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

const (
	maxBody    = 1 << 20
	maxItems   = 20
	fetchLimit = 5 * time.Second
)

type Puller struct {
	St     *store.Store
	Hub    *hub.Hub
	Client *http.Client
}

func New(st *store.Store, h *hub.Hub) *Puller {
	return &Puller{St: st, Hub: h, Client: &http.Client{}}
}

// client returns a copy of the HTTP client with the timeout and https-only redirect rule applied.
func (p *Puller) client() *http.Client {
	c := *p.Client
	c.Timeout = fetchLimit
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" {
			return errors.New("redirect to non-https URL refused")
		}
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		return nil
	}
	return &c
}

// Run pulls at start and then every interval until stop closes. Failures are only logged.
func (p *Puller) Run(interval time.Duration, stop <-chan struct{}) {
	if interval <= 0 {
		interval = 300 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		p.PullAll()
		select {
		case <-t.C:
		case <-stop:
			return
		}
	}
}

// PullAll pulls every site or animora integration that has a feed URL; the others are skipped.
func (p *Puller) PullAll() {
	for _, i := range p.St.Integrations() {
		if (i.Kind != "site" && i.Kind != "animora") || i.FeedURL == "" {
			continue
		}
		n, err := p.Pull(i)
		if err != nil {
			log.Printf("feed: %s: %v", i.ID, err) // the URL is not logged: it may carry a secret
			continue
		}
		if n > 0 {
			log.Printf("feed: %s: %d new article(s)", i.ID, n)
		}
	}
}

type jsonFeed struct {
	Version string `json:"version"`
	Items   []item `json:"items"`
}

type item struct {
	ID            string `json:"id"`
	URL           string `json:"url"`
	Title         string `json:"title"`
	DatePublished string `json:"date_published"`
	Animora       struct {
		Vendor  string `json:"vendor"`
		Channel string `json:"channel"`
	} `json:"_animora"`
	at time.Time
}

// Fetch downloads and parses a feed. Only https is accepted. It returns the newest 20 usable items.
func (p *Puller) Fetch(raw string) ([]item, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return nil, errors.New("feed URL must be https")
	}
	ctx, cancel := context.WithTimeout(context.Background(), fetchLimit)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, errors.New("bad feed URL")
	}
	req.Header.Set("Accept", "application/feed+json, application/json")
	resp, err := p.client().Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return nil, fmt.Errorf("fetch failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch failed: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, errors.New("read failed")
	}
	if len(body) > maxBody {
		return nil, errors.New("feed larger than 1 MiB")
	}
	var f jsonFeed
	if err := json.Unmarshal(body, &f); err != nil {
		return nil, errors.New("feed is not valid JSON")
	}
	if !strings.HasPrefix(f.Version, "https://jsonfeed.org/version/1") {
		return nil, errors.New("not a JSON Feed (version missing)")
	}
	var items []item
	for _, it := range f.Items {
		t, err := time.Parse(time.RFC3339, it.DatePublished)
		if it.ID == "" || len(it.ID) > 128 || it.Title == "" || it.URL == "" || err != nil {
			continue // skip items the ingest contract would reject
		}
		it.at = t.UTC()
		items = append(items, it)
	}
	sort.SliceStable(items, func(a, b int) bool { return items[a].at.After(items[b].at) })
	if len(items) > maxItems {
		items = items[:maxItems]
	}
	return items, nil
}

// Pull fetches one integration's feed and records new items. It returns how many were new.
func (p *Puller) Pull(i store.Integration) (int, error) {
	items, err := p.Fetch(i.FeedURL)
	if err != nil {
		return 0, err
	}
	n := 0
	for k := len(items) - 1; k >= 0; k-- { // oldest first so seq follows publish order
		it := items[k]
		if i.Kind == "animora" {
			if p.addAnimora(i, it) {
				n++
			}
			continue
		}
		raw := map[string]any{"id": it.ID, "type": "article.published", "at": it.at.Format(time.RFC3339),
			"data": map[string]any{"title": it.Title, "url": it.URL, "to": "blog"}}
		ev, fresh := p.St.AddAccepted(store.Accept{Integration: i.ID, Kind: "site", Key: it.ID, ID: it.ID,
			Type: "article.published", At: it.at, Raw: raw})
		if fresh {
			p.Hub.Publish(ev)
			n++
		}
	}
	return n, nil
}

// addAnimora records one Animora feed item as video.published, built exactly like the push path. Items without
// a valid _animora.vendor, or that the ingest contract would reject, are skipped.
func (p *Puller) addAnimora(i store.Integration, it item) bool {
	data, err := animora.Clean("video.published", map[string]any{"vendor": it.Animora.Vendor,
		"channel": it.Animora.Channel, "title": it.Title, "url": it.URL, "publishedAt": it.DatePublished})
	if err != nil {
		return false
	}
	ev, fresh := p.St.AddAccepted(store.Accept{Integration: i.ID, Kind: "animora", Key: it.ID, ID: it.ID,
		Type: "video.published", At: it.at, Product: animora.Product, ProductName: animora.Name, Vis: store.Public,
		Org: i.Org, Raw: animora.Build(it.ID, "video.published", it.at, i.Org, data)})
	if fresh {
		p.Hub.Publish(ev)
	}
	return fresh
}
