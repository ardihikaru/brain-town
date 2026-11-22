package store

import (
	"reflect"
	"strings"
	"testing"
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
