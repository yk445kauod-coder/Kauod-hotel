// Package sync keeps the local store in step with the Cloudflare API: it pulls
// server state into the mirror and replays the local write outbox when online.
package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/api"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/store"
)

// Engine performs pull/push between the store and the API.
type Engine struct {
	Store *store.Store
	API   *api.Client
}

func New(s *store.Store, c *api.Client) *Engine { return &Engine{Store: s, API: c} }

// Pull copies server reference data and invoices into the local mirror.
func (e *Engine) Pull(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s, err := e.API.Settings(); err == nil {
		_ = e.Store.PutSettings(s)
	}
	if inv, err := e.API.Invoices("limit=200&sort=serial&dir=desc"); err == nil {
		// Keep locally-created invoices that have not reached the server yet.
		pending := map[string]bool{}
		ops, _ := e.Store.OutboxList()
		for _, op := range ops {
			if op.Entity == "invoice" {
				pending[op.EntityID] = true
			}
		}
		local, _ := e.Store.Invoices()
		merged := inv.Invoices
		for _, l := range local {
			if pending[l.ID] {
				merged = append(merged, l)
			}
		}
		_ = e.Store.ReplaceInvoices(merged)
	}
	if r, err := e.API.Rooms(); err == nil {
		_ = e.Store.ReplaceRooms(r.Rooms)
	}
	if g, err := e.API.Guests(); err == nil {
		_ = e.Store.ReplaceGuests(g.Guests)
	}
	if u, err := e.API.Users(); err == nil {
		_ = e.Store.ReplaceUsers(u.Users)
	}
	return nil
}

// PushResult summarises a push run.
type PushResult struct {
	Pushed int
	Failed int
	Errors []string
}

// Push replays the outbox in order. A failed op stays queued unless the server
// rejects it permanently (4xx), in which case it is dropped and reported.
func (e *Engine) Push(ctx context.Context) (PushResult, error) {
	var res PushResult
	ops, err := e.Store.OutboxList()
	if err != nil {
		return res, err
	}
	for _, op := range ops {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		if err := e.apply(op); err != nil {
			var ae *api.APIError
			if errors.As(err, &ae) && ae.Status >= 400 && ae.Status < 500 {
				// Permanent rejection: drop so the queue does not stall forever.
				_ = e.Store.OutboxDelete(op.Seq)
				res.Failed++
				res.Errors = append(res.Errors, fmt.Sprintf("%s %s: %s", op.Method, op.Path, ae.Code))
				continue
			}
			// Transient (offline/5xx): stop and retry next time.
			return res, err
		}
		_ = e.Store.OutboxDelete(op.Seq)
		res.Pushed++
	}
	return res, nil
}

func (e *Engine) apply(op store.OutboxOp) error {
	var out json.RawMessage
	if err := e.API.DoRaw(op.Method, op.Path, op.Body, &out); err != nil {
		return err
	}
	if op.Entity == "invoice" && strings.Contains(op.Path, "/api/invoices") && op.Method == "POST" {
		var resp model.InvoiceResponse
		if json.Unmarshal(out, &resp) == nil && resp.Invoice.ID != "" {
			_ = e.Store.SetLocalID(op.EntityID, resp.Invoice.ID)
			_ = e.Store.PutInvoice(resp.Invoice)
			_ = e.Store.PutLines(resp.Invoice.ID, resp.Lines)
		}
	}
	return nil
}

// Sync pulls then pushes.
func (e *Engine) Sync(ctx context.Context) (PushResult, error) {
	if err := e.Pull(ctx); err != nil {
		return PushResult{}, err
	}
	return e.Push(ctx)
}

// EnsureBlock makes sure the device has reserved numbers, reserving `size`
// more when the current block is exhausted.
func (e *Engine) EnsureBlock(deviceID string, size int) error {
	if e.Store.RemainingNumbers() > 0 {
		return nil
	}
	resp, err := e.API.ReserveSerials(deviceID, size)
	if err != nil {
		return err
	}
	return e.Store.SetBlock(store.Block{Start: resp.Start, End: resp.End, Next: resp.Next})
}

// DeviceID returns this install's stable device id, creating it on first use.
func (e *Engine) DeviceID() string {
	if id := e.Store.GetMeta("deviceId"); id != "" {
		return id
	}
	id := "dev-" + shortID()
	_ = e.Store.SetMeta("deviceId", id)
	return id
}
