package github

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/store"
	"github.com/ardihikaru/brain-town/backend/internal/visibility"
)

func user() M { return M{"type": "User", "login": "someone"} }

// TestMappingTable walks every row of the contract's event mapping table with small hand-written
// payloads that use GitHub's real field names.
func TestMappingTable(t *testing.T) {
	r := repo("hall", false)
	pr := func(extra M) M {
		m := M{"number": 9, "title": "Fix export", "body": "Fixes #48 and more", "draft": false, "merged": false}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	cases := []struct {
		name, event string
		payload     M
		typ         string
		task        M
		data        M
	}{
		{"issue opened", "issues", M{"action": "opened", "issue": issue(48, "Export fails", nil), "repository": r},
			"issue.opened", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"labels": []any{"#d73a4a"}}},
		{"issue reopened", "issues", M{"action": "reopened", "issue": issue(48, "Export fails", nil), "repository": r},
			"issue.opened", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"labels": []any{"#d73a4a"}}},
		{"issue assigned", "issues", M{"action": "assigned", "issue": issue(48, "Export fails", nil), "repository": r},
			"issue.assigned", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{}},
		{"task list changed", "issues", M{"action": "edited", "changes": M{"body": M{"from": "- [ ] a\n- [ ] b"}},
			"issue": issue(48, "Export fails", M{"body": "- [x] a\n- [ ] b"}), "repository": r},
			"task.done", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"done": 1, "total": 2}},
		{"issue closed completed", "issues", M{"action": "closed", "issue": issue(48, "Export fails", M{"state_reason": "completed"}), "repository": r},
			"issue.closed", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"reason": "completed"}},
		{"issue closed not planned", "issues", M{"action": "closed", "issue": issue(48, "Export fails", M{"state_reason": "not_planned"}), "repository": r},
			"issue.closed", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"reason": "not_planned"}},
		{"issue labeled", "issues", M{"action": "labeled", "issue": issue(48, "Export fails", nil), "label": M{"name": "bug", "color": "d73a4a"}, "repository": r},
			"issue.labeled", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"count": 1, "color": "#d73a4a", "label": "bug"}},
		{"sub issues", "sub_issues", M{"action": "sub_issue_added", "parent_issue": issue(10, "Parent", M{"sub_issues_summary": M{"total": 5, "completed": 2, "percent_completed": 40}}),
			"sub_issue": issue(11, "kid", nil), "repository": r},
			"issue.subissues", M{"id": "10", "title": "Parent", "kind": "issue"}, M{"count": 5, "done": 2}},
		{"pr opened", "pull_request", M{"action": "opened", "pull_request": pr(M{"draft": true}), "repository": r},
			"pr.opened", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"pr": 9, "issue": 48, "draft": true}},
		{"pr ready", "pull_request", M{"action": "ready_for_review", "pull_request": pr(nil), "repository": r},
			"pr.opened", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"pr": 9, "issue": 48, "draft": false}},
		{"pr merged", "pull_request", M{"action": "closed", "pull_request": pr(M{"merged": true}), "repository": r},
			"pr.merged", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"pr": 9, "issue": 48}},
		{"pr closed unmerged", "pull_request", M{"action": "closed", "pull_request": pr(M{"body": "no link"}), "repository": r},
			"pr.closed", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"pr": 9}},
		{"pr review approved", "pull_request_review", M{"action": "submitted", "review": M{"state": "approved"}, "pull_request": pr(nil), "sender": user(), "repository": r},
			"pr.reviewed", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"pr": 9, "approved": 1, "changes": 0, "commented": 0}},
		{"pr review changes", "pull_request_review", M{"action": "submitted", "review": M{"state": "changes_requested"}, "pull_request": pr(nil), "sender": user(), "repository": r},
			"pr.reviewed", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"pr": 9, "approved": 0, "changes": 1, "commented": 0}},
		{"issue comment", "issue_comment", M{"action": "created", "issue": issue(48, "Export fails", nil), "comment": M{"body": "private words"}, "sender": user(), "repository": r},
			"issue.commented", M{"id": "48", "title": "Export fails", "kind": "issue"}, M{"count": 1}},
		{"comment on a pr", "issue_comment", M{"action": "created", "issue": issue(9, "Fix export", M{"pull_request": M{"url": "x"}}), "sender": user(), "repository": r},
			"issue.commented", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"count": 1}},
		{"pr review comment", "pull_request_review_comment", M{"action": "created", "pull_request": pr(nil), "sender": user(), "repository": r},
			"issue.commented", M{"id": "9", "title": "Fix export", "kind": "pr"}, M{"count": 1}},
		{"check run failed", "check_run", M{"action": "completed", "check_run": M{"name": "lint", "conclusion": "failure", "pull_requests": []any{M{"number": 9}}}, "repository": r},
			"pr.checks", M{"id": "9", "kind": "pr"}, M{"pr": 9, "check": "lint", "status": "failed"}},
		{"check run passed", "check_run", M{"action": "completed", "check_run": M{"name": "lint", "conclusion": "success", "pull_requests": []any{M{"number": 9}}}, "repository": r},
			"pr.checks", M{"id": "9", "kind": "pr"}, M{"pr": 9, "check": "lint", "status": "passed"}},
		{"workflow run", "workflow_run", M{"action": "completed", "workflow_run": M{"id": 555, "name": "CI", "conclusion": "success", "pull_requests": []any{M{"number": 9}}}, "repository": r},
			"ci.run", nil, M{"run": 555, "workflow": "CI", "pr": 9, "status": "passed", "jobs": M{"total": 0, "done": 0, "failed": 0}}},
		{"workflow job", "workflow_job", M{"action": "completed", "workflow_job": M{"id": 1, "run_id": 555, "workflow_name": "CI", "conclusion": "failure"}, "repository": r},
			"ci.run", nil, M{"run": 555, "workflow": "CI", "status": "failed", "jobs": M{"total": 1, "done": 1, "failed": 1}}},
		{"push", "push", M{"ref": "refs/heads/main", "commits": []any{M{"message": "private msg"}, M{"message": "other"}}, "repository": r},
			"repo.pushed", nil, M{"commits": 2, "branch": "main"}},
		{"branch created", "create", M{"ref": "feat/x", "ref_type": "branch", "repository": r},
			"ref.created", nil, M{"refType": "branch", "count": 1, "ref": "feat/x"}},
		{"tag deleted", "delete", M{"ref": "v1", "ref_type": "tag", "repository": r},
			"ref.deleted", nil, M{"refType": "tag", "count": 1, "ref": "v1"}},
		{"label edited", "label", M{"action": "edited", "label": M{"name": "x"}, "repository": r},
			"repo.labels", nil, M{"count": 1}},
		{"discussion created", "discussion", M{"action": "created", "discussion": M{"number": 3, "title": "Ideas"}, "repository": r},
			"discussion.opened", M{"id": "3", "title": "Ideas", "kind": "discussion"}, M{}},
		{"discussion answered", "discussion", M{"action": "answered", "discussion": M{"number": 3, "title": "Ideas"}, "repository": r},
			"discussion.answered", M{"id": "3", "title": "Ideas", "kind": "discussion"}, M{}},
		{"discussion comment", "discussion_comment", M{"action": "created", "discussion": M{"number": 3, "title": "Ideas"}, "sender": user(), "repository": r},
			"discussion.commented", M{"id": "3", "title": "Ideas", "kind": "discussion"}, M{"count": 1}},
		{"star", "star", M{"action": "created", "repository": r},
			"repo.starred", nil, M{"count": 1, "total": 7}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t, "")
			e.ok(c.event, c.payload)
			ev := e.one(c.typ)
			raw := ev.Raw
			if raw["type"] != c.typ || raw["org"] != "Acme" || ev.Kind != "github" || ev.Product != "hall" {
				t.Errorf("envelope header: %v product=%q", raw, ev.Product)
			}
			if !strings.HasPrefix(raw["id"].(string), "gh-") || ev.ID != raw["id"] {
				t.Errorf("id %v / %v", raw["id"], ev.ID)
			}
			if p := raw["product"].(M); p["key"] != "hall" || p["name"] != "hall" || p["visibility"] != "public" {
				t.Errorf("product %v", p)
			}
			if _, err := time.Parse(time.RFC3339, raw["at"].(string)); err != nil {
				t.Errorf("at: %v", err)
			}
			if c.task == nil {
				if _, has := raw["task"]; has {
					t.Errorf("unexpected task %v", raw["task"])
				}
			} else if !reflect.DeepEqual(M(raw["task"].(M)), c.task) {
				t.Errorf("task = %v, want %v", raw["task"], c.task)
			}
			if got := fmt.Sprint(raw["data"]); got != fmt.Sprint(c.data) {
				t.Errorf("data = %v, want %v", got, fmt.Sprint(c.data))
			}
			// The payload never leaks into the stored envelope.
			s := fmt.Sprint(raw)
			for _, leak := range []string{"private words", "private msg", "someone", "Fixes #48"} {
				if strings.Contains(s, leak) {
					t.Errorf("envelope leaks %q: %s", leak, s)
				}
			}
		})
	}
}

