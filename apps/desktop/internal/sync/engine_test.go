package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/api"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/store"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "d", "k.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestPushReplaysOutboxInOrder(t *testing.T) {
	var hits int32
	var order []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		order = append(order, body["tag"].(string))
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/invoices" && r.Method == "POST" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"invoice": map[string]any{"id": "srv-1", "serial": 10246},
				"lines":   []any{},
			})
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	s := newStore(t)
	c := api.New(srv.URL)
	e := New(s, c)
	for _, tag := range []string{"a", "b"} {
		b, _ := json.Marshal(map[string]any{"tag": tag})
		if _, err := s.Enqueue(store.OutboxOp{ID: "op-" + tag, Method: "POST", Path: "/api/invoices", Entity: "invoice", EntityID: "op-" + tag, Body: b}); err != nil {
			t.Fatal(err)
		}
	}
	res, err := e.Push(context.Background())
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if res.Pushed != 2 {
		t.Errorf("pushed = %d, want 2", res.Pushed)
	}
	if len(order) != 2 || order[0] != "a" || order[1] != "b" {
		t.Errorf("order = %v, want [a b]", order)
	}
	if n := s.OutboxCount(); n != 0 {
		t.Errorf("outbox not drained: %d", n)
	}
	if _, ok := s.ResolveLocalID("op-a"); !ok {
		t.Error("expected local id mapping for op-a")
	}
}

func TestPushDropsPermanent4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"serial_not_reserved"}`))
	}))
	defer srv.Close()

	s := newStore(t)
	e := New(s, api.New(srv.URL))
	if _, err := s.Enqueue(store.OutboxOp{ID: "x", Method: "POST", Path: "/api/invoices", Entity: "invoice", EntityID: "x"}); err != nil {
		t.Fatal(err)
	}
	res, err := e.Push(context.Background())
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if res.Failed != 1 || res.Pushed != 0 {
		t.Errorf("failed=%d pushed=%d, want failed=1 pushed=0", res.Failed, res.Pushed)
	}
	if n := s.OutboxCount(); n != 0 {
		t.Errorf("permanent failure should be dropped, outbox=%d", n)
	}
}

func TestPushStopsOnTransient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"internal_error"}`))
	}))
	defer srv.Close()

	s := newStore(t)
	e := New(s, api.New(srv.URL))
	if _, err := s.Enqueue(store.OutboxOp{ID: "x", Method: "POST", Path: "/api/invoices", Entity: "invoice", EntityID: "x"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Push(context.Background()); err == nil {
		t.Fatal("expected transient error to be returned")
	}
	if n := s.OutboxCount(); n != 1 {
		t.Errorf("transient failure must stay queued, outbox=%d", n)
	}
}

func TestEnsureBlockReservesOnce(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		_ = json.NewEncoder(w).Encode(map[string]any{"deviceId": "dev-1", "start": 200, "end": 299, "next": 200})
	}))
	defer srv.Close()

	s := newStore(t)
	e := New(s, api.New(srv.URL))
	if err := e.EnsureBlock("dev-1", 100); err != nil {
		t.Fatal(err)
	}
	if err := e.EnsureBlock("dev-1", 100); err != nil {
		t.Fatal(err)
	}
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Errorf("reserve called %d times, want 1 (block still has numbers)", n)
	}
	if got := s.RemainingNumbers(); got != 100 {
		t.Errorf("remaining = %d, want 100", got)
	}
}
