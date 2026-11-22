package github

import (
	"regexp"
	"slices"
	"strings"
)

// Outcomes of translating one delivery.
const (
	accepted = "accepted"
	ignored  = "ignored"
	skipped  = "skipped"
)

// contrib is what one delivery adds to the town: one event, or one contribution to a rollup.
type contrib struct {
	Type string
	Task map[string]any // id, title, kind; nil for repo-level events
	Data map[string]any
	// Group is the rollup key suffix (subject) for grouped events. Grouped is false for single events.
	Grouped bool
	Subject string
	// ci.run only: the state of one job, and the state of the run when the delivery is a workflow_run.
	JobID, JobStatus, RunStatus string
}

// known lists the GitHub events the town uses. Anything else is answered "ignored" without parsing.
var known = map[string]bool{
	"ping": true, "issues": true, "sub_issues": true, "pull_request": true, "pull_request_review": true,
	"issue_comment": true, "pull_request_review_comment": true, "check_run": true, "workflow_run": true,
	"workflow_job": true, "push": true, "create": true, "delete": true, "label": true, "discussion": true,
	"discussion_comment": true, "star": true,
}

// sumFields are added together when deliveries are merged into one rollup; all other data fields keep
// the latest value.
var sumFields = map[string][]string{
	"issue.labeled":        {"count"},
	"issue.commented":      {"count"},
	"pr.reviewed":          {"approved", "changes", "commented"},
	"repo.pushed":          {"commits"},
	"ref.created":          {"count"},
	"ref.deleted":          {"count"},
	"repo.labels":          {"count"},
	"discussion.commented": {"count"},
	"repo.starred":         {"count"},
}

var (
	taskItem = regexp.MustCompile(`(?m)^\s*[-*+]\s+\[([ xX])\]`)
	closes   = regexp.MustCompile(`(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)`)
)

func checklist(body string) (done, total int) {
	for _, m := range taskItem.FindAllStringSubmatch(body, -1) {
		total++
		if m[1] != " " {
			done++
		}
	}
	return
}

func task(n, title, kind string) map[string]any {
	t := map[string]any{"id": n, "kind": kind}
	if title != "" {
		t["title"] = title
	}
	return t
}

func colors(labels any) []any {
	out := []any{}
	a, _ := labels.([]any)
	for _, l := range a {
		if lm, ok := l.(map[string]any); ok && str(lm, "color") != "" {
			out = append(out, "#"+str(lm, "color"))
		}
	}
	return out
}

func conclusion(c string) string {
	switch c {
	case "success", "neutral", "skipped":
		return "passed"
	}
	return "failed"
}