func TestPingSavesEventsAndAdopts(t *testing.T) {
	e := newEnv(t, "")
	e.ok("ping", M{"zen": "Keep it logically awesome.", "hook": M{"events": []any{"issues", "pull_request", "workflow_run"}}, "organization": M{"login": "Acme"}})
	i, _ := e.st.GetIntegration(e.id)
	if !reflect.DeepEqual(i.Events, []string{"issues", "pull_request", "workflow_run"}) || i.Org != "Acme" {
		t.Errorf("integration after ping: %+v", i)
	}
	ev := e.one("ping")
	if got := fmt.Sprint(ev.Raw["data"]); got != "map[events:[issues pull_request workflow_run]]" {
		t.Errorf("ping data = %s", got)
	}
	if _, has := ev.Raw["product"]; has || strings.Contains(fmt.Sprint(ev.Raw), "Keep it") {
		t.Errorf("ping envelope: %v", ev.Raw)
	}
	if c, _ := e.send("ping", "d-1", M{"hook": M{"events": []any{"*"}}}); c != 409 {
		t.Errorf("ping redelivery: %d", c)
	}
}

func TestIgnoredAndSkipped(t *testing.T) {
	e := newEnv(t, "")
	r := repo("hall", false)
	bot := M{"type": "Bot", "login": "dependabot[bot]"}
	cases := []struct {
		name, event string
		payload     M
		want        string
	}{
		{"unknown event", "fork", M{"repository": r}, "ignored"},
		{"issue deleted", "issues", M{"action": "deleted", "issue": issue(1, "t", nil), "repository": r}, "ignored"},
		{"edit without checklist change", "issues", M{"action": "edited", "changes": M{"body": M{"from": "a"}}, "issue": issue(1, "t", M{"body": "b"}), "repository": r}, "ignored"},
		{"edit title only", "issues", M{"action": "edited", "changes": M{"title": M{"from": "a"}}, "issue": issue(1, "t", nil), "repository": r}, "ignored"},
		{"push without commits", "push", M{"ref": "refs/heads/x", "commits": []any{}, "deleted": true, "repository": r}, "ignored"},
		{"star deleted", "star", M{"action": "deleted", "repository": r}, "ignored"},
		{"check run without pr", "check_run", M{"action": "completed", "check_run": M{"name": "x", "conclusion": "success", "pull_requests": []any{}}, "repository": r}, "ignored"},
		{"check run not completed", "check_run", M{"action": "created", "check_run": M{"pull_requests": []any{M{"number": 1}}}, "repository": r}, "ignored"},
		{"bot issue comment", "issue_comment", M{"action": "created", "issue": issue(1, "t", nil), "sender": bot, "repository": r}, "skipped"},
		{"bot by login only", "issue_comment", M{"action": "created", "issue": issue(1, "t", nil), "sender": M{"type": "User", "login": "x[bot]"}, "repository": r}, "skipped"},
		{"bot review comment", "pull_request_review_comment", M{"action": "created", "pull_request": M{"number": 1}, "sender": bot, "repository": r}, "skipped"},
		{"bot review", "pull_request_review", M{"action": "submitted", "review": M{"state": "approved"}, "pull_request": M{"number": 1}, "sender": bot, "repository": r}, "skipped"},
		{"bot discussion comment", "discussion_comment", M{"action": "created", "discussion": M{"number": 1}, "sender": bot, "repository": r}, "skipped"},
	}
	for i, c := range cases {
		code, m := e.send(c.event, fmt.Sprintf("i-%d", i), c.payload)
		if code != 202 || m["status"] != c.want {
			t.Errorf("%s: want 202 %s, got %d %v", c.name, c.want, code, m)
		}
	}
	e.co.FlushAll()
	if n := len(e.events("")); n != 0 {
		t.Errorf("nothing should be stored, got %d events", n)
	}
	// A bot's issue (Dependabot) is kept.
	e.ok("issues", M{"action": "opened", "issue": issue(2, "Bump x", nil), "sender": bot, "repository": r})
	if len(e.events("issue.opened")) != 1 {
		t.Error("bot issue should be kept")
	}
	// Skipped deliveries do not claim the delivery id.
	if c, m := e.send("issue_comment", "i-8", M{"action": "created", "issue": issue(1, "t", nil), "sender": user(), "repository": r}); c != 202 || m["status"] != "accepted" {
		t.Errorf("a skipped delivery id must stay free: %d %v", c, m)
	}
}

