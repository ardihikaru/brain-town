package store

import (
	"context"
	"time"
)

// Persister is the durable side of the store. The Store keeps the working set in memory and
// queues every change as an Op; Flush hands the queue to the Persister in order.
type Persister interface {
	Init(ctx context.Context) error
	Load(ctx context.Context) (Snapshot, error)
	Apply(ctx context.Context, ops []Op) error
}

// Snapshot is what Load returns at startup.
type Snapshot struct {
	Integrations []Integration
	Orgs         []Org
	Products     []Product
	Events       []Event // oldest first, at most the newest maxEvents
	Seen         map[string]time.Time
	Settings     *Settings
	LastSeq      int64
}

type OpKind int

const (
	OpIntegration OpKind = iota + 1 // upsert
	OpIntegrationDel
	OpOrg
	OpProduct
	OpEvent // insert, plus edges PRODUCED and ABOUT, and the sequence counter
	OpSeen
	OpSettings
	OpPrune       // delete events and dedupe keys older than Cut
	OpEventUpdate // update product and raw of an existing event (by Seq) and replace its ABOUT edge
	OpRekeyEvents // bulk column update: events of Kind with product From get product To (no raw, no edges)
	OpProductDel  // delete the product vertex Key
)

type Op struct {
	Kind        OpKind
	Integration *Integration
	Org         *Org
	Product     *Product
	Event       *Event
	Settings    *Settings
	Key         string // OpSeen key, OpIntegrationDel id, OpProductDel product key
	EventKind   string // OpRekeyEvents: the event kind to re-key
	From, To    string // OpRekeyEvents: old and new product key
	At          time.Time
	Cut         time.Time
}

const TimeFmt = "2006-01-02T15:04:05.000000000Z" // fixed width: strings sort like times
