package config

import "testing"

func TestAdminEmailMustBeAnAddress(t *testing.T) {
	for email, ok := range map[string]bool{"me@mfardiansyah.id": true, "adminardi": false, "@x.id": false, "me@": false} {
		t.Setenv("ADMIN_EMAIL", email)
		t.Setenv("ADMIN_PASSWORD", "x")
		if _, err := Load(); (err == nil) != ok {
			t.Errorf("ADMIN_EMAIL=%q: err=%v, want ok=%v", email, err, ok)
		}
	}
}
