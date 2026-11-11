package ui

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/core"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/store"
)

// outbox builds an OutboxOp with a JSON body.
func outbox(method, path, entity, entityID string, body []byte) store.OutboxOp {
	return store.OutboxOp{ID: core.UUIDv4(), Method: method, Path: path, Entity: entity, EntityID: entityID, Body: json.RawMessage(body)}
}

var lineKinds = []string{"room", "restaurant", "minibar", "laundry", "extra"}
var lineKindLabels = []string{"غرفة", "مطعم", "ميني بار", "مغسلة", "إضافي"}

type lineRow struct {
	desc  *walk.LineEdit
	qty   *walk.NumberEdit
	price *walk.NumberEdit
	kind  *walk.ComboBox
}

// newInvoice opens the editor for a brand-new invoice.
func (a *App) newInvoice() {
	a.editInvoice(model.Invoice{})
}

// editInvoice opens the editor for an existing invoice, or a blank one when
// inv.ID is empty.
func (a *App) editInvoice(inv model.Invoice) {
	isNew := inv.ID == ""
	settings, _ := a.store.Settings()

	vat := settings.VatRate
	disc := settings.DiscountRate
	if inv.VatRate != nil {
		vat = *inv.VatRate
	}
	if inv.DiscountRate != nil {
		disc = *inv.DiscountRate
	}

	var existingLines []model.InvoiceLine
	if !isNew {
		existingLines, _ = a.store.Lines(inv.ID)
	}

	var dlg *walk.Dialog
	var guest, room, checkIn, checkOut, notes *walk.LineEdit
	var vatNE, discNE *walk.NumberEdit
	var applyDisc *walk.CheckBox
	var summary *walk.Label

	rows := make([]lineRow, 5)
	lineWidgets := make([]Widget, 0, len(rows))
	for i := range rows {
		rows[i] = lineRow{}
		idx := i
		prefillDesc, prefillQty, prefillPrice, prefillKind := "", 1.0, 0.0, 0
		if idx < len(existingLines) {
			l := existingLines[idx]
			prefillDesc = l.Description
			prefillQty = l.Qty
			if f, err := strconv.ParseFloat(l.UnitPrice, 64); err == nil {
				prefillPrice = f
			}
			for k, kk := range lineKinds {
				if kk == l.Kind {
					prefillKind = k
				}
			}
		}
		lineWidgets = append(lineWidgets, Composite{
			Layout: HBox{MarginsZero: true, Spacing: 4},
			Children: []Widget{
				LineEdit{AssignTo: &rows[idx].desc, Text: prefillDesc, MinSize: Size{260, 0}},
				NumberEdit{AssignTo: &rows[idx].qty, Value: prefillQty, Decimals: 2, MinValue: 0, MaxValue: 10000, MinSize: Size{80, 0}},
				NumberEdit{AssignTo: &rows[idx].price, Value: prefillPrice, Decimals: 2, MinValue: 0, MaxValue: 10000000, MinSize: Size{110, 0}},
				ComboBox{AssignTo: &rows[idx].kind, Model: lineKindLabels, CurrentIndex: prefillKind, MinSize: Size{110, 0}},
			},
		})
	}

	recalc := func() {
		in := a.gatherInput(guest, room, checkIn, checkOut, notes, vatNE, discNE, applyDisc, rows)
		calc := core.CalcInvoice(in, a.taxConfig(vatNE, discNE))
		summary.SetText(fmt.Sprintf("صافي %s • ضريبة %s • خصم %s • الإجمالي %s",
			calc.SubtotalNet, calc.TaxTotal, calc.Discount, calc.Total))
	}

	_, err := (Dialog{
		AssignTo: &dlg,
		Title:    map[bool]string{true: "فاتورة جديدة", false: "تعديل فاتورة " + fmt.Sprintf("%d", inv.Serial)}[isNew],
		MinSize:  Size{820, 560},
		Layout:   VBox{Margins: Margins{12, 12, 12, 12}, Spacing: 6},
		Children: []Widget{
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "العميل"}, LineEdit{AssignTo: &guest, Text: inv.GuestName, MinSize: Size{220, 0}},
				Label{Text: "الغرفة"}, LineEdit{AssignTo: &room, Text: inv.RoomNumber, MinSize: Size{80, 0}},
			}},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "من (YYYY-MM-DD)"}, LineEdit{AssignTo: &checkIn, Text: deref(inv.CheckIn), MinSize: Size{140, 0}},
				Label{Text: "إلى (YYYY-MM-DD)"}, LineEdit{AssignTo: &checkOut, Text: deref(inv.CheckOut), MinSize: Size{140, 0}},
			}},
			Label{Text: "البنود (الوصف، الكمية، السعر شامل الضريبة، النوع)"},
			Composite{Layout: VBox{MarginsZero: true, Spacing: 4}, Children: lineWidgets},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "ضريبة %"}, NumberEdit{AssignTo: &vatNE, Value: vat, Decimals: 2, MinValue: 0, MaxValue: 100, MinSize: Size{80, 0}},
				Label{Text: "خصم %"}, NumberEdit{AssignTo: &discNE, Value: disc, Decimals: 2, MinValue: 0, MaxValue: 100, MinSize: Size{80, 0}},
				CheckBox{AssignTo: &applyDisc, Text: "تطبيق الخصم", Checked: true},
			}},
			Label{Text: "ملاحظات"},
			LineEdit{AssignTo: &notes, Text: inv.Notes},
			Label{AssignTo: &summary, TextColor: walk.RGB(20, 40, 120)},
			Composite{Layout: HBox{}, Children: []Widget{
				VSpacer{},
				PushButton{Text: "حساب", OnClicked: recalc},
				PushButton{Text: "حفظ", OnClicked: func() {
					in := a.gatherInput(guest, room, checkIn, checkOut, notes, vatNE, discNE, applyDisc, rows)
					if strings.TrimSpace(in.GuestName) == "" {
						a.warn("أدخل اسم العميل")
						return
					}
					if len(in.Lines) == 0 {
						a.warn("أضف بندًا واحدًا على الأقل")
						return
					}
					if err := a.saveInvoice(inv, in, vatNE.Value(), discNE.Value()); err != nil {
						a.fail(err.Error())
						return
					}
					dlg.Accept()
				}},
				PushButton{Text: "إغلاق", OnClicked: func() { dlg.Cancel() }},
			}},
		},
	}).Run(a.mw)
	if err == nil {
		recalc()
		a.refreshTable()
		a.updateSyncLabel()
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// gatherInput reads the editor widgets into a core.InvoiceInput.
func (a *App) gatherInput(guest, room, checkIn, checkOut, notes *walk.LineEdit, vatNE, discNE *walk.NumberEdit, applyDisc *walk.CheckBox, rows []lineRow) core.InvoiceInput {
	in := core.InvoiceInput{
		GuestName:     strings.TrimSpace(guest.Text()),
		RoomNumber:    strings.TrimSpace(room.Text()),
		CheckIn:       strings.TrimSpace(checkIn.Text()),
		CheckOut:      strings.TrimSpace(checkOut.Text()),
		Notes:         strings.TrimSpace(notes.Text()),
		HasDiscount:   true,
		ApplyDiscount: applyDisc.Checked(),
	}
	for _, r := range rows {
		desc := strings.TrimSpace(r.desc.Text())
		if desc == "" {
			continue
		}
		kind := core.KindExtra
		if i := r.kind.CurrentIndex(); i >= 0 && i < len(lineKinds) {
			kind = core.LineKind(lineKinds[i])
		}
		in.Lines = append(in.Lines, core.LineItem{
			Description: desc, Qty: r.qty.Value(), UnitPrice: strconv.FormatFloat(r.price.Value(), 'f', 2, 64), Kind: kind,
		})
	}
	return in
}

func (a *App) taxConfig(vatNE, discNE *walk.NumberEdit) core.TaxConfig {
	s, _ := a.store.Settings()
	return core.TaxConfig{VatRate: vatNE.Value(), DiscountRate: discNE.Value(), PricesIncludeTax: s.PricesIncludeTax == 1}
}

// saveInvoice persists locally and queues (or sends) the write.
func (a *App) saveInvoice(inv model.Invoice, in core.InvoiceInput, vatRate, discRate float64) error {
	settings, _ := a.store.Settings()
	cfg := core.TaxConfig{VatRate: vatRate, DiscountRate: discRate, PricesIncludeTax: settings.PricesIncludeTax == 1}
	calc := core.CalcInvoice(in, cfg)

	payload := map[string]any{
		"guestName":       in.GuestName,
		"roomNumber":      in.RoomNumber,
		"notes":           in.Notes,
		"applyDiscount":   in.ApplyDiscount,
		"discountPercent": discRate,
		"vatRate":         vatRate,
		"discountRate":    discRate,
		"lines":           payloadLines(in.Lines),
	}
	if in.CheckIn != "" {
		payload["checkIn"] = in.CheckIn
	}
	if in.CheckOut != "" {
		payload["checkOut"] = in.CheckOut
	}

	if inv.ID == "" {
		return a.createInvoiceLocal(in, calc, payload)
	}
	return a.updateInvoiceLocal(inv, payload)
}

func (a *App) createInvoiceLocal(in core.InvoiceInput, calc core.CalcResult, payload map[string]any) error {
	opID := core.UUIDv4()
	localID := "local-" + opID
	serial := 0

	if a.online() {
		// Online: let the server allocate the number, send immediately.
		res, err := a.api.CreateInvoice(payload)
		if err != nil {
			return fmt.Errorf("تعذّر الحفظ على الخادم: %s", friendlyErr(err))
		}
		_ = a.store.PutInvoice(res.Invoice)
		_ = a.store.PutLines(res.Invoice.ID, res.Lines)
		return nil
	}

	// Offline: allocate from the reserved block and queue the write.
	n, err := a.store.AllocateSerial()
	if err != nil {
		return fmt.Errorf("لا توجد أرقام محجوزة متاحة — اتصل بالإنترنت مرة واحدة لحجز أرقام")
	}
	serial = n
	payload["serial"] = serial
	payload["opId"] = opID
	body, _ := json.Marshal(payload)
	_, _ = a.store.Enqueue(outbox("POST", "/api/invoices", "invoice", localID, body))

	local := model.Invoice{
		ID: localID, Serial: serial, UUID: core.UUIDv4(),
		GuestName: in.GuestName, RoomNumber: in.RoomNumber,
		Status: "open", IssuedAt: nowISO(),
		SubtotalNet: calc.SubtotalNet, SubtotalGross: calc.SubtotalGross,
		TaxTotal: calc.TaxTotal, Discount: calc.Discount, Total: calc.Total,
		Notes: in.Notes,
	}
	if in.CheckIn != "" {
		local.CheckIn = &in.CheckIn
	}
	if in.CheckOut != "" {
		local.CheckOut = &in.CheckOut
	}
	_ = a.store.PutInvoice(local)
	lines := make([]model.InvoiceLine, 0, len(calc.Lines))
	for i, l := range calc.Lines {
		lines = append(lines, model.InvoiceLine{
			ID: core.UUIDv4(), InvoiceID: local.ID, Description: l.Description, Qty: l.Qty,
			UnitPrice: l.UnitPrice, Kind: string(in.Lines[i].Kind), Gross: l.Gross, Net: l.Net, Tax: l.Tax, Position: i,
		})
	}
	_ = a.store.PutLines(local.ID, lines)
	return nil
}

func (a *App) updateInvoiceLocal(inv model.Invoice, payload map[string]any) error {
	if inv.Status == "locked" || inv.Status == "cancelled" {
		return fmt.Errorf("لا يمكن تعديل فاتورة مقفلة أو ملغاة")
	}
	if a.online() {
		res, err := a.api.UpdateInvoice(inv.ID, payload)
		if err != nil {
			return fmt.Errorf("تعذّر التحديث: %s", friendlyErr(err))
		}
		_ = a.store.PutInvoice(res.Invoice)
		_ = a.store.PutLines(res.Invoice.ID, res.Lines)
		return nil
	}
	body, _ := json.Marshal(payload)
	_, _ = a.store.Enqueue(outbox("PUT", "/api/invoices/"+inv.ID, "invoice", inv.ID, body))
	return nil
}

func payloadLines(lines []core.LineItem) []map[string]any {
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		price, _ := core.ParseMoney(l.UnitPrice)
		out = append(out, map[string]any{
			"description": l.Description,
			"qty":         l.Qty,
			"unitPrice":   core.FormatMoney(price),
			"kind":        string(l.Kind),
		})
	}
	return out
}

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func nowISO() string {
	return time.Now().Format("2006-01-02T15:04:05")
}
