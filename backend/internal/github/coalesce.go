package github

import (
	"sync"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/hub"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

const (
	DefaultWindow = 15 * time.Second
	DefaultMax    = 1000
)

// base identifies where a delivery came from; it is the same for every delivery in one rollup.
type base struct {
	Integration, Org, Repo string
	Hidden                 bool
	Delivery               string    // first delivery id
	At                     time.Time // when the first delivery was received
}

type rollup struct {
	base
	typ       string
	task      map[string]any
	data      map[string]any
	jobs      map[string]string // ci.run: job id -> queued|running|passed|failed
	runStatus string            // ci.run: from workflow_run
	opened    time.Time         // coalescer clock when the window started
}

// Coalescer merges grouped deliveries for one window and flushes each rollup as one stored event.
// It holds at most max open rollups; when full, the oldest is flushed at once.
type Coalescer struct {
	St     *store.Store
	Hub    *hub.Hub
	Window time.Duration
	Max    int
	Now    func() time.Time // injectable clock
	Tick   time.Duration    // how often Run looks for due rollups

	mu   sync.Mutex
	open map[string]*rollup
}

func NewCoalescer(st *store.Store, h *hub.Hub, window time.Duration, max int, now func() time.Time) *Coalescer {
	if window <= 0 {
		window = DefaultWindow
	}
	if max <= 0 {
		max = DefaultMax
	}
	if now == nil {
		now = time.Now
	}
	return &Coalescer{St: st, Hub: h, Window: window, Max: max, Now: now, Tick: time.Second, open: map[string]*rollup{}}
}

// Add merges one delivery into its rollup, opening it when needed. Nothing here waits for the database.
func (c *Coalescer) Add(b base, ct contrib) {
	key := b.Integration + "\x00" + b.Repo + "\x00" + ct.Subject + "\x00" + ct.Type
	var evict *rollup
	c.mu.Lock()
	r, ok := c.open[key]
	if !ok {
		if len(c.open) >= c.Max {
			evict = c.takeOldest()
		}
		r = &rollup{base: b, typ: ct.Type, data: map[string]any{}, jobs: map[string]string{}, opened: c.Now()}
		c.open[key] = r
	}
	r.Hidden = r.Hidden || b.Hidden
	r.merge(ct)
	c.mu.Unlock()
	if evict != nil {
		c.emit(evict)
	}
}

func (c *Coalescer) takeOldest() *rollup {
	var ok string
	var oldest *rollup
	for k, r := range c.open {
		if oldest == nil || r.opened.Before(oldest.opened) {
			ok, oldest = k, r
		}
	}
	delete(c.open, ok)
	return oldest
}

// Len reports the number of open rollups.
func (c *Coalescer) Len() int { c.mu.Lock(); defer c.mu.Unlock(); return len(c.open) }

// FlushDue emits every rollup whose window has closed.
func (c *Coalescer) FlushDue() {
	now := c.Now()
	var due []*rollup
	c.mu.Lock()
	for k, r := range c.open {
		if now.Sub(r.opened) >= c.Window {
			due = append(due, r)
			delete(c.open, k)
		}
	}
	c.mu.Unlock()
	for _, r := range due {
		c.emit(r)
	}
}

// FlushAll emits every open rollup (shutdown).
func (c *Coalescer) FlushAll() {
	c.mu.Lock()
	all := make([]*rollup, 0, len(c.open))
	for k, r := range c.open {
		all = append(all, r)
		delete(c.open, k)
	}
	c.mu.Unlock()
	for _, r := range all {
		c.emit(r)
	}
}

// Run flushes due rollups on a ticker until stop is closed. The caller flushes the rest with FlushAll.
func (c *Coalescer) Run(stop <-chan struct{}) {
	t := time.NewTicker(c.Tick)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			c.FlushDue()
		case <-stop:
			return
		}
	}
}

func (r *rollup) merge(ct contrib) {
	sum := map[string]bool{}
	for _, f := range sumFields[ct.Type] {
		sum[f] = true
	}
	for k, v := range ct.Data {
		if sum[k] {
			a, _ := r.data[k].(int)
			b, _ := v.(int)
			r.data[k] = a + b
			continue
		}
		r.data[k] = v
	}
	if ct.Task != nil {
		r.task = ct.Task
	}
	if ct.JobID != "" {
		r.jobs[ct.JobID] = ct.JobStatus
	}
	if ct.RunStatus != "" && r.runStatus != "passed" && r.runStatus != "failed" {
		r.runStatus = ct.RunStatus
	}
}

// ciState derives the run status and job counts from what the rollup saw.
func (r *rollup) ciState() {
	total, done, failed, running := len(r.jobs), 0, 0, 0
	for _, s := range r.jobs {
		switch s {
		case "passed":
			done++
		case "failed":
			done++
			failed++
		case "running":
			running++
		}
	}
	status := r.runStatus
	if status != "passed" && status != "failed" {
		switch {
		case total > 0 && done == total && failed > 0:
			status = "failed"
		case total > 0 && done == total:
			status = "passed"
		case running > 0 || done > 0 || status == "running":
			status = "running"
		default:
			status = "queued"
		}
	}
	r.data["status"] = status
	r.data["jobs"] = map[string]any{"total": total, "done": done, "failed": failed}
}

// envelope builds the stored event body (see docs/integrations/github.md).
func envelope(id, typ, org, repo string, hidden bool, at time.Time, task, data map[string]any) map[string]any {
	e := map[string]any{"id": id, "type": typ, "at": at.UTC().Format(time.RFC3339), "org": org, "data": data}
	if data == nil {
		e["data"] = map[string]any{}
	}
	if repo != "" {
		vis := store.Public
		if hidden {
			vis = store.Hidden
		}
		e["product"] = map[string]any{"key": repo, "name": repo, "visibility": vis}
	}
	if task != nil {
		e["task"] = task
	}
	return e
}

func (c *Coalescer) emit(r *rollup) {
	if r.typ == "ci.run" {
		r.ciState()
	}
	id := "gh-roll-" + r.Delivery
	vis := ""
	if r.Hidden {
		vis = store.Hidden
	}
	ev, fresh := c.St.AddAccepted(store.Accept{
		Integration: r.Integration, Kind: "github", Key: "roll-" + r.Delivery, ID: id, Type: r.typ, At: r.At,
		Product: r.Repo, ProductName: r.Repo, Vis: vis, Org: r.Org,
		Raw: envelope(id, r.typ, r.Org, r.Repo, r.Hidden, r.At, r.task, r.data),
	})
	if fresh {
		c.Hub.Publish(ev)
	}
}
