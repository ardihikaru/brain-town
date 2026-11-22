package store

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestGithubIntegrationHelpers(t *testing.T) {
	st, _ := New(nil)
	i := st.CreateSecretIntegration("github", "GH", "", "sealed", "wxyz")
	if i.SecretEnc != "" || i.TokenHash != "" || i.Events == nil {
		t.Fatalf("public copy must hide secrets and have non-nil events: %+v", i)
	}
	if full, _ := st.Lookup(i.ID); full.SecretEnc != "sealed" || full.TokenHash != "" {
		t.Fatalf("lookup: %+v", full)
	}
	if got, good := st.CheckToken(i.ID, ""); got == nil || good {
		t.Error("bearer path must never accept a github integration")
	}
	if _, ok := st.RotateToken(i.ID); ok {
		t.Error("RotateToken must refuse github")
	}
	if !st.RotateSecret(i.ID, "sealed2", "abcd") {
		t.Fatal("rotate")
	}
	if full, _ := st.Lookup(i.ID); full.SecretEnc != "sealed2" || full.TokenHint != "abcd" {
		t.Errorf("after rotate: %+v", full)
	}
	q, _ := st.CreateIntegration("qa", "QA", "")
	if st.RotateSecret(q.ID, "x", "y") {
		t.Error("RotateSecret must refuse non-github")
	}

	if !st.ClaimDelivery(i.ID, "d1") || st.ClaimDelivery(i.ID, "d1") || !st.Seen(i.ID, "d1") {
		t.Error("ClaimDelivery must be once-only")
	}
	if got, _ := st.GetIntegration(i.ID); got.LastEventAt.IsZero() {
		t.Error("claim must update LastEventAt")
	}
	st.SetEvents(i.ID, []string{"issues"})
	if got, _ := st.GetIntegration(i.ID); !reflect.DeepEqual(got.Events, []string{"issues"}) {
		t.Errorf("events: %v", got.Events)
	}
	if st.AdoptOrg(i.ID, "acme") != "acme" || st.AdoptOrg(i.ID, "other") != "acme" {
		t.Error("AdoptOrg only fills an empty org")
	}
}

func TestBuildScriptPersistsGithubFields(t *testing.T) {
	sql, p := buildScript([]Op{{Kind: OpIntegration, Integration: &Integration{ID: "github-1", Kind: "github", SecretEnc: "sealed", Events: []string{"issues"}}}})
	if !strings.Contains(sql, "secretEnc=:p0_se") || !strings.Contains(sql, "events=:p0_ev") {
		t.Errorf("script: %s", sql)
	}
	if p["p0_se"] != "sealed" || p["p0_ev"] != `["issues"]` {
		t.Errorf("params: %v", p)
	}
}

type nopPersister struct{}

func (nopPersister) Init(context.Context) error             { return nil }
func (nopPersister) Load(context.Context) (Snapshot, error) { return Snapshot{}, nil }
func (nopPersister) Apply(context.Context, []Op) error      { return nil }

func TestAddEventDedupeCapAndPersistOnChange(t *testing.T) {
	st, err := New(nopPersister{})
	if err != nil {
		t.Fatal(err)
	}
	i := st.CreateSecretIntegration("github", "GH", "", "sealed", "wxyz")
	st.mu.Lock()
	st.ops = nil
	st.mu.Unlock()
	st.AddEvent(i.ID, "issues")
	st.AddEvent(i.ID, "issues")
	st.AddEvent(i.ID, "ping")
	st.AddEvent(i.ID, "")
	if len(st.ops) != 1 {
		t.Errorf("want 1 persisted change, got %d", len(st.ops))
	}
	if got, _ := st.GetIntegration(i.ID); !reflect.DeepEqual(got.Events, []string{"issues"}) {
		t.Errorf("events: %v", got.Events)
	}
	for n := 0; n < 100; n++ {
		st.AddEvent(i.ID, fmt.Sprintf("e%d", n))
	}
	if got, _ := st.GetIntegration(i.ID); len(got.Events) != MaxIntegrationEvents {
		t.Errorf("cap: %d", len(got.Events))
	}
}

func TestRepoStateIsDeepCopiedAndCapped(t *testing.T) {
	st, _ := New(nil)
	i := st.CreateSecretIntegration("github", "GH", "alice", "sealed", "wxyz")
	st.SetRepoHook(i.ID, "a", false, []string{"issues"})
	got, _ := st.Lookup(i.ID)
	got.Repos["a"].HookEvents[0] = "x"
	got.Repos["b"] = RepoState{Name: "b"}
	if again, _ := st.Lookup(i.ID); len(again.Repos) != 1 || again.Repos["a"].HookEvents[0] != "issues" {
		t.Error("Lookup shares repo state")
	}
	if c, _ := st.CheckToken(i.ID, ""); c == nil || len(c.Repos) != 1 {
		t.Error("CheckToken copy")
	}
	for n := 0; n < MaxRepos+20; n++ {
		st.TouchRepo(i.ID, fmt.Sprintf("r%d", n), false, "push", time.Now())
	}
	if g, _ := st.Lookup(i.ID); len(g.Repos) != MaxRepos {
		t.Errorf("repos = %d, want cap %d", len(g.Repos), MaxRepos)
	}
}

func TestAdoptOwnerTypeOnlyOnce(t *testing.T) {
	st, _ := New(nil)
	i := st.CreateSecretIntegration("github", "GH", "", "sealed", "wxyz")
	for _, c := range []struct{ in, want string }{{"", ""}, {"team", ""}, {"user", "user"}, {"organization", "user"}} {
		st.AdoptOwnerType(i.ID, c.in)
		if got, _ := st.GetIntegration(i.ID); got.OwnerType != c.want {
			t.Errorf("after %q: %q, want %q", c.in, got.OwnerType, c.want)
		}
	}
}

func TestAliasCustom(t *testing.T) {
	for _, c := range []struct {
		alias, key string
		want       bool
	}{{"gaos", "gaos", false}, {"Product A", "gaos", false}, {"Product Z", "x", false}, {"Product 093015", "x", false},
		{"Falcon", "gaos", true}, {"Product AB", "x", true}, {"Product 12345", "x", true}} {
		if got := AliasCustom(c.alias, c.key); got != c.want {
			t.Errorf("AliasCustom(%q,%q) = %v", c.alias, c.key, got)
		}
	}
}
