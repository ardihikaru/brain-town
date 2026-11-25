// Package consumer holds the downstream reader credential: a scoped, revocable
// machine token that may read the event stream.
//
// A consumer is not an integration. An integration is an input — a webhook the
// town accepts; a consumer is an output — a platform that reads what the town
// saw. The two are kept apart so that revoking a reader never touches an input,
// and so a reader never inherits the input's own credential.
//
// The stream a consumer reads carries the stored event envelope, not the source
// payload: the GitHub payload is never stored, so a consumer gets the product
// key, the owner, the task id, the task title and the small data map, and
// nothing else. What the town masks for the public it does not mask here,
// because the consumer is a named machine holder and the envelope was already
// reduced at the source.
package consumer

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

// TokenPrefix marks a consumer token. It is distinct from the bt_live_ prefix
// an integration uses, so one can never be presented as the other.
const TokenPrefix = "bt_c_"

// MaxScopeEntries caps one scope dimension. A scope is a hand-written
// declaration; a list of ten thousand repos is a mistake, not a need.
const MaxScopeEntries = 64

// MaxNameLen is the longest a consumer name may be.
const MaxNameLen = 64

// Scope is what a consumer asked for. An empty dimension matches everything
// within it; the dimensions are ANDed.
type Scope struct {
	Owners []string `json:"owners"` // owner logins: "developersismedika"
	Repos  []string `json:"repos"`  // bare repo names: "his-v3-ai"
	Types  []string `json:"types"`  // town event types: "pr.opened"
	Kinds  []string `json:"kinds"`  // event kinds: "github"
}

// Consumer is one scoped reader.
type Consumer struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	TokenHash  string    `json:"-"`
	TokenHint  string    `json:"tokenHint"`
	Scope      Scope     `json:"scope"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// Public returns a copy that is safe to hand out: no token hash.
func (c Consumer) Public() Consumer {
	c.TokenHash = ""
	return c
}

// Clone deep-copies the scope so a caller cannot mutate stored state.
func (c Consumer) Clone() Consumer {
	c.Scope = c.Scope.Clone()
	return c
}

// Clone deep-copies every list of the scope.
func (s Scope) Clone() Scope {
	return Scope{
		Owners: append([]string(nil), s.Owners...),
		Repos:  append([]string(nil), s.Repos...),
		Types:  append([]string(nil), s.Types...),
		Kinds:  append([]string(nil), s.Kinds...),
	}
}

// Normalize trims, lower-cases and de-duplicates a scope, and caps each
// dimension. Owners and repos are case-insensitive in GitHub, so they are
// compared in lower case; types and kinds are town vocabulary and are compared
// exactly, but stored trimmed.
func (s Scope) Normalize() Scope {
	out := Scope{
		Owners: normList(s.Owners, true),
		Repos:  normList(s.Repos, true),
		Types:  normList(s.Types, false),
		Kinds:  normList(s.Kinds, false),
	}
	return out
}

func normList(in []string, lower bool) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if lower {
			v = strings.ToLower(v)
		}
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
		if len(out) >= MaxScopeEntries {
			break
		}
	}
	sort.Strings(out)
	return out
}

// Allows reports whether an event is inside the scope. An empty dimension
// matches everything within it. The repo is the product key, which for a
// GitHub event is the bare repository name.
func (s Scope) Allows(kind, typ, org, repo string) bool {
	if len(s.Kinds) > 0 && !contains(s.Kinds, kind) {
		return false
	}
	if len(s.Types) > 0 && !contains(s.Types, typ) {
		return false
	}
	if len(s.Owners) > 0 {
		if org == "" || !containsFold(s.Owners, org) {
			return false
		}
	}
	if len(s.Repos) > 0 {
		if repo == "" || !containsFold(s.Repos, repo) {
			return false
		}
	}
	return true
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func containsFold(list []string, v string) bool {
	for _, x := range list {
		if strings.EqualFold(x, v) {
			return true
		}
	}
	return false
}

// ValidateName refuses a name that would be ambiguous in the back office.
func ValidateName(name string) error {
	name = strings.TrimSpace(name)
	switch {
	case len(name) < 2:
		return fmt.Errorf("a consumer name needs at least 2 characters")
	case len(name) > MaxNameLen:
		return fmt.Errorf("a consumer name holds at most %d characters", MaxNameLen)
	}
	return nil
}

// NewToken mints a consumer token. The plaintext is returned once; only the
// hash is kept.
func NewToken() (plain, hash, hint string) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	plain = TokenPrefix + hex.EncodeToString(b)
	return plain, HashToken(plain), plain[len(plain)-4:]
}

// HashToken is the stored form of a token.
func HashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// Verify compares a presented token with a stored hash in constant time.
func Verify(hash, token string) bool {
	if hash == "" || token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hash), []byte(HashToken(token))) == 1
}
