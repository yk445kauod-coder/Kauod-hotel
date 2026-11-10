package ui

import (
	"encoding/base64"
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/skip2/go-qrcode"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/core"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
)

// printData is everything the invoice template needs.
type printData struct {
	Serial       int
	UUID         string
	IssuedAt     string
	Status       string
	GuestName    string
	RoomNumber   string
	CheckIn      string
	CheckOut     string
	Lines        []core.LineResult
	Calc         core.CalcResult
	IssuerName   string
	IssuerTaxID  string
	IssuerAddr   string
	City         string
	Logo         string // data URI or ""
	QR           string // data URI or ""
	Footer       string
	SigLeft      string
	SigRight     string
	Notes        string
	Paid         string
	Currency     string
}

// printInvoice assembles the invoice and opens a print-ready page.
func (a *App) printInvoice(inv model.Invoice) {
	settings, _ := a.store.Settings()

	// Prefer the server's authoritative print payload when the invoice is
	// locked and we are online; otherwise render from the local copy.
	if a.online() && (inv.Status == "locked" || inv.Status == "cancelled") {
		if pr, err := a.api.Print(inv.ID); err == nil {
			a.openPrint(a.printDataFromServer(pr))
			return
		}
	}

	pd, err := a.printDataLocal(inv, settings)
	if err != nil {
		a.fail(err.Error())
		return
	}
	a.openPrint(pd)
}

func (a *App) printDataFromServer(pr model.PrintResponse) printData {
	lines := make([]core.LineResult, 0, len(pr.Lines))
	for _, l := range pr.Lines {
		lines = append(lines, core.LineResult{Description: l.Description, Qty: l.Qty, UnitPrice: l.UnitPrice, Gross: l.Gross, Net: l.Net, Tax: l.Tax})
	}
	qr := ""
	if pr.Qr != "" {
		qr = qrDataURI(pr.Qr)
	}
	return printData{
		Serial: pr.Invoice.Serial, UUID: pr.Invoice.UUID, IssuedAt: pr.Invoice.IssuedAt, Status: pr.Invoice.Status,
		GuestName: pr.Invoice.GuestName, RoomNumber: pr.Invoice.RoomNumber,
		CheckIn: deref(pr.Invoice.CheckIn), CheckOut: deref(pr.Invoice.CheckOut),
		Lines: lines, Calc: core.CalcResult{
			SubtotalNet: pr.Calc.SubtotalNet, SubtotalGross: pr.Calc.SubtotalGross, TaxTotal: pr.Calc.TaxTotal,
			Discount: pr.Calc.Discount, Total: pr.Calc.Total, VatRate: pr.Calc.VatRate, DiscountRate: pr.Calc.DiscountRate, Nights: pr.Calc.Nights,
		},
		IssuerName: pr.Issuer.Name, IssuerTaxID: pr.Issuer.TaxID, IssuerAddr: pr.Issuer.Address, City: pr.Issuer.City,
		Logo: pr.Settings.LogoData, QR: qr, Footer: pr.Settings.FooterNote,
		SigLeft: pr.Settings.SignatureLeft, SigRight: pr.Settings.SignatureRight,
		Notes: pr.Invoice.Notes, Paid: pr.Paid, Currency: pr.Settings.Currency,
	}
}

func (a *App) printDataLocal(inv model.Invoice, s model.Settings) (printData, error) {
	lines, _ := a.store.Lines(inv.ID)
	items := make([]core.LineItem, 0, len(lines))
	for _, l := range lines {
		items = append(items, core.LineItem{Description: l.Description, Qty: l.Qty, UnitPrice: l.UnitPrice, Kind: core.LineKind(l.Kind)})
	}
	vat := s.VatRate
	disc := s.DiscountRate
	if inv.VatRate != nil {
		vat = *inv.VatRate
	}
	if inv.DiscountRate != nil {
		disc = *inv.DiscountRate
	}
	in := core.InvoiceInput{
		GuestName: inv.GuestName, RoomNumber: inv.RoomNumber, CheckIn: deref(inv.CheckIn), CheckOut: deref(inv.CheckOut),
		Lines: items, HasDiscount: true, ApplyDiscount: true,
	}
	calc := core.CalcInvoice(in, core.TaxConfig{VatRate: vat, DiscountRate: disc, PricesIncludeTax: s.PricesIncludeTax == 1})

	issuerName := s.HotelName
	issuerTax := s.TaxRegistrationNumber
	issuerAddr := s.Address
	if inv.IssuerName != nil && *inv.IssuerName != "" {
		issuerName = *inv.IssuerName
	}
	if inv.IssuerTaxID != nil && *inv.IssuerTaxID != "" {
		issuerTax = *inv.IssuerTaxID
	}
	if inv.IssuerAddress != nil && *inv.IssuerAddress != "" {
		issuerAddr = *inv.IssuerAddress
	}

	uuid := inv.UUID
	if uuid == "" {
		uuid = core.UUIDv4()
	}
	payload := core.EtaQrPayload(core.QrFields{
		SellerName: issuerName, VatNumber: issuerTax, IssuedAt: inv.IssuedAt,
		Total: calc.Total, VatTotal: calc.TaxTotal, UUID: uuid,
	})
	paid := sumPayments(mustPayments(a, inv.ID))

	return printData{
		Serial: inv.Serial, UUID: uuid, IssuedAt: inv.IssuedAt, Status: inv.Status,
		GuestName: inv.GuestName, RoomNumber: inv.RoomNumber, CheckIn: deref(inv.CheckIn), CheckOut: deref(inv.CheckOut),
		Lines: calc.Lines, Calc: calc,
		IssuerName: issuerName, IssuerTaxID: issuerTax, IssuerAddr: issuerAddr, City: s.City,
		Logo: s.LogoData, QR: qrDataURI(payload), Footer: s.FooterNote,
		SigLeft: s.SignatureLeft, SigRight: s.SignatureRight, Notes: inv.Notes, Paid: paid, Currency: s.Currency,
	}, nil
}

