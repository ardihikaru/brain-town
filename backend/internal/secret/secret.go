// Package secret seals short secrets (GitHub webhook secrets) with AES-256-GCM.
// The sealed form is base64(nonce || ciphertext).
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
)

// KeySize is the required key length in bytes (AES-256).
const KeySize = 32

var ErrKey = errors.New("secret: key must be 32 bytes")

func gcm(key []byte) (cipher.AEAD, error) {
	if len(key) != KeySize {
		return nil, ErrKey
	}
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

// Seal encrypts plain with a fresh random nonce.
func Seal(key []byte, plain string) (string, error) {
	g, err := gcm(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(g.Seal(nonce, nonce, []byte(plain), nil)), nil
}

// Open reverses Seal. It fails for a wrong key or a tampered value.
func Open(key []byte, sealed string) (string, error) {
	g, err := gcm(key)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	if len(raw) < g.NonceSize()+g.Overhead() {
		return "", errors.New("secret: sealed value too short")
	}
	out, err := g.Open(nil, raw[:g.NonceSize()], raw[g.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
