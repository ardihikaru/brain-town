package consumer

import "testing"

func TestScopeAllows(t *testing.T) {
	cases := []struct {
		name  string
		scope Scope
		kind  string
		typ   string
		org   string
		repo  string
		want  bool
	}{
		{"empty scope allows everything", Scope{}, "github", "pr.opened", "org", "repo", true},
		{"kind matches", Scope{Kinds: []string{"github"}}, "github", "pr.opened", "org", "repo", true},
		{"kind does not match", Scope{Kinds: []string{"qa"}}, "github", "pr.opened", "org", "repo", false},
		{"type matches", Scope{Types: []string{"pr.opened"}}, "github", "pr.opened", "org", "repo", true},
		{"type does not match", Scope{Types: []string{"pr.merged"}}, "github", "pr.opened", "org", "repo", false},
		{"owner matches", Scope{Owners: []string{"developersismedika"}}, "github", "pr.opened", "developersismedika", "repo", true},
		{"owner is case-insensitive", Scope{Owners: []string{"DeveloperSismedika"}}, "github", "pr.opened", "developersismedika", "repo", true},
		{"owner does not match", Scope{Owners: []string{"someone-else"}}, "github", "pr.opened", "developersismedika", "repo", false},
		{"an empty org cannot satisfy an owner filter", Scope{Owners: []string{"developersismedika"}}, "github", "pr.opened", "", "repo", false},
		{"repo matches", Scope{Repos: []string{"his-v3-ai"}}, "github", "pr.opened", "org", "his-v3-ai", true},
		{"repo does not match", Scope{Repos: []string{"his-v3-ai"}}, "github", "pr.opened", "org", "crm-backend", false},
		{"an empty repo cannot satisfy a repo filter", Scope{Repos: []string{"his-v3-ai"}}, "github", "pr.opened", "org", "", false},
		{"all four filters are ANDed", Scope{
			Kinds: []string{"github"}, Types: []string{"pr.merged"},
			Owners: []string{"developersismedika"}, Repos: []string{"his-v3-ai"},
		}, "github", "pr.merged", "developersismedika", "his-v3-ai", true},
		{"one mismatch is enough to refuse", Scope{
			Kinds: []string{"github"}, Types: []string{"pr.merged"},
			Owners: []string{"developersismedika"}, Repos: []string{"his-v3-ai"},
		}, "github", "pr.merged", "developersismedika", "crm-backend", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.scope.Allows(c.kind, c.typ, c.org, c.repo); got != c.want {
				t.Errorf("Allows = %v, want %v", got, c.want)
			}
		})
	}
}

func TestScopeNormalize(t *testing.T) {
	s := Scope{
		Owners: []string{" Developersismedika ", "developersismedika", ""},
		Repos:  []string{"His-V3-AI", "his-v3-ai"},
		Types:  []string{"pr.opened", "pr.opened", "pr.merged"},
		Kinds:  []string{"github"},
	}.Normalize()
	if len(s.Owners) != 1 || s.Owners[0] != "developersismedika" {
		t.Errorf("owners = %v", s.Owners)
	}
	if len(s.Repos) != 1 || s.Repos[0] != "his-v3-ai" {
		t.Errorf("repos = %v", s.Repos)
	}
	if len(s.Types) != 2 {
		t.Errorf("types = %v", s.Types)
	}
	if len(s.Kinds) != 1 {
		t.Errorf("kinds = %v", s.Kinds)
	}
}

func TestScopeNormalizeCapsEachDimension(t *testing.T) {
	many := make([]string, MaxScopeEntries+20)
	for i := range many {
		many[i] = string(rune('a'+i%26)) + string(rune('a'+i/26))
	}
	s := Scope{Repos: many}.Normalize()
	if len(s.Repos) != MaxScopeEntries {
		t.Errorf("repos = %d, want %d", len(s.Repos), MaxScopeEntries)
	}
}

func TestTokenRoundTrip(t *testing.T) {
	plain, hash, hint := NewToken()
	if plain[:len(TokenPrefix)] != TokenPrefix {
		t.Fatalf("token %q must carry the prefix %q", plain, TokenPrefix)
	}
	if hint != plain[len(plain)-4:] {
		t.Errorf("hint %q must be the last four of the token", hint)
	}
	if !Verify(hash, plain) {
		t.Error("the minted token must verify against its hash")
	}
	if Verify(hash, plain+"x") {
		t.Error("a wrong token must not verify")
	}
	if Verify("", plain) {
		t.Error("an empty hash must never verify")
	}
	if Verify(hash, "") {
		t.Error("an empty token must never verify")
	}
}

func TestValidateName(t *testing.T) {
	if err := ValidateName("gaos"); err != nil {
		t.Errorf("a good name must pass: %v", err)
	}
	if err := ValidateName("a"); err == nil {
		t.Error("a one-character name must be refused")
	}
	long := make([]byte, MaxNameLen+1)
	for i := range long {
		long[i] = 'x'
	}
	if err := ValidateName(string(long)); err == nil {
		t.Error("an over-long name must be refused")
	}
}

func TestPublicHidesTheHash(t *testing.T) {
	c := Consumer{ID: "btc-1", Name: "gaos", TokenHash: "secret-hash"}
	if c.Public().TokenHash != "" {
		t.Error("the public copy must not carry the token hash")
	}
}
