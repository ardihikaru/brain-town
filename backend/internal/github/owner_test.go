package github

import (
	"reflect"
	"testing"
)

func userRepo(name string, private bool) M {
	return M{"name": name, "private": private, "owner": M{"login": "alice", "type": "User"}}
}

func repoPing(name string, private bool, events ...any) M {
	return M{"hook": M{"events": events}, "repository": userRepo(name, private)}
}

func TestOwnerTypeAdoptedOnceFromPayloads(t *testing.T) {
	cases := []struct {
		name    string
		event   string
		payload M
		want    string
	}{
		{"user repo ping", "ping", repoPing("a", false, "issues"), "user"},
		{"org ping without repository", "ping", M{"hook": M{"events": []any{"issues"}}, "organization": M{"login": "Acme"}}, "organization"},
		{"organization object wins over owner type", "issues", M{"action": "opened", "issue": issue(1, "t", nil),
			"repository": userRepo("a", false), "organization": M{"login": "alice"}}, "organization"},
		{"owner type Organization", "issues", M{"action": "opened", "issue": issue(1, "t", nil),
			"repository": M{"name": "a", "owner": M{"login": "x", "type": "Organization"}}}, "organization"},
		{"grouped event from a user repo", "issues", M{"action": "assigned", "issue": issue(1, "t", nil), "repository": userRepo("a", false)}, "user"},
		{"payload without a type", "issues", M{"action": "opened", "issue": issue(1, "t", nil), "repository": repo("a", false)}, ""},
	}
	for _, c := range cases {
		e := newEnv(t, "")
		if code, m := e.send(c.event, "d1", c.payload); code != 202 {
			t.Fatalf("%s: %d %v", c.name, code, m)
		}
		if got, _ := e.st.GetIntegration(e.id); got.OwnerType != c.want {
			t.Errorf("%s: ownerType = %q, want %q", c.name, got.OwnerType, c.want)
		}
	}

	// Never overwritten once set.
	e := newEnv(t, "")
	e.ok("ping", repoPing("a", false, "issues"))
	e.ok("ping", M{"hook": M{"events": []any{"issues"}}, "organization": M{"login": "alice"}})
	if got, _ := e.st.GetIntegration(e.id); got.OwnerType != "user" {
		t.Errorf("overwritten: %q", got.OwnerType)
	}
}

func TestRepoPingsKeepPerRepoEventsAndUnion(t *testing.T) {
	e := newEnv(t, "")
	e.ok("ping", repoPing("alpha", false, "issues", "pull_request"))
	e.ok("ping", repoPing("beta", true, "issues", "push", "workflow_run"))
	got, _ := e.st.GetIntegration(e.id)
	if !reflect.DeepEqual(got.Repos["alpha"].HookEvents, []string{"issues", "pull_request"}) {
		t.Errorf("alpha events: %v", got.Repos["alpha"].HookEvents)
	}
	if b := got.Repos["beta"]; !b.Private || !reflect.DeepEqual(b.HookEvents, []string{"issues", "push", "workflow_run"}) {
		t.Errorf("beta: %+v", b)
	}
	if want := []string{"issues", "pull_request", "push", "workflow_run"}; !reflect.DeepEqual(got.Events, want) {
		t.Errorf("union = %v, want %v", got.Events, want)
	}
	// A repo ping registers the product (hidden when private) but adds nothing to the town.
	if p, ok := e.st.GetProduct("alpha"); !ok || p.Visibility != "public" {
		t.Errorf("alpha product: %+v %v", p, ok)
	}
	if p, ok := e.st.GetProduct("beta"); !ok || p.Visibility != "hidden" || p.Alias == "beta" {
		t.Errorf("beta product: %+v %v", p, ok)
	}
	for _, ev := range e.events("ping") {
		if ev.Product != "" {
			t.Errorf("ping event carries product %q", ev.Product)
		}
	}
	// A new ping for the same repo replaces its list; the union follows.
	e.ok("ping", repoPing("beta", true, "issues"))
	got, _ = e.st.GetIntegration(e.id)
	if want := []string{"issues", "pull_request"}; !reflect.DeepEqual(got.Events, want) {
		t.Errorf("union after re-ping = %v, want %v", got.Events, want)
	}
	// An org-level ping (no repository) still sets the integration list directly.
	e2 := newEnv(t, "")
	e2.ok("ping", M{"hook": M{"events": []any{"issues", "push"}}, "organization": M{"login": "Acme"}})
	if g, _ := e2.st.GetIntegration(e2.id); !reflect.DeepEqual(g.Events, []string{"issues", "push"}) || len(g.Repos) != 0 {
		t.Errorf("org ping: %v %v", g.Events, g.Repos)
	}
}

