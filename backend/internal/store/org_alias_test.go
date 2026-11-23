package store

import (
	"errors"
	"testing"
)

// An org that exists only because an integration references it still owns its key:
// no other org may take it as an alias, in any letter case.
func TestSetOrgAliasConflictsWithIntegrationOnlyOrg(t *testing.T) {
	st, _ := New(nil)
	st.CreateIntegration("qa", "A", "firstorg")
	st.CreateIntegration("qa", "B", "secondorg")
	for _, a := range []string{"firstorg", "FIRSTORG"} {
		_, err := st.SetOrg("secondorg", nil, ptr(a))
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("alias %q: want ErrConflict, got %v", a, err)
		}
	}
	if _, err := st.SetOrg("secondorg", nil, ptr("Second Co")); err != nil {
		t.Fatalf("free alias: %v", err)
	}
}