// translate maps one GitHub delivery to a town contribution. events is the integration's saved
// subscription list (used to avoid counting CI twice).
func translate(event string, p map[string]any, events []string) (contrib, string) {
	action := str(p, "action")
	none := contrib{}
	switch event {
	case "issues":
		is := obj(p, "issue")
		n := id(is, "number")
		if n == "" {
			return none, ignored
		}
		t := task(n, str(is, "title"), "issue")
		switch action {
		case "opened", "reopened":
			return contrib{Type: "issue.opened", Task: t, Data: map[string]any{"labels": colors(is["labels"])}}, accepted
		case "assigned":
			return contrib{Type: "issue.assigned", Task: t, Data: map[string]any{}}, accepted
		case "edited":
			from, ok := obj(p, "changes", "body")["from"].(string)
			if !ok {
				return none, ignored
			}
			d0, t0 := checklist(from)
			d1, t1 := checklist(str(is, "body"))
			if d0 == d1 && t0 == t1 {
				return none, ignored
			}
			return contrib{Type: "task.done", Task: t, Data: map[string]any{"done": d1, "total": t1}}, accepted
		case "closed":
			reason := str(is, "state_reason")
			if reason != "not_planned" {
				reason = "completed"
			}
			return contrib{Type: "issue.closed", Task: t, Data: map[string]any{"reason": reason}}, accepted
		case "labeled":
			l := obj(p, "label")
			if l == nil {
				return none, ignored
			}
			return contrib{Type: "issue.labeled", Task: t, Grouped: true, Subject: n,
				Data: map[string]any{"count": 1, "color": "#" + str(l, "color"), "label": str(l, "name")}}, accepted
		}
	case "sub_issues":
		if !slices.Contains([]string{"sub_issue_added", "sub_issue_removed", "parent_issue_added", "parent_issue_removed"}, action) {
			return none, ignored
		}
		par := obj(p, "parent_issue")
		n := id(par, "number")
		if n == "" {
			return none, ignored
		}
		sum := obj(par, "sub_issues_summary")
		total, _ := num(sum, "total")
		done, _ := num(sum, "completed")
		return contrib{Type: "issue.subissues", Task: task(n, str(par, "title"), "issue"), Grouped: true, Subject: n,
			Data: map[string]any{"count": total, "done": done}}, accepted
	case "pull_request":
		pr := obj(p, "pull_request")
		n := id(pr, "number")
		if n == "" {
			return none, ignored
		}
		pn, _ := num(pr, "number")
		data := map[string]any{"pr": pn}
		if m := closes.FindStringSubmatch(str(pr, "body")); m != nil {
			data["issue"] = atoi(m[1])
		}
		t := task(n, str(pr, "title"), "pr")
		switch action {
		case "opened", "reopened", "ready_for_review":
			data["draft"] = boolean(pr, "draft")
			return contrib{Type: "pr.opened", Task: t, Data: data}, accepted
		case "closed":
			if boolean(pr, "merged") {
				return contrib{Type: "pr.merged", Task: t, Data: data}, accepted
			}
			return contrib{Type: "pr.closed", Task: t, Data: data}, accepted
		}
	case "pull_request_review":
		if action != "submitted" || isBot(p) {
			return none, pick(action == "submitted", skipped, ignored)
		}
		pr := obj(p, "pull_request")
		n := id(pr, "number")
		if n == "" {
			return none, ignored
		}
		pn, _ := num(pr, "number")
		d := map[string]any{"pr": pn, "approved": 0, "changes": 0, "commented": 0}
		switch strings.ToLower(str(obj(p, "review"), "state")) {
		case "approved":
			d["approved"] = 1
		case "changes_requested":
			d["changes"] = 1
		case "commented":
			d["commented"] = 1
		default:
			return none, ignored
		}
		return contrib{Type: "pr.reviewed", Task: task(n, str(pr, "title"), "pr"), Grouped: true, Subject: n, Data: d}, accepted
	case "issue_comment", "pull_request_review_comment":
		if action != "created" {
			return none, ignored
		}
		if isBot(p) {
			return none, skipped
		}
		var n, title, kind string
		if event == "issue_comment" {
			is := obj(p, "issue")
			n, title, kind = id(is, "number"), str(is, "title"), "issue"
			if is["pull_request"] != nil {
				kind = "pr"
			}
		} else {
			pr := obj(p, "pull_request")
			n, title, kind = id(pr, "number"), str(pr, "title"), "pr"
		}
		if n == "" {
			return none, ignored
		}
		return contrib{Type: "issue.commented", Task: task(n, title, kind), Grouped: true, Subject: n, Data: map[string]any{"count": 1}}, accepted
	case "check_run":
		if action != "completed" {
			return none, ignored
		}
		cr := obj(p, "check_run")
		prs, _ := cr["pull_requests"].([]any)
		if len(prs) == 0 {
			return none, ignored
		}
		first, _ := prs[0].(map[string]any)
		n := id(first, "number")
		if n == "" {
			return none, ignored
		}
		slug := str(obj(cr, "check_suite", "app"), "slug")
		if slug == "" {
			slug = str(obj(cr, "app"), "slug")
		}
		if slug == "github-actions" && (slices.Contains(events, "workflow_run") || slices.Contains(events, "workflow_job") || slices.Contains(events, "*")) {
			return none, skipped
		}
		pn, _ := num(first, "number")
		return contrib{Type: "pr.checks", Task: task(n, "", "pr"),
			Data: map[string]any{"pr": pn, "check": str(cr, "name"), "status": conclusion(str(cr, "conclusion"))}}, accepted
	case "workflow_run":
		wr := obj(p, "workflow_run")
		rid := id(wr, "id")
		if rid == "" {
			return none, ignored
		}
		var st string
		switch action {
		case "requested":
			st = "queued"
		case "in_progress":
			st = "running"
		case "completed":
			st = conclusion(str(wr, "conclusion"))
		default:
			return none, ignored
		}
		d := map[string]any{"run": atoi(rid), "workflow": str(wr, "name")}
		if prs, _ := wr["pull_requests"].([]any); len(prs) > 0 {
			if f, _ := prs[0].(map[string]any); f != nil {
				if n, ok := num(f, "number"); ok {
					d["pr"] = n
				}
			}
		}
		return contrib{Type: "ci.run", Grouped: true, Subject: rid, Data: d, RunStatus: st}, accepted
	case "workflow_job":
		wj := obj(p, "workflow_job")
		rid, jid := id(wj, "run_id"), id(wj, "id")
		if rid == "" || jid == "" {
			return none, ignored
		}
		var st string
		switch action {
		case "queued":
			st = "queued"
		case "in_progress":
			st = "running"
		case "completed":
			st = conclusion(str(wj, "conclusion"))
		default:
			return none, ignored
		}
		d := map[string]any{"run": atoi(rid)}
		if w := str(wj, "workflow_name"); w != "" {
			d["workflow"] = w
		}
		return contrib{Type: "ci.run", Grouped: true, Subject: rid, Data: d, JobID: jid, JobStatus: st}, accepted
	case "push":
		commits, _ := p["commits"].([]any)
		if len(commits) == 0 {
			return none, ignored
		}
		branch := strings.TrimPrefix(strings.TrimPrefix(str(p, "ref"), "refs/heads/"), "refs/tags/")
		return contrib{Type: "repo.pushed", Grouped: true, Subject: branch, Data: map[string]any{"commits": len(commits), "branch": branch}}, accepted
	case "create", "delete":
		rt := str(p, "ref_type")
		if rt != "branch" && rt != "tag" {
			return none, ignored
		}
		typ := pick(event == "create", "ref.created", "ref.deleted")
		return contrib{Type: typ, Grouped: true, Subject: rt, Data: map[string]any{"refType": rt, "count": 1, "ref": str(p, "ref")}}, accepted
	case "label":
		if action != "created" && action != "edited" && action != "deleted" {
			return none, ignored
		}
		return contrib{Type: "repo.labels", Grouped: true, Data: map[string]any{"count": 1}}, accepted
	case "discussion":
		d := obj(p, "discussion")
		n := id(d, "number")
		if n == "" {
			return none, ignored
		}
		t := task(n, str(d, "title"), "discussion")
		switch action {
		case "created":
			return contrib{Type: "discussion.opened", Task: t, Data: map[string]any{}}, accepted
		case "answered":
			return contrib{Type: "discussion.answered", Task: t, Data: map[string]any{}}, accepted
		}
	case "discussion_comment":
		if action != "created" {
			return none, ignored
		}
		if isBot(p) {
			return none, skipped
		}
		d := obj(p, "discussion")
		n := id(d, "number")
		if n == "" {
			return none, ignored
		}
		return contrib{Type: "discussion.commented", Task: task(n, str(d, "title"), "discussion"), Grouped: true, Subject: n, Data: map[string]any{"count": 1}}, accepted
	case "star":
		if action != "created" {
			return none, ignored
		}
		total, _ := num(obj(p, "repository"), "stargazers_count")
		return contrib{Type: "repo.starred", Grouped: true, Data: map[string]any{"count": 1, "total": total}}, accepted
	}
	return none, ignored
}

func pick(c bool, a, b string) string {
	if c {
		return a
	}
	return b
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}
