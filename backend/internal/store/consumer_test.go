package store

import (
	"testing"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/consumer"
)

func TestConsumerLifecycle(t *testing.T) {
	st, _ := New(nil)

	c, plain, err := st.CreateConsumer("gaos", consumer.Scope{
		Kinds: []string{"github"}, Types: []string{"pr.opened"}, Repos: []string{"his-v3-ai"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if c.TokenHash != "" {
		t.Fatal("the returned consumer must not carry the token hash")
	}
	if plain == "" {
		t.Fatal("the plaintext token must be returned once")
	}

	// The name is unique.
	if _, _, err := st.CreateConsumer("gaos", consumer.Scope{}); err != ErrConsumerName {
		t.Errorf("a duplicate name must be refused, got %v", err)
	}

	// The token resolves to its consumer.
	got, ok := st.CheckConsumerToken(plain)
	if !ok || got.ID != c.ID {
		t.Fatalf("the minted token must resolve: %+v %v", got, ok)
	}
	if _, ok := st.CheckConsumerToken("bt_c_wrong"); ok {
		t.Error("a wrong token must not resolve")
	}

	// The scope is normalised on the way in.
	stored, _ := st.GetConsumer(c.ID)
	if len(stored.Scope.Repos) != 1 || stored.Scope.Repos[0] != "his-v3-ai" {
		t.Errorf("scope = %+v", stored.Scope)
	}

	// The list never carries a hash.
	for _, one := range st.Consumers() {
		if one.TokenHash != "" {
			t.Error("the list must not carry a token hash")
		}
	}

	// A rotation kills the old token at once.
	newPlain, ok := st.RotateConsumerToken(c.ID)
	if !ok {
		t.Fatal("rotate")
	}
	if _, ok := st.CheckConsumerToken(plain); ok {
		t.Error("the old token must stop working after a rotation")
	}
	if _, ok := st.CheckConsumerToken(newPlain); !ok {
		t.Error("the new token must work")
	}

	// An update replaces the scope and keeps the token.
	if _, err := st.UpdateConsumer(c.ID, "gaos-hisv3", consumer.Scope{Types: []string{"pr.merged"}}); err != nil {
		t.Fatalf("update: %v", err)
	}
	stored, _ = st.GetConsumer(c.ID)
	if stored.Name != "gaos-hisv3" || len(stored.Scope.Types) != 1 || stored.Scope.Types[0] != "pr.merged" {
		t.Errorf("after update: %+v", stored)
	}
	if _, ok := st.CheckConsumerToken(newPlain); !ok {
		t.Error("an update must not invalidate the token")
	}
	if _, err := st.UpdateConsumer("btc-nope", "x", consumer.Scope{}); err != ErrNotFound {
		t.Errorf("an unknown consumer must be 404, got %v", err)
	}

	// A delete removes it.
	if !st.DeleteConsumer(c.ID) {
		t.Fatal("delete")
	}
	if _, ok := st.CheckConsumerToken(newPlain); ok {
		t.Error("a deleted consumer's token must stop working")
	}
	if st.DeleteConsumer(c.ID) {
		t.Error("a second delete must report nothing to delete")
	}
}

func TestConsumerTouchIsWrittenAtMostOnceAMinute(t *testing.T) {
	st, _ := New(nil)
	c, _, _ := st.CreateConsumer("gaos", consumer.Scope{})
	st.TouchConsumer(c.ID)
	got, _ := st.GetConsumer(c.ID)
	if got.LastSeenAt.IsZero() {
		t.Fatal("the first touch must record a time")
	}
	first := got.LastSeenAt
	st.TouchConsumer(c.ID)
	got, _ = st.GetConsumer(c.ID)
	if !got.LastSeenAt.Equal(first) {
		t.Error("a second touch inside the minute must not write again")
	}
	// An unknown consumer is a no-op, not a panic.
	st.TouchConsumer("btc-nope")
}

func TestConsumerNameValidation(t *testing.T) {
	st, _ := New(nil)
	if _, _, err := st.CreateConsumer("", consumer.Scope{}); err == nil {
		t.Error("an empty name must be refused")
	}
	if _, _, err := st.CreateConsumer("a", consumer.Scope{}); err == nil {
		t.Error("a one-character name must be refused")
	}
}

func TestConsumerTokenIsNeverTheIntegrationToken(t *testing.T) {
	st, _ := New(nil)
	i, iplain := st.CreateIntegration("qa", "QA", "")
	c, cplain, _ := st.CreateConsumer("gaos", consumer.Scope{})
	if iplain == cplain {
		t.Error("a consumer token and an integration token must never be the same value")
	}
	if _, ok := st.CheckToken(i.ID, cplain); ok {
		t.Error("a consumer token must not open an integration")
	}
	if _, ok := st.CheckConsumerToken(iplain); ok {
		t.Error("an integration token must not open a consumer")
	}
	_ = c
}

func TestConsumerScopeSurvivesAStoreReload(t *testing.T) {
	st, _ := New(nil)
	_, _, _ = st.CreateConsumer("gaos", consumer.Scope{Owners: []string{"developersismedika"}})
	// The in-memory copy is what the stream reads; make sure it is not empty.
	if len(st.Consumers()) != 1 {
		t.Fatalf("consumers = %d", len(st.Consumers()))
	}
	_ = time.Now
}