func mustPayments(a *App, id string) []model.Payment {
	ps, _ := a.store.Payments(id)
	return ps
}

// openPrint writes the HTML invoice and opens it in the default browser,
// where the user prints or saves as PDF. Works fully offline.
func (a *App) openPrint(pd printData) {
	path := filepath.Join(os.TempDir(), fmt.Sprintf("kaoud-invoice-%d.html", pd.Serial))
	if err := os.WriteFile(path, []byte(renderInvoiceHTML(pd)), 0o644); err != nil {
		a.fail("تعذّر إنشاء صفحة الطباعة: " + err.Error())
		return
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/c", "start", "", path)
	} else {
		cmd = exec.Command("xdg-open", path)
	}
	if err := cmd.Start(); err != nil {
		a.fail("تعذّر فتح صفحة الطباعة: " + err.Error())
	}
}

func qrDataURI(payload string) string {
	png, err := qrcode.Encode(payload, qrcode.Medium, 256)
	if err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

func esc(s string) string { return html.EscapeString(s) }

// renderInvoiceHTML reproduces the V13 professional invoice, RTL, print-ready.
func renderInvoiceHTML(d printData) string {
	var b strings.Builder
	b.WriteString(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">`)
	b.WriteString(`<title>فاتورة `)
	b.WriteString(esc(fmt.Sprintf("%d", d.Serial)))
	b.WriteString(`</title><style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color:#111; margin:0; padding:0; }
.sheet { width: 186mm; margin: 0 auto; }
.bar { height: 8px; background: linear-gradient(90deg,#0b2545,#1d4e89,#c8a24a); border-radius:4px; }
.head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin:14px 0; }
.head .who { flex:1; }
.hotel { font-size:20px; font-weight:700; color:#0b2545; }
.hotel-en { font-size:12px; color:#555; letter-spacing:1px; }
.meta { font-size:12px; color:#444; line-height:1.7; }
.logo { max-height:70px; max-width:150px; object-fit:contain; }
.box { border:1.5px solid #0b2545; border-radius:8px; padding:10px 14px; }
.invoice-box { background:#0b2545; color:#fff; padding:10px 18px; border-radius:8px; text-align:center; min-width:150px; }
.invoice-box .t { font-size:22px; font-weight:800; letter-spacing:2px; }
.invoice-box .s { font-size:13px; }
.billto { background:#f4f7fb; border:1px solid #d8e2ee; border-radius:8px; padding:10px 14px; font-size:13px; }
table { width:100%; border-collapse:collapse; margin-top:12px; font-size:13px; }
th { background:#0b2545; color:#fff; padding:8px; text-align:right; font-weight:600; }
td { border-bottom:1px solid #e2e8f0; padding:8px; }
td.num, th.num { text-align:left; direction:ltr; }
.summary { margin-top:14px; display:flex; justify-content:flex-start; }
.summary table { width:60%; margin:0; }
.summary td { border:none; padding:4px 8px; }
.total { background:#0b2545; color:#fff; font-weight:800; font-size:15px; border-radius:6px; }
.sigs { display:flex; justify-content:space-between; margin-top:44px; font-size:12px; }
.sig { text-align:center; width:40%; }
.sig .line { border-top:1.5px solid #333; margin-bottom:6px; }
.foot { margin-top:20px; border-top:1px solid #ddd; padding-top:8px; font-size:11px; color:#666; display:flex; justify-content:space-between; }
.qr { width:120px; height:120px; }
.status { display:inline-block; padding:2px 10px; border-radius:12px; font-size:12px; background:#eef2f7; color:#0b2545; }
@media print { .noprint { display:none; } }
</style></head><body><div class="sheet">`)
	b.WriteString(`<div class="noprint" style="text-align:center;margin:10px 0;"><button onclick="window.print()" style="padding:8px 20px;font-size:15px;cursor:pointer;">طباعة / حفظ PDF</button></div>`)
	b.WriteString(`<div class="bar"></div><div class="head">`)
	if d.Logo != "" {
		b.WriteString(`<img class="logo" src="` + esc(d.Logo) + `" alt="logo">`)
	}
	b.WriteString(`<div class="who"><div class="hotel">` + esc(d.IssuerName) + `</div>`)
	b.WriteString(`<div class="hotel-en">` + esc(d.City) + `</div>`)
	b.WriteString(`<div class="meta">الرقم الضريبي: ` + esc(d.IssuerTaxID) + `<br>` + esc(d.IssuerAddr) + `</div></div>`)
	b.WriteString(`<div class="invoice-box"><div class="t">INVOICE</div><div class="s">فاتورة ضريبية</div><div class="s">No. ` + esc(fmt.Sprintf("%d", d.Serial)) + `</div></div>`)
	b.WriteString(`</div>`)
	b.WriteString(`<div class="billto"><b>فاتورة إلى</b> — ` + esc(d.GuestName))
	if d.RoomNumber != "" {
		b.WriteString(` • غرفة ` + esc(d.RoomNumber))
	}
	if d.CheckIn != "" || d.CheckOut != "" {
		b.WriteString(`<br>من ` + esc(d.CheckIn) + ` إلى ` + esc(d.CheckOut))
	}
	b.WriteString(`<br>التاريخ: ` + esc(d.IssuedAt) + ` <span class="status">` + esc(statusLabel(d.Status)) + `</span></div>`)

	b.WriteString(`<table><thead><tr><th>الوصف</th><th class="num">الكمية</th><th class="num">السعر</th><th class="num">الصافي</th><th class="num">الضريبة</th><th class="num">الإجمالي</th></tr></thead><tbody>`)
	for _, l := range d.Lines {
		b.WriteString(`<tr><td>` + esc(l.Description) + `</td><td class="num">` + esc(fmt.Sprintf("%g", l.Qty)) + `</td><td class="num">` + esc(l.UnitPrice) + `</td><td class="num">` + esc(l.Net) + `</td><td class="num">` + esc(l.Tax) + `</td><td class="num">` + esc(l.Gross) + `</td></tr>`)
	}
	b.WriteString(`</tbody></table>`)

	b.WriteString(`<div class="summary"><table>`)
	b.WriteString(`<tr><td>الصافي</td><td class="num">` + esc(d.Calc.SubtotalNet) + ` ` + esc(d.Currency) + `</td></tr>`)
	b.WriteString(`<tr><td>الضريبة (` + esc(fmt.Sprintf("%g", d.Calc.VatRate)) + `%)</td><td class="num">` + esc(d.Calc.TaxTotal) + `</td></tr>`)
	b.WriteString(`<tr><td>الخصم (` + esc(fmt.Sprintf("%g", d.Calc.DiscountRate)) + `%)</td><td class="num">-` + esc(d.Calc.Discount) + `</td></tr>`)
	if d.Paid != "" && d.Paid != "0.00" {
		b.WriteString(`<tr><td>المدفوع</td><td class="num">` + esc(d.Paid) + `</td></tr>`)
	}
	b.WriteString(`<tr class="total"><td>الإجمالي المستحق</td><td class="num">` + esc(d.Calc.Total) + ` ` + esc(d.Currency) + `</td></tr>`)
	b.WriteString(`</table></div>`)

	if d.Notes != "" {
		b.WriteString(`<div style="margin-top:10px;font-size:12px;color:#444;">ملاحظات: ` + esc(d.Notes) + `</div>`)
	}

	b.WriteString(`<div class="sigs">`)
	b.WriteString(`<div class="sig"><div class="line"></div>` + esc(sigLine(d.SigLeft)) + `</div>`)
	b.WriteString(`<div class="sig"><div class="line"></div>` + esc(sigLine(d.SigRight)) + `</div>`)
	b.WriteString(`</div>`)

	b.WriteString(`<div class="foot"><div>` + esc(d.Footer) + `<br>UUID: ` + esc(d.UUID) + `</div>`)
	if d.QR != "" {
		b.WriteString(`<img class="qr" src="` + esc(d.QR) + `" alt="QR">`)
	}
	b.WriteString(`</div>`)
	b.WriteString(`</div></body></html>`)
	return b.String()
}

// sigLine shows the Arabic label of an "AR|EN" signature setting.
func sigLine(s string) string {
	if s == "" {
		return ""
	}
	parts := strings.SplitN(s, "|", 2)
	return parts[0]
}
