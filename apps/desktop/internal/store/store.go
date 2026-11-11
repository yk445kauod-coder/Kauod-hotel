// Package store is the local, offline-first data store (bbolt). It mirrors the
// server rows, keeps a write outbox for replay, and holds reserved number
// blocks so invoices can be numbered while offline without ever colliding.
package store

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	bolt "go.etcd.io/bbolt"
)

var (
	bMeta     = []byte("meta")
	bSession  = []byte("session")
	bInvoices = []byte("invoices")
	bLines    = []byte("lines")
	bPayments = []byte("payments")
	bSettings = []byte("settings")
	bRooms    = []byte("rooms")
	bGuests   = []byte("guests")
	bUsers    = []byte("users")
	bOutbox   = []byte("outbox")
	bBlocks   = []byte("blocks")
	bLocalIDs = []byte("localids")
)

var allBuckets = [][]byte{bMeta, bSession, bInvoices, bLines, bPayments, bSettings, bRooms, bGuests, bUsers, bOutbox, bBlocks, bLocalIDs}

// ErrNoNumbers is returned when the device has no reserved serial left.
var ErrNoNumbers = errors.New("no reserved serial numbers left")

// OutboxOp is one queued write to replay against the API.
type OutboxOp struct {
	Seq       uint64          `json:"seq"`
	ID        string          `json:"id"`
	Method    string          `json:"method"`
	Path      string          `json:"path"`
	Body      json.RawMessage `json:"body,omitempty"`
	Entity    string          `json:"entity"`
	EntityID  string          `json:"entityId"`
	CreatedAt string          `json:"createdAt"`
}

// Block is a range of serial numbers reserved from the server.
type Block struct {
	Start int `json:"start"`
	End   int `json:"end"`
	Next  int `json:"next"`
}

type Store struct {
	db *bolt.DB
}

// Open opens (or creates) the store at path and ensures all buckets exist.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: 3 * time.Second})
	if err != nil {
		return nil, err
	}
	err = db.Update(func(tx *bolt.Tx) error {
		for _, b := range allBuckets {
			if _, e := tx.CreateBucketIfNotExists(b); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) put(bucket []byte, key string, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(bucket).Put([]byte(key), data)
	})
}

func (s *Store) get(bucket []byte, key string, out interface{}) (bool, error) {
	var found bool
	err := s.db.View(func(tx *bolt.Tx) error {
		v := tx.Bucket(bucket).Get([]byte(key))
		if v == nil {
			return nil
		}
		found = true
		return json.Unmarshal(v, out)
	})
	return found, err
}

func (s *Store) del(bucket []byte, key string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(bucket).Delete([]byte(key))
	})
}

// list decodes every value in a bucket into freshly-created T.
func list[T any](s *Store, bucket []byte) ([]T, error) {
	var out []T
	err := s.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket(bucket).ForEach(func(_, v []byte) error {
			var item T
			if err := json.Unmarshal(v, &item); err != nil {
				return err
			}
			out = append(out, item)
			return nil
		})
	})
	return out, err
}

func clear(s *Store, bucket []byte) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		if err := tx.DeleteBucket(bucket); err != nil {
			return err
		}
		_, err := tx.CreateBucketIfNotExists(bucket)
		return err
	})
}

// ---- meta ----

func (s *Store) SetMeta(key, value string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(bMeta).Put([]byte(key), []byte(value))
	})
}

func (s *Store) GetMeta(key string) string {
	var v string
	_ = s.db.View(func(tx *bolt.Tx) error {
		if b := tx.Bucket(bMeta).Get([]byte(key)); b != nil {
			v = string(b)
		}
		return nil
	})
	return v
}

// ---- session (cookies + csrf) ----

type Session struct {
	BaseURL string `json:"baseUrl"`
	Cookies string `json:"cookies"`
	Csrf    string `json:"csrf"`
	UserID  string `json:"userId"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

func (s *Store) SaveSession(sess Session) error { return s.put(bSession, "current", sess) }

func (s *Store) LoadSession() (Session, bool) {
	var sess Session
	found, _ := s.get(bSession, "current", &sess)
	return sess, found
}

func (s *Store) ClearSession() error { return s.del(bSession, "current") }

// ---- outbox ----

func (s *Store) nextSeq(tx *bolt.Tx) (uint64, error) {
	b := tx.Bucket(bOutbox)
	seq, _ := b.NextSequence()
	return seq, nil
}

// Enqueue appends an operation to the outbox.
func (s *Store) Enqueue(op OutboxOp) (uint64, error) {
	var seq uint64
	err := s.db.Update(func(tx *bolt.Tx) error {
		var e error
		seq, e = s.nextSeq(tx)
		if e != nil {
			return e
		}
		op.Seq = seq
		if op.CreatedAt == "" {
			op.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		data, e := json.Marshal(op)
		if e != nil {
			return e
		}
		var key [8]byte
		binary.BigEndian.PutUint64(key[:], seq)
		return tx.Bucket(bOutbox).Put(key[:], data)
	})
	return seq, err
}

// OutboxList returns queued operations in insertion order.
func (s *Store) OutboxList() ([]OutboxOp, error) {
	var ops []OutboxOp
	err := s.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket(bOutbox).ForEach(func(_, v []byte) error {
			var op OutboxOp
			if err := json.Unmarshal(v, &op); err != nil {
				return err
			}
			ops = append(ops, op)
			return nil
		})
	})
	return ops, err
}

func (s *Store) OutboxDelete(seq uint64) error {
	var key [8]byte
	binary.BigEndian.PutUint64(key[:], seq)
	return s.del(bOutbox, string(key[:]))
}

func (s *Store) OutboxCount() int {
	n := 0
	_ = s.db.View(func(tx *bolt.Tx) error {
		n = tx.Bucket(bOutbox).Stats().KeyN
		return nil
	})
	return n
}

// ---- reserved number blocks ----

func (s *Store) SetBlock(b Block) error { return s.put(bBlocks, "current", b) }

func (s *Store) Block() (Block, bool) {
	var b Block
	found, _ := s.get(bBlocks, "current", &b)
	return b, found
}

// AllocateSerial hands out the next number from the reserved block, or
// ErrNoNumbers when the block is exhausted.
func (s *Store) AllocateSerial() (int, error) {
	var out int
	err := s.db.Update(func(tx *bolt.Tx) error {
		bk := tx.Bucket(bBlocks)
		raw := bk.Get([]byte("current"))
		if raw == nil {
			return ErrNoNumbers
		}
		var b Block
		if err := json.Unmarshal(raw, &b); err != nil {
			return err
		}
		if b.Next > b.End {
			return ErrNoNumbers
		}
		out = b.Next
		b.Next++
		data, _ := json.Marshal(b)
		return bk.Put([]byte("current"), data)
	})
	return out, err
}

// RemainingNumbers reports how many reserved numbers are left.
func (s *Store) RemainingNumbers() int {
	b, ok := s.Block()
	if !ok || b.Next > b.End {
		return 0
	}
	return b.End - b.Next + 1
}
