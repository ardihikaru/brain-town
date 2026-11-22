// Package hub fans accepted events out to connected SSE clients.
package hub

import (
	"sync"

	"github.com/ardihikaru/brain-town/backend/internal/store"
)

type Hub struct {
	mu   sync.Mutex
	subs map[chan store.Event]struct{}
}

func New() *Hub { return &Hub{subs: map[chan store.Event]struct{}{}} }

func (h *Hub) Subscribe() (<-chan store.Event, func()) {
	ch := make(chan store.Event, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() { h.mu.Lock(); delete(h.subs, ch); h.mu.Unlock() }
}

// Publish never blocks: a client that cannot keep up misses live events and can
// catch up with Last-Event-ID on reconnect.
func (h *Hub) Publish(ev store.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}
