// Package ratelimit is the per-integration token bucket shared by the ingest handlers.
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter allows rate events per second sustained, with bursts up to burst, per id.
type Limiter struct {
	rate, burst float64
	mu          sync.Mutex
	buckets     map[string]*bucket
}

// New builds a limiter; non-positive values fall back to 50/s, burst 200.
func New(rate, burst float64) *Limiter {
	if rate <= 0 {
		rate = 50
	}
	if burst <= 0 {
		burst = 200
	}
	return &Limiter{rate: rate, burst: burst, buckets: map[string]*bucket{}}
}

// Allow takes one token for id and reports whether one was available.
func (l *Limiter) Allow(id string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.buckets[id]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[id] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
