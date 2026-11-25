package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ardihikaru/brain-town/backend/internal/consumer"
	"github.com/ardihikaru/brain-town/backend/internal/store"
)

// The consumer admin surface: a downstream reader's registration, its scope and
// its token.
//
// A consumer is created by an operator on behalf of a platform, not by the
// platform itself: the token is shown once, here, and handed over through the
// operator's own channel. GAOS never holds a Brain Town admin credential.

// consumerBody is what the create and update routes accept.
type consumerBody struct {
	Name  string         `json:"name"`
	Scope consumer.Scope `json:"scope"`
}

func (a *API) listConsumers(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"consumers": a.St.Consumers()})
}

func (a *API) createConsumer(w http.ResponseWriter, r *http.Request) {
	var b consumerBody
	if !decode(w, r, &b) {
		return
	}
	c, token, err := a.St.CreateConsumer(b.Name, b.Scope)
	if err != nil {
		if err == store.ErrConsumerName {
			fail(w, 409, "a consumer with that name already exists")
			return
		}
		fail(w, 422, err.Error())
		return
	}
	// The token is returned once and never again.
	writeJSON(w, 201, map[string]any{"consumer": c, "token": token})
}

func (a *API) updateConsumer(w http.ResponseWriter, r *http.Request) {
	var b consumerBody
	if !decode(w, r, &b) {
		return
	}
	c, err := a.St.UpdateConsumer(r.PathValue("id"), b.Name, b.Scope)
	if err != nil {
		switch err {
		case store.ErrNotFound:
			fail(w, 404, "no such consumer")
		case store.ErrConsumerName:
			fail(w, 409, "a consumer with that name already exists")
		default:
			fail(w, 422, err.Error())
		}
		return
	}
	writeJSON(w, 200, map[string]any{"consumer": c})
}

func (a *API) rotateConsumer(w http.ResponseWriter, r *http.Request) {
	token, ok := a.St.RotateConsumerToken(r.PathValue("id"))
	if !ok {
		fail(w, 404, "no such consumer")
		return
	}
	writeJSON(w, 200, map[string]any{"token": token})
}

func (a *API) deleteConsumer(w http.ResponseWriter, r *http.Request) {
	if !a.St.DeleteConsumer(r.PathValue("id")) {
		fail(w, 404, "no such consumer")
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": true})
}

// consumerEvents serves GET /consumer/events: the scoped stream a downstream
// platform reads.
//
// It is the same shape as the public /events stream -- Server-Sent Events, an
// id per frame, Last-Event-ID replay -- with two differences that matter:
//
//   - it is authenticated by the consumer's own bearer token, not by a session;
//   - it carries the stored envelope, not the public view. The town masks
//     hidden products for the public; a named machine holder that asked for a
//     repo gets the repo's real name, because the envelope was already reduced
//     at the source and the GitHub payload itself is never stored.
func (a *API) consumerEvents(w http.ResponseWriter, r *http.Request) {
	tok := bearerToken(r)
	if tok == "" {
		fail(w, 401, "a consumer token is required")
		return
	}
	c, ok := a.St.CheckConsumerToken(tok)
	if !ok {
		fail(w, 401, "the consumer token is not known")
		return
	}
	a.St.TouchConsumer(c.ID)

	fl, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := a.Hub.Subscribe() // subscribe first so nothing is lost during replay
	defer cancel()

	last, _ := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
	replay, _ := strconv.Atoi(r.URL.Query().Get("replay"))

	send := func(e store.Event) {
		if e.Delivery != store.OK {
			return
		}
		if !c.Scope.Allows(e.Kind, e.Type, e.Org, e.Product) {
			last = e.Seq
			return
		}
		b, _ := json.Marshal(consumerFrame(e))
		_, _ = w.Write([]byte("id: " + strconv.FormatInt(e.Seq, 10) + "\nevent: " + e.Type + "\ndata: " + string(b) + "\n\n"))
		last = e.Seq
	}
	_, _ = w.Write([]byte("retry: 3000\n\n"))
	if last > 0 {
		for _, e := range a.St.Events(store.Query{AfterSeq: last, Limit: 500}) {
			send(e)
		}
	} else if replay > 0 {
		q := store.Query{Newest: true, Limit: min(replay, 500), Delivery: store.OK}
		evs := a.St.Events(q)
		for i := len(evs) - 1; i >= 0; i-- {
			send(evs[i])
		}
	}
	fl.Flush()

	tick := time.NewTicker(heartbeat)
	defer tick.Stop()
	for {
		select {
		case e := <-ch:
			if e.Seq > last {
				send(e)
			}
		case <-tick.C:
			_, _ = w.Write([]byte(": heartbeat\n\n"))
		case <-r.Context().Done():
			return
		}
		fl.Flush()
	}
}

// consumerFrame is one frame of the consumer stream: the same frame the public
// stream sends, with the payload unmasked.
//
// The shape is deliberately identical to the public one -- seq, id, type,
// source, at, payload -- so a consumer reads it with the same reader and the
// same schema. The one difference is the payload: the town masks a hidden
// product for the public, and a consumer that asked for that repository by
// name gets the real name and the real title.
//
// productKey and orgLogin are the store's own answer, added because a consumer
// routes on them: they name the product and its owner whatever shape the
// sender's payload used for them.
//
// The GitHub payload itself was never stored, so there is no diff, no PR body
// and no login in the payload.
func consumerFrame(e store.Event) map[string]any {
	return map[string]any{
		"seq": e.Seq, "id": e.ID, "type": e.Type, "source": e.Kind,
		"at": e.At.UTC().Format(time.RFC3339),
		"productKey": e.Product, "orgLogin": e.Org,
		"payload": e.Raw,
	}
}

// bearerToken reads the Authorization: Bearer credential.
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}
