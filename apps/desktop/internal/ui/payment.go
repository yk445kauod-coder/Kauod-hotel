package ui

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/core"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
)

var paymentMethods = []string{"cash", "card", "instapay", "bank_transfer", "other"}
var paymentLabels = []string{"نقدًا", "بطاقة", "إنستاباي", "تحويل بنكي", "أخرى"}

// paymentDialog records a payment against an invoice.
func (a *App) paymentDialog(inv model.Invoice) {
	payments, _ := a.store.Payments(inv.ID)
	paid := sumPayments(payments)
	remaining, _ := core.ParseMoney(inv.Total)
	paidM, _ := core.ParseMoney(paid)
	due := core.FormatMoney(remaining - paidM)

	var dlg *walk.Dialog
	var amount *walk.NumberEdit
	var method *walk.ComboBox
	var reference, paidAt *walk.LineEdit
	dueVal, _ := strconv.ParseFloat(due, 64)

	_, _ = (Dialog{
		AssignTo: &dlg,
		Title:    "تسجيل دفعة — فاتورة " + fmt.Sprintf("%d", inv.Serial),
		MinSize:  Size{420, 320},
		Layout:   VBox{Margins: Margins{14, 14, 14, 14}, Spacing: 8},
		Children: []Widget{
			Label{Text: "الإجمالي: " + inv.Total + " • المدفوع: " + paid + " • المتبقي: " + due},
			Label{Text: "المبلغ"},
			NumberEdit{AssignTo: &amount, Value: dueVal, Decimals: 2, MinValue: 0, MaxValue: 100000000},
			Label{Text: "طريقة الدفع"},
			ComboBox{AssignTo: &method, Model: paymentLabels, CurrentIndex: 0},
			Label{Text: "المرجع (اختياري)"},
			LineEdit{AssignTo: &reference},
			Label{Text: "التاريخ (YYYY-MM-DD)"},
			LineEdit{AssignTo: &paidAt, Text: today()},
			Composite{Layout: HBox{}, Children: []Widget{
				VSpacer{},
				PushButton{Text: "حفظ", OnClicked: func() {
					if amount.Value() <= 0 {
						a.warn("أدخل مبلغًا صحيحًا")
						return
					}
					idx := method.CurrentIndex()
					if idx < 0 || idx >= len(paymentMethods) {
						idx = 0
					}
					body := map[string]any{
						"amount":    strconv.FormatFloat(amount.Value(), 'f', 2, 64),
						"method":    paymentMethods[idx],
						"reference": reference.Text(),
						"paidAt":    paidAt.Text(),
					}
					if err := a.savePayment(inv, body); err != nil {
						a.fail(err.Error())
						return
					}
					dlg.Accept()
				}},
				PushButton{Text: "إغلاق", OnClicked: func() { dlg.Cancel() }},
			}},
		},
	}).Run(a.mw)
	a.updateSyncLabel()
}

func (a *App) savePayment(inv model.Invoice, body map[string]any) error {
	if a.online() {
		if err := a.api.AddPayment(inv.ID, body); err != nil {
			return fmt.Errorf("تعذّر تسجيل الدفعة: %s", friendlyErr(err))
		}
		return nil
	}
	if inv.Status == "cancelled" {
		return fmt.Errorf("لا يمكن الدفع على فاتورة ملغاة")
	}
	raw, _ := json.Marshal(body)
	_, _ = a.store.Enqueue(outbox("POST", "/api/invoices/"+inv.ID+"/payments", "payment", inv.ID, raw))
	// Reflect locally so the printed remaining is correct offline.
	amt := ""
	if v, ok := body["amount"].(string); ok {
		amt = v
	}
	paidAt := ""
	if v, ok := body["paidAt"].(string); ok {
		paidAt = v
	}
	method := ""
	if v, ok := body["method"].(string); ok {
		method = v
	}
	ref := ""
	if v, ok := body["reference"].(string); ok {
		ref = v
	}
	return a.store.PutPayment(model.Payment{
		ID: core.UUIDv4(), InvoiceID: inv.ID, Amount: amt, Method: method, Reference: ref, PaidAt: paidAt,
	})
}

func sumPayments(ps []model.Payment) string {
	total := core.Minor(0)
	for _, p := range ps {
		m, err := core.ParseMoney(p.Amount)
		if err == nil {
			total += m
		}
	}
	return core.FormatMoney(total)
}

func today() string {
	return nowISO()[:10]
}
