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
	typ    string
	task   map[string]any
	data   map[string]any
	run    *runState // ci.run: the per-run state shared across windows
	opened time.Time // coalescer clock when the window started
}

const (
	// MaxRuns bounds the per-run CI state cache; entries unseen for RunTTL are dropped.
	MaxRuns = 1000
	RunTTL  = time.Hour
	// MaxJobsPerRun bounds the job ids remembered for one run; further new jobs are not counted.
	MaxJobsPerRun = 256
)

// runState is what the town knows about one CI run across rollup windows.
type runState struct {
	status   string            // from workflow_run: queued|running|passed|failed ("" until seen)
	jobs     map[string]string // job id -> queued|running|passed|failed (idempotent per id)
	pr       any
	workflow string
	seen     time.Time
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
	runs map[string]*runState
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
	return &Coalescer{St: st, Hub: h, Window: window, Max: max, Now: now, Tick: time.Second, open: map[string]*rollup{}, runs: map[string]*runState{}}
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
		r = &rollup{base: b, typ: ct.Type, data: map[string]any{}, opened: c.Now()}
		c.open[key] = r
	}
	if ct.Type == "ci.run" {
		r.run = c.runFor(b.Integration + "\x00" + b.Repo + "\x00" + ct.Subject)
	}
	r.Hidden = r.Hidden || b.Hidden
	r.merge(ct)
	c.mu.Unlock()
	if evict != nil {
		c.emit(evict)
	}
}

// runFor returns the cached state of a run, creating it (and evicting) as needed. Caller holds c.mu.
func (c *Coalescer) runFor(key string) *runState {
	now := c.Now()
	if rs, ok := c.runs[key]; ok {
		rs.seen = now
		return rs
	}
	if len(c.runs) >= MaxRuns {
		c.expireRuns(now)
	}
	if len(c.runs) >= MaxRuns {
		oldest, ok := "", false
		var ot time.Time
		for k, rs := range c.runs {
			if !ok || rs.seen.Before(ot) {
				oldest, ot, ok = k, rs.seen, true
			}
		}
		delete(c.runs, oldest)
	}
	rs := &runState{jobs: map[string]string{}, seen: now}
	c.runs[key] = rs
	return rs
}

// expireRuns drops runs not seen for RunTTL. Caller holds c.mu.
func (c *Coalescer) expireRuns(now time.Time) {
	for k, rs := range c.runs {
		if now.Sub(rs.seen) >= RunTTL {
			delete(c.runs, k)
		}
	}
}

// Runs reports the number of cached CI runs.
func (c *Coalescer) Runs() int { c.mu.Lock(); defer c.mu.Unlock(); return len(c.runs) }

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
	c.expireRuns(now)
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
	rs := r.run
	if rs == nil {
		return
	}
	if w, _ := ct.Data["workflow"].(string); w != "" {
		rs.workflow = w
	}
	if pr, ok := ct.Data["pr"]; ok {
		rs.pr = pr
	}
	if ct.JobID != "" {
		if _, known := rs.jobs[ct.JobID]; known || len(rs.jobs) < MaxJobsPerRun {
			rs.jobs[ct.JobID] = ct.JobStatus
		}
	}
	if ct.RunStatus != "" && rs.status != "passed" && rs.status != "failed" {
		rs.status = ct.RunStatus
	}
}

// ciState derives the run status and job counts from the whole run seen so far, not only this window.
func (c *Coalescer) ciState(r *rollup) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rs := r.run
	if rs.workflow != "" {
		r.data["workflow"] = rs.workflow
	}
	if rs.pr != nil {
		r.data["pr"] = rs.pr
	}
	total, done, failed, running := len(rs.jobs), 0, 0, 0
	for _, s := range rs.jobs {
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
	status := rs.status
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
	if r.typ == "ci.run" && r.run != nil {
		c.ciState(r)
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