func TestCheckRunSkippedWhenWorkflowsSubscribed(t *testing.T) {
	check := M{"action": "completed", "repository": repo("hall", false), "check_run": M{"name": "build", "conclusion": "success",
		"check_suite": M{"app": M{"slug": "github-actions"}}, "pull_requests": []any{M{"number": 4}}}}
	e := newEnv(t, "")
	e.ok("check_run", check) // no ping yet: nothing subscribed to workflows
	if len(e.events("pr.checks")) != 1 {
		t.Fatal("check run should be kept without workflow events")
	}
	for _, sub := range []string{"workflow_run", "workflow_job", "*"} {
		e := newEnv(t, "")
		e.ok("ping", M{"hook": M{"events": []any{"issues", sub}}})
		if c, m := e.send("check_run", "cr", check); c != 202 || m["status"] != "skipped" {
			t.Errorf("%s subscribed: %d %v", sub, c, m)
		}
		// A different app is still kept.
		other := M{"action": "completed", "repository": repo("hall", false), "check_run": M{"name": "codecov", "conclusion": "success",
			"check_suite": M{"app": M{"slug": "codecov"}}, "pull_requests": []any{M{"number": 4}}}}
		e.ok("check_run", other)
		if len(e.events("pr.checks")) != 1 {
			t.Errorf("%s: third-party check should be kept", sub)
		}
	}
}

