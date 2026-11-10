package store

import (
	"path/filepath"
	"testing"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "data", "kaoud.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestMetaAndSession(t *testing.T) {
	s := openTemp(t)
	if err := s.SetMeta("baseUrl", "https://example.test"); err != nil {
		t.Fatal(err)
	}
	if got := s.GetMeta("baseUrl"); got != "https://example.test" {
		t.Errorf("meta = %q", got)
	}
	if _, ok := s.LoadSession(); ok {
		t.Error("expected no session initially")
	}
	if err := s.SaveSession(Session{BaseURL: "x", Csrf: "c", Name: "n"}); err != nil {
		t.Fatal(err)
	}
	sess, ok := s.LoadSession()
	if !ok || sess.Csrf != "c" {
		t.Errorf("session roundtrip failed: %+v ok=%v", sess, ok)
	}
	if err := s.ClearSession(); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.LoadSession(); ok {
		t.Error("session should be cleared")
	}
}

func TestOutboxOrderAndDelete(t *testing.T) {
	s := openTemp(t)
	for _, id := range []string{"a", "b", "c"} {
		if _, err := s.Enqueue(OutboxOp{ID: id, Method: "POST", Path: "/api/x", Entity: "invoice"}); err != nil {
			t.Fatal(err)
		}
	}
	ops, err := s.OutboxList()
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 3 || ops[0].ID != "a" || ops[2].ID != "c" {
		t.Fatalf("unexpected order: %+v", ops)
	}
	if ops[0].Seq >= ops[1].Seq || ops[1].Seq >= ops[2].Seq {
		t.Errorf("seq not increasing: %v %v %v", ops[0].Seq, ops[1].Seq, ops[2].Seq)
	}
	if err := s.OutboxDelete(ops[0].Seq); err != nil {
		t.Fatal(err)
	}
	if n := s.OutboxCount(); n != 2 {
		t.Errorf("count = %d, want 2", n)
	}
}

func TestSerialBlockAllocation(t *testing.T) {
	s := openTemp(t)
	if _, err := s.AllocateSerial(); err != ErrNoNumbers {
		t.Errorf("expected ErrNoNumbers with no block, got %v", err)
	}
	if err := s.SetBlock(Block{Start: 10246, End: 10248, Next: 10246}); err != nil {
		t.Fatal(err)
	}
	if got := s.RemainingNumbers(); got != 3 {
		t.Errorf("remaining = %d, want 3", got)
	}
	want := []int{10246, 10247, 10248}
	for _, w := range want {
		got, err := s.AllocateSerial()
		if err != nil {
			t.Fatalf("alloc: %v", err)
		}
		if got != w {
			t.Errorf("alloc = %d, want %d", got, w)
		}
	}
	if _, err := s.AllocateSerial(); err != ErrNoNumbers {
		t.Errorf("expected exhausted block, got %v", err)
	}
	if got := s.RemainingNumbers(); got != 0 {
		t.Errorf("remaining after exhaust = %d", got)
	}
}
