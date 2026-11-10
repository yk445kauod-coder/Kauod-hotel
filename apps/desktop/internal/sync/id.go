package sync

import "crypto/rand"

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// shortID returns an 8-char random id used for device identity.
func shortID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}