func TestRollupCountsAfterWindow(t *testing.T) {
	e := newEnv(t, "")
	c := M{"action": "created", "issue": issue(48, "Export fails", nil), "sender": user(), "repository": repo("hall", false)}
	for i := 0; i < 10; i++ {
		e.n++
		if code, _ := e.send("issue_comment", fmt.Sprintf("c-%d", i), c); code != 202 {
			t.Fatal(code)
		}
		e.clk.Advance(time.Second) // 10 s total: still inside the 15 s window of the first
	}
	e.co.FlushDue()
	if len(e.events("issue.commented")) != 0 || e.co.Len() != 1 {
		t.Fatal("rollup flushed before its window closed")
	}
	// A different issue is a different rollup.
	c2 := M{"action": "created", "issue": issue(49, "Other", nil), "sender": user(), "repository": repo("hall", false)}
	e.send("issue_comment", "x-1", c2)
	e.clk.Advance(5 * time.Second) // first rollup is now 15 s old, second is 5 s old
	e.co.FlushDue()
	evs := e.events("issue.commented")
	if len(evs) != 1 {
		t.Fatalf("want exactly the first rollup flushed, got %d", len(evs))
	}
	d := evs[0].Raw["data"].(M)
	if d["count"] != 10 || evs[0].ID != "gh-roll-c-0" || evs[0].Raw["id"] != "gh-roll-c-0" {
		t.Errorf("rollup: id=%s data=%v", evs[0].ID, d)
	}
	if evs[0].Raw["task"].(M)["id"] != "48" {
		t.Errorf("task = %v", evs[0].Raw["task"])
	}
	e.clk.Advance(15 * time.Second)
	e.co.FlushDue()
	if len(e.events("issue.commented")) != 2 || e.co.Len() != 0 {
		t.Error("second rollup should flush")
	}
	// It reaches the hub like any event.
	ch, cancel := e.hub.Subscribe()
	defer cancel()
	e.send("star", "s-1", M{"action": "created", "repository": repo("hall", false)})
	e.send("star", "s-2", M{"action": "created", "repository": repo("hall", false)})
	e.co.FlushAll()
	select {
	case ev := <-ch:
		if ev.Type != "repo.starred" || ev.Raw["data"].(M)["count"] != 2 {
			t.Errorf("published %v", ev.Raw)
		}
	default:
		t.Error("rollup not published on the hub")
	}
}

