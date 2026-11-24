package store

import (
	"log"
	"slices"
	"sort"

	"github.com/ardihikaru/brain-town/backend/internal/animora"
)

const migrateTag = "store: migrate animora product: "

// migrateAnimoraProduct moves the Animora video product from the key "animora", which it shared with a GitHub
// repository of the same name, to animora.Product. It runs at the end of New, under the store lock, and is
// idempotent by state: it looks for work in the loaded data and does nothing when there is none, so it needs no
// version marker and a crash half way is finished by the next start.
//
// What it changes: Animora events get the new product (column and raw), the new product is created (inheriting
// visibility from the old one only where the old one was purely the video product, so nothing the owner hid is
// ever unmasked), and the Animora source leaves the old product, which is deleted when nothing else uses it.
// Seen keys are integration + event id and do not contain the product, so dedupe is unaffected.
func (st *Store) migrateAnimoraProduct() {
	oldKey, newKey := animora.LegacyProduct, animora.Product
	var done bool
	logf := func(format string, a ...any) { done = true; log.Printf(migrateTag+format, a...) }

	// (a) re-key the events (this also finds events a crashed run already re-keyed in raw only, or the reverse)
	var rekeyed []Event
	for i := range st.s.Events {
		e := &st.s.Events[i]
		if e.Kind != "animora" {
			continue
		}
		rawOld := false
		if s, ok := e.Raw["product"].(string); ok && s == oldKey {
			rawOld = true
		}
		if e.Product != oldKey && !rawOld {
			continue
		}
		e.Product = newKey
		raw := make(map[string]any, len(e.Raw)+1)
		for k, v := range e.Raw {
			raw[k] = v
		}
		raw["product"] = newKey
		e.Raw = raw
		rekeyed = append(rekeyed, *e)
	}

	// evidence and org
	var animInts []Integration
	for _, g := range st.s.Integrations {
		if g.Kind == "animora" {
			animInts = append(animInts, *g)
		}
	}
	sort.Slice(animInts, func(a, b int) bool { return animInts[a].ID < animInts[b].ID })
	old := st.s.Products[oldKey]
	oldHasAnimora := old != nil && slices.Contains(old.Sources, "Animora")
	oldHasGitHub := old != nil && slices.Contains(old.Sources, "GitHub")

	if len(rekeyed) > 0 {
		logf("re-keyed %d event(s) from %q to %q", len(rekeyed), oldKey, newKey)
	}

	// (b) the new product
	var qOrgs []*Org
	var newProd *Product
	if _, exists := st.s.Products[newKey]; !exists && (len(rekeyed) > 0 || len(animInts) > 0 || oldHasAnimora) {
		org := ""
		for _, e := range st.s.Events {
			if e.Kind == "animora" && e.Product == newKey && e.Org != "" {
				org = e.Org
				break
			}
		}
		for i := 0; org == "" && i < len(animInts); i++ {
			org = animInts[i].Org
		}
		p := &Product{Key: newKey, Org: org, Name: animora.Name, Visibility: Public, Alias: newKey, Hall: defaultHall("animora"), Sources: []string{"Animora"}}
		if old != nil && !oldHasGitHub { // purely the video product: keep what the owner chose for it
			p.Visibility, p.Alias = old.Visibility, old.Alias
			if old.Hall != "" {
				p.Hall = old.Hall
			}
		}
		if org != "" {
			if _, ok := st.s.Orgs[org]; !ok {
				o := &Org{Key: org, Visibility: Public, Alias: org}
				st.s.Orgs[org] = o
				qOrgs = append(qOrgs, o)
			}
		}
		st.s.Products[newKey] = p
		newProd = p
		logf("created product %q (visibility %s, org %q)", newKey, p.Visibility, p.Org)
	}

	// (c) the old product
	var oldDel, oldUpd bool
	if oldHasAnimora {
		old.Sources = slices.DeleteFunc(slices.Clone(old.Sources), func(s string) bool { return s == "Animora" })
		logf("removed source Animora from product %q", oldKey)
		oldUpd = true
		if len(old.Sources) == 0 {
			delete(st.s.Products, oldKey)
			logf("deleted product %q (no sources left)", oldKey)
			oldDel, oldUpd = true, false
		} else if old.Hall == defaultHall("animora") {
			old.Hall = defaultHall("github")
			logf("reset hall of product %q to GitHub Valley hall", oldKey)
		}
	}

	if !done {
		log.Print(migrateTag + "nothing to do")
		return
	}

	// queue: new product (its org first, so the BELONGS_TO edge has a target), event updates, bulk, old product
	for _, o := range qOrgs {
		st.qOrg(o)
	}
	if newProd != nil {
		st.qProduct(newProd)
	}
	for i := range rekeyed {
		e := rekeyed[i]
		st.q(Op{Kind: OpEventUpdate, Event: &e})
	}
	if len(rekeyed) > 0 {
		st.q(Op{Kind: OpRekeyEvents, EventKind: "animora", From: oldKey, To: newKey})
	}
	if oldDel {
		st.q(Op{Kind: OpProductDel, Key: oldKey})
	} else if oldUpd {
		st.qProduct(old)
	}
}
