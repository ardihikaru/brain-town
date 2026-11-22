package secret

import (
	"bytes"
	"testing"
)

func key(b byte) []byte { return bytes.Repeat([]byte{b}, KeySize) }

func TestRoundTrip(t *testing.T) {
	enc, err := Seal(key(1), "whsec_example")
	if err != nil {
		t.Fatal(err)
	}
	if enc == "whsec_example" {
		t.Fatal("not encrypted")
	}
	got, err := Open(key(1), enc)
	if err != nil || got != "whsec_example" {
		t.Fatalf("got %q, %v", got, err)
	}
	enc2, _ := Seal(key(1), "whsec_example")
	if enc == enc2 {
		t.Error("nonce must differ per seal")
	}
}

func TestWrongKeyAndBadInput(t *testing.T) {
	enc, _ := Seal(key(1), "x")
	if _, err := Open(key(2), enc); err == nil {
		t.Error("wrong key must fail")
	}
	if _, err := Open(key(1), "!!notbase64"); err == nil {
		t.Error("bad base64 must fail")
	}
	if _, err := Open(key(1), "AAAA"); err == nil {
		t.Error("short value must fail")
	}
	if _, err := Seal([]byte("short"), "x"); err == nil {
		t.Error("short key must fail")
	}
	if _, err := Open(nil, enc); err == nil {
		t.Error("nil key must fail")
	}
}