func TestRollupSumsReviewsAndPushes(t *testing.T) {
	e := newEnv(t, "")
	r := repo("hall", false)
	for i, st := range []string{"approved", "approved", "changes_requested", "commented"} {
		e.send("pull_request_review", fmt.Sprintf("rv-%d", i), M{"action": "submitted", "review": M{"state": st}, "pull_request": M{"number": 9, "title": "t"}, "sender": user(), "repository": r})
	}
	e.send("push", "p1", M{"ref": "refs/heads/main", "commits": []any{M{}, M{}}, "repository": r})
	e.send("push", "p2", M{"ref": "refs/heads/main", "commits": []any{M{}}, "repository": r})
	e.send("push", "p3", M{"ref": "refs/heads/dev", "commits": []any{M{}}, "repository": r}) // other branch, other rollup
	e.co.FlushAll()
	if d := e.events("pr.reviewed")[0].Raw["data"].(M); d["approved"] != 2 || d["changes"] != 1 || d["commented"] != 1 || d["pr"] != 9 {
		t.Errorf("reviews %v", d)
	}
	pushes := e.events("repo.pushed")
	if len(pushes) != 2 {
		t.Fatalf("pushes: %d", len(pushes))
	}
	for _, p := range pushes {
		d := p.Raw["data"].(M)
		if (d["branch"] == "main") != (d["commits"] == 3) {
			t.Errorf("push rollup %v", d)
		}
	}
}

func TestCIRunKeepsLatestState(t *testing.T) {
	e := newEnv(t, "")
	r := repo("hall", false)
	run := func(action, concl string) {
		e.n++
		e.send("workflow_run", fmt.Sprintf("wr-%d", e.n), M{"action": action, "workflow_run": M{"id": 77, "name": "CI", "conclusion": concl}, "repository": r})
	}
	job := func(id int, action, concl string) {
		e.n++
		e.send("workflow_job", fmt.Sprintf("wj-%d", e.n), M{"action": action, "workflow_job": M{"id": id, "run_id": 77, "workflow_name": "CI", "conclusion": concl}, "repository": r})
	}
	run("requested", "")
	job(1, "queued", "")
	job(2, "queued", "")
	job(1, "in_progress", "")
	job(1, "completed", "success")
	e.clk.Advance(16 * time.Second)
	e.co.FlushDue()
	first := e.events("ci.run")
	if len(first) != 1 {
		t.Fatalf("want 1 ci.run, got %d", len(first))
	}
	if d := first[0].Raw["data"].(M); d["status"] != "running" || fmt.Sprint(d["jobs"]) != "map[done:1 failed:0 total:2]" || d["run"] != 77 || d["workflow"] != "CI" {
		t.Errorf("mid-run state: %v", d)
	}
	job(2, "completed", "failure")
	run("completed", "failure")
	e.co.FlushAll()
	all := e.events("ci.run")
	if len(all) != 2 {
		t.Fatalf("want 2 ci.run, got %d", len(all))
	}
	var last store.Event
	for _, ev := range all {
		if ev.Seq > last.Seq {
			last = ev
		}
	}
	if d := last.Raw["data"].(M); d["status"] != "failed" || fmt.Sprint(d["jobs"]) != "map[done:2 failed:1 total:2]" {
		t.Errorf("final state: %v", d)
	}
	// A late job event cannot reopen a finished run inside one window.
	e2 := newEnv(t, "")
	e2.ok("workflow_run", M{"action": "completed", "workflow_run": M{"id": 5, "name": "CI", "conclusion": "success"}, "repository": r})
	e2.ok("workflow_run", M{"action": "in_progress", "workflow_run": M{"id": 5, "name": "CI"}, "repository": r})
	if d := e2.one("ci.run").Raw["data"].(M); d["status"] != "passed" {
		t.Errorf("finished run reopened: %v", d)
	}
}

