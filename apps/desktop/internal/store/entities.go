package store

import (
	"sort"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
)

// ---- invoices ----

func (s *Store) PutInvoice(inv model.Invoice) error { return s.put(bInvoices, inv.ID, inv) }
func (s *Store) PutInvoices(invs []model.Invoice) error {
	for _, inv := range invs {
		if err := s.PutInvoice(inv); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetInvoice(id string) (model.Invoice, bool) {
	var inv model.Invoice
	found, _ := s.get(bInvoices, id, &inv)
	return inv, found
}

// Invoices returns all invoices, newest serial first.
func (s *Store) Invoices() ([]model.Invoice, error) {
	invs, err := list[model.Invoice](s, bInvoices)
	if err != nil {
		return nil, err
	}
	sort.Slice(invs, func(i, j int) bool { return invs[i].Serial > invs[j].Serial })
	return invs, nil
}

// ReplaceInvoices swaps the whole mirror (used after a full pull).
func (s *Store) ReplaceInvoices(invs []model.Invoice) error {
	if err := clear(s, bInvoices); err != nil {
		return err
	}
	return s.PutInvoices(invs)
}

// ---- lines ----

func (s *Store) PutLines(invoiceID string, lines []model.InvoiceLine) error {
	for i := range lines {
		lines[i].InvoiceID = invoiceID
		if lines[i].Position == 0 {
			lines[i].Position = i
		}
		if err := s.put(bLines, lines[i].ID, lines[i]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Lines(invoiceID string) ([]model.InvoiceLine, error) {
	all, err := list[model.InvoiceLine](s, bLines)
	if err != nil {
		return nil, err
	}
	var out []model.InvoiceLine
	for _, l := range all {
		if l.InvoiceID == invoiceID {
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

// ---- payments ----

func (s *Store) PutPayment(p model.Payment) error { return s.put(bPayments, p.ID, p) }

func (s *Store) Payments(invoiceID string) ([]model.Payment, error) {
	all, err := list[model.Payment](s, bPayments)
	if err != nil {
		return nil, err
	}
	var out []model.Payment
	for _, p := range all {
		if p.InvoiceID == invoiceID {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PaidAt < out[j].PaidAt })
	return out, nil
}

// ---- settings ----

func (s *Store) PutSettings(v model.Settings) error { return s.put(bSettings, "current", v) }

func (s *Store) Settings() (model.Settings, bool) {
	var v model.Settings
	found, _ := s.get(bSettings, "current", &v)
	return v, found
}

// ---- rooms ----

func (s *Store) ReplaceRooms(rooms []model.Room) error {
	if err := clear(s, bRooms); err != nil {
		return err
	}
	for _, r := range rooms {
		if err := s.put(bRooms, r.ID, r); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Rooms() ([]model.Room, error) {
	rooms, err := list[model.Room](s, bRooms)
	if err != nil {
		return nil, err
	}
	sort.Slice(rooms, func(i, j int) bool { return rooms[i].Number < rooms[j].Number })
	return rooms, nil
}

// ---- guests ----

func (s *Store) ReplaceGuests(guests []model.Guest) error {
	if err := clear(s, bGuests); err != nil {
		return err
	}
	for _, g := range guests {
		if err := s.put(bGuests, g.ID, g); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Guests() ([]model.Guest, error) {
	guests, err := list[model.Guest](s, bGuests)
	if err != nil {
		return nil, err
	}
	sort.Slice(guests, func(i, j int) bool { return guests[i].Name < guests[j].Name })
	return guests, nil
}

// ---- users ----

func (s *Store) ReplaceUsers(users []model.User) error {
	if err := clear(s, bUsers); err != nil {
		return err
	}
	for _, u := range users {
		if err := s.put(bUsers, u.ID, u); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Users() ([]model.User, error) { return list[model.User](s, bUsers) }

// ---- local id mapping ----

// SetLocalID maps a client-generated id to the server id after a successful push.
func (s *Store) SetLocalID(localID, serverID string) error {
	return s.put(bLocalIDs, localID, serverID)
}

func (s *Store) ResolveLocalID(localID string) (string, bool) {
	var v string
	found, _ := s.get(bLocalIDs, localID, &v)
	return v, found
}