func TestDeliveryUpdatesRepoState(t *testing.T) {
	e := newEnv(t, "")
	before := e.clk.Now()
	e.ok("issues", M{"action": "opened", "issue": issue(1, "t", nil), "repository": userRepo("alpha", true)})
	got, _ := e.st.GetIntegration(e.id)
	r := got.Repos["alpha"]
	if !r.LastEventAt.Equal(before) || !r.Private || !reflect.DeepEqual(r.HookEvents, []string{"issues"}) {
		t.Errorf("repo state: %+v", r)
	}
	if !reflect.DeepEqual(got.Events, []string{"issues"}) {
		t.Errorf("integration events: %v", got.Events)
	}
	// Mutating a returned copy never reaches the store.
	got.Repos["alpha"].HookEvents[0] = "x"
	delete(got.Repos, "alpha")
	again, _ := e.st.GetIntegration(e.id)
	if len(again.Repos) != 1 || again.Repos["alpha"].HookEvents[0] != "issues" {
		t.Error("repo state shared with a caller")
	}
}

func TestTranslateUsesTheReposOwnEvents(t *testing.T) {
	check := func(repoName string) M {
		return M{"action": "completed", "repository": userRepo(repoName, false), "check_run": M{"name": "build", "conclusion": "success",
			"check_suite": M{"app": M{"slug": "github-actions"}}, "pull_requests": []any{M{"number": 4}}}}
	}
	e := newEnv(t, "")
	e.ok("ping", repoPing("ci", false, "issues", "workflow_run"))
	e.ok("ping", repoPing("plain", false, "issues", "check_run"))
	// The integration list is now the union (it has workflow_run), but "plain" does not subscribe to it.
	if c, m := e.send("check_run", "c1", check("ci")); c != 202 || m["status"] != "skipped" {
		t.Errorf("ci repo: %d %v", c, m)
	}
	if c, m := e.send("check_run", "c2", check("plain")); c != 202 || m["status"] != "accepted" {
		t.Errorf("plain repo: %d %v", c, m)
	}
	// A repo with no ping yet falls back to the integration's events.
	if c, m := e.send("check_run", "c3", check("unknown")); c != 202 || m["status"] != "skipped" {
		t.Errorf("unknown repo: %d %v", c, m)
	}
}

func TestRejectedDeliveryIsCountedPerRepoAndNeverRegistered(t *testing.T) {
	e := newEnv(t, "acme")
	p := M{"action": "opened", "issue": issue(1, "secret title", nil), "repository": userRepo("elsewhere", true), "organization": M{"login": "Other"}}
	if c, _ := e.send("issues", "r1", p); c != 422 {
		t.Fatalf("want 422, got %d", c)
	}
	rej := e.rejected()
	if len(rej) != 1 || rej[0].Product != "elsewhere" {
		t.Fatalf("rejected: %+v", rej)
	}
	got, _ := e.st.GetIntegration(e.id)
	if got.Repos["elsewhere"].LastRejectedAt.IsZero() {
		t.Error("repo LastRejectedAt not set")
	}
	if _, ok := e.st.GetProduct("elsewhere"); ok {
		t.Error("a rejected delivery registered a product")
	}
}