func TestPrivateRepoIsHiddenAndMasked(t *testing.T) {
	e := newEnv(t, "")
	priv := repo("secret-hall", true)
	e.ok("issues", M{"action": "opened", "issue": issue(1, "Customer breach", nil), "repository": priv})
	e.ok("issues", M{"action": "labeled", "issue": issue(1, "Customer breach", nil), "label": M{"name": "internal-only", "color": "ff0000"}, "repository": priv})
	e.ok("push", M{"ref": "refs/heads/launch-codes", "commits": []any{M{}}, "repository": priv})
	e.ok("workflow_run", M{"action": "completed", "workflow_run": M{"id": 1, "name": "Deploy prod", "conclusion": "success"}, "repository": priv})
	e.ok("check_run", M{"action": "completed", "check_run": M{"name": "secret-check", "conclusion": "success", "pull_requests": []any{M{"number": 2}}}, "repository": priv})
	e.ok("create", M{"ref": "secret-branch", "ref_type": "branch", "repository": priv})
	e.co.FlushAll()

	p, ok := e.st.GetProduct("secret-hall")
	if !ok || p.Visibility != store.Hidden || p.Alias == "secret-hall" {
		t.Fatalf("private repo should create a hidden product: %+v", p)
	}
	if got := len(e.events("")); got != 6 {
		t.Fatalf("want 6 events, got %d", got)
	}
	for _, ev := range e.events("") {
		pub := fmt.Sprint(visibility.View(e.st, ev))
		for _, leak := range []string{"secret-hall", "Customer breach", "internal-only", "launch-codes", "Deploy prod", "secret-check", "secret-branch"} {
			if strings.Contains(pub, leak) {
				t.Errorf("%s leaks %q: %s", ev.Type, leak, pub)
			}
		}
		if !strings.Contains(pub, p.Alias) {
			t.Errorf("%s should show the alias %q: %s", ev.Type, p.Alias, pub)
		}
	}
	// Colours and counts stay.
	for _, ev := range e.events("issue.labeled") {
		d := visibility.View(e.st, ev)["payload"].(map[string]any)["data"].(map[string]any)
		if d["color"] != "#ff0000" || d["count"] == nil {
			t.Errorf("colour/count lost: %v", d)
		}
	}
	// A public repo stays public and unmasked.
	e.ok("issues", M{"action": "opened", "issue": issue(5, "Fine to show", nil), "repository": repo("open-hall", false)})
	if pub := fmt.Sprint(visibility.View(e.st, e.events("issue.opened")[1])); !strings.Contains(pub, "Fine to show") || !strings.Contains(pub, "open-hall") {
		t.Errorf("public event masked: %s", pub)
	}
}

func TestCoalescerIsBounded(t *testing.T) {
	st, _ := store.New(nil)
	h := hubNew()
	clk := &clock{t: time.Now()}
	co := NewCoalescer(st, h, time.Hour, 5, clk.Now)
	for i := 0; i < 50; i++ {
		clk.Advance(time.Millisecond)
		co.Add(base{Integration: "i", Org: "o", Repo: "r", Delivery: fmt.Sprintf("d-%d", i), At: clk.Now()},
			contrib{Type: "issue.commented", Grouped: true, Subject: fmt.Sprint(i), Data: map[string]any{"count": 1}})
		if co.Len() > 5 {
			t.Fatalf("open rollups = %d, limit 5", co.Len())
		}
	}
	// The oldest were flushed to make room (45 of 50), the newest five are still open.
	if got := len(st.Events(store.Query{Limit: 500})); got != 45 {
		t.Errorf("flushed %d, want 45", got)
	}
	if first := st.Events(store.Query{Limit: 1})[0]; first.ID != "gh-roll-d-0" {
		t.Errorf("oldest should flush first, got %s", first.ID)
	}
	co.FlushAll()
	if got := len(st.Events(store.Query{Limit: 500})); got != 50 || co.Len() != 0 {
		t.Errorf("after FlushAll: %d events, %d open", got, co.Len())
	}
}

func TestCoalescerRunFlushesOnTick(t *testing.T) {
	st, _ := store.New(nil)
	co := NewCoalescer(st, hubNew(), 20*time.Millisecond, 10, nil)
	co.Tick = 5 * time.Millisecond
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() { co.Run(stop); close(done) }()
	co.Add(base{Integration: "i", Repo: "r", Delivery: "d", At: time.Now()}, contrib{Type: "repo.labels", Grouped: true, Data: map[string]any{"count": 1}})
	deadline := time.Now().Add(2 * time.Second)
	for len(st.Events(store.Query{})) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	close(stop)
	<-done
	if len(st.Events(store.Query{})) != 1 {
		t.Error("ticker did not flush the rollup")
	}
}
