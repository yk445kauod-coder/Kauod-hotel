package ui

import (
	"github.com/lxn/walk"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
)

// invoiceModel backs the invoices TableView.
type invoiceModel struct {
	walk.TableModelBase
	items []model.Invoice
}

func (m *invoiceModel) RowCount() int { return len(m.items) }

func (m *invoiceModel) Value(row, col int) interface{} {
	if row < 0 || row >= len(m.items) {
		return ""
	}
	inv := m.items[row]
	switch col {
	case 0:
		return inv.Serial
	case 1:
		return inv.GuestName
	case 2:
		return inv.RoomNumber
	case 3:
		return inv.Total
	case 4:
		return statusLabel(inv.Status)
	case 5:
		return inv.IssuedAt
	}
	return ""
}

func (m *invoiceModel) SetItems(items []model.Invoice) {
	m.items = items
	m.PublishRowsReset()
}

func (m *invoiceModel) At(i int) (model.Invoice, bool) {
	if i < 0 || i >= len(m.items) {
		return model.Invoice{}, false
	}
	return m.items[i], true
}

// simpleListModel backs small ComboBoxes and lists.
type simpleListModel struct {
	walk.ListModelBase
	items []string
}

func (m *simpleListModel) ItemCount() int { return len(m.items) }
func (m *simpleListModel) Value(i int) interface{} {
	if i < 0 || i >= len(m.items) {
		return ""
	}
	return m.items[i]
}
func (m *simpleListModel) SetItems(items []string) {
	m.items = items
	m.PublishItemsReset()
}

// statusLabel renders an invoice status in Arabic.
func statusLabel(status string) string {
	switch status {
	case "open":
		return "مفتوحة"
	case "locked":
		return "مقفلة"
	case "cancelled":
		return "ملغاة"
	case "draft":
		return "مسودة"
	}
	return status
}
