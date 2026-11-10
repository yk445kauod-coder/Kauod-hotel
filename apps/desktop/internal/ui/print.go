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
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/webfont"
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
	TotalInWords string
	HotelNameEn  string
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
		TotalInWords: core.Tafqeet(pr.Calc.Total), HotelNameEn: pr.Settings.HotelNameEn,
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
		TotalInWords: core.Tafqeet(calc.Total), HotelNameEn: s.HotelNameEn,
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

// renderInvoiceHTML renders the tax invoice, RTL and print-ready, matching the
// web/WorldClass layout. Fully offline.
func renderInvoiceHTML(d printData) string {
	var b strings.Builder
	b.WriteString(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">`)
	b.WriteString(`<title>فاتورة ` + esc(fmt.Sprintf("%d", d.Serial)) + `</title><style>`)
	b.WriteString(webfont.CSS())
	b.WriteString(`
@page { size: A4; margin: 12mm 12mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "IBM Plex Sans Arabic", "IBM Plex Sans", "Segoe UI", Tahoma, Arial, sans-serif; color:#16202e; margin:0; padding:0; font-size:12.5px; line-height:1.5; }
.sheet { max-width: 210mm; margin: 0 auto; background:#fff; border:1px solid #d7dce3; border-radius:10px; overflow:hidden; }
.bar { height:6px; background: linear-gradient(90deg,#0F2340 0%,#8A6D00 50%,#0F2340 100%); }
.head { display:grid; grid-template-columns:1fr auto 1fr; gap:16px; align-items:start; padding:22px 28px 16px; border-bottom:1px solid #eee; }
.seller { font-size:12.5px; line-height:1.9; color:#111; }
.seller bdi, bdi { direction:ltr; }
.seller .city { margin-top:10px; font-weight:800; font-size:14px; color:#0F2340; }
.brand { text-align:center; }
.logo { height:78px; width:auto; object-fit:contain; }
.hotel { font-size:24px; font-weight:900; color:#0F2340; margin-top:2px; }
.hotel-en { font-size:11.5px; letter-spacing:3px; color:#8A6D00; font-weight:800; }
.meta { text-align:left; }
.doc { background:#0F2340; color:#fff; padding:10px 16px; border-radius:10px; text-align:center; }
.doc .t { font-size:11.5px; letter-spacing:1px; }
.doc .n { font-size:22px; font-weight:900; margin-top:2px; }
.doc .d { text-align:center; margin-top:8px; font-size:12.5px; }
.badge { display:inline-block; margin-top:8px; padding:3px 12px; border-radius:999px; font-size:11px; font-weight:800; background:#fdeaea; color:#a11; border:1px solid #f0b6b6; }
.guest { padding:16px 28px 0; }
.guest-cap { background:#EDE9D0; color:#8A6D00; font-weight:800; font-size:11.5px; letter-spacing:1px; padding:8px 14px; border:1px solid #111; border-bottom:0; border-radius:10px 10px 0 0; }
table.guest-grid { width:100%; border-collapse:collapse; border:1px solid #111; border-radius:0 0 10px 10px; overflow:hidden; font-size:12.5px; }
table.guest-grid td { padding:10px 14px; border-top:1px solid #dcdcdc; vertical-align:top; width:25%; }
table.guest-grid tr:first-child td { border-top:1px solid #111; }
.k { color:#555; font-size:12px; } .k-en { color:#8a8a8a; font-size:10.5px; }
.v { font-size:16px; font-weight:900; color:#000; margin-top:2px; }
.due { background:#0F2340; color:#fff; }
.due .k { color:#cdd6e4; } .due .k-en { color:#9fb0c7; } .due .v { color:#fff; font-size:19px; }
table.lines { width:calc(100% - 56px); margin:16px 28px 0; border-collapse:collapse; font-size:12px; border:1.5px solid #111; border-radius:10px; overflow:hidden; }
table.lines thead th { background:#0F2340; color:#fff; padding:9px 10px; font-size:11px; font-weight:700; line-height:1.25; }
table.lines td { padding:9px 10px; border-bottom:1px solid #e2e7ee; vertical-align:top; }
table.lines tbody tr:nth-child(even) { background:#f8fafc; }
.c-idx { width:34px; text-align:center; color:#7a8798; }
.c-desc { text-align:right; } .c-qty { width:58px; text-align:center; }
.c-unit, .c-net, .c-gross { text-align:left; white-space:nowrap; direction:ltr; font-variant-numeric:tabular-nums; }
tr.sub td { background:#F5F3E6; font-weight:900; border-top:1.5px solid #111; border-bottom:0; }
.lower { display:grid; grid-template-columns:1fr 320px; gap:16px; padding:16px 28px; align-items:start; }
.words-cap { font-size:10.5px; letter-spacing:1.5px; font-weight:800; color:#8A6D00; margin-bottom:4px; }
.words { font-size:12.5px; font-weight:700; background:#F5F3E6; border:1px solid #111; border-radius:10px; padding:10px 12px; }
.notes { margin-top:10px; font-size:11.5px; color:#444; }
table.totals { width:100%; border-collapse:collapse; font-size:13px; background:#F5F3E6; border:1px solid #111; border-radius:10px; overflow:hidden; }
table.totals th { text-align:right; font-weight:700; color:#333; padding:9px 12px; }
table.totals td { text-align:left; font-weight:800; padding:9px 12px; direction:ltr; white-space:nowrap; }
table.totals tr + tr th, table.totals tr + tr td { border-top:1px dashed #cbc7ae; }
tr.grand th, tr.grand td { background:#0F2340; color:#fff; font-size:16px; font-weight:900; border-top:1px solid #111; }
.sigs { display:grid; grid-template-columns:1fr auto 1fr; gap:16px; align-items:end; padding:30px 28px 12px; }
.sig { text-align:center; } .sig .line { border-top:1px solid #111; margin:0 14px 6px; }
.sig .ar { font-weight:800; font-size:12.5px; } .sig .en { font-size:10.5px; color:#5b6b7f; }
.stamp { width:90px; height:90px; border:1px dashed #c7d0dc; border-radius:50%; display:flex; align-items:center; justify-content:center; justify-self:center; font-size:10.5px; color:#9aa6b6; }
.foot { display:flex; gap:16px; align-items:center; padding:14px 28px 22px; border-top:1px solid #eee; }
.qr { text-align:center; } .qr img { width:112px; height:112px; }
.qr-note { font-size:9.5px; color:#5b6b7f; line-height:1.35; margin-top:2px; }
.foot-body { flex:1; font-size:10.5px; color:#5b6b7f; }
.foot-made { color:#9aa6b6; margin-top:4px; }
.cancel { background:#fdeaea; color:#a11; text-align:center; padding:7px; font-weight:800; font-size:12px; }
.noprint { text-align:center; margin:10px 0; }
@media print {
  .noprint { display:none !important; }
  body { background:#fff !important; }
  .sheet { max-width:none !important; width:100%; margin:0 !important; border:0 !important; border-radius:0 !important; }
  * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.lines thead { display:table-header-group; }
  .head, .guest, .lower, .sigs, .foot, table.lines tr { break-inside:avoid; page-break-inside:avoid; }
}
`)
	b.WriteString(`</style></head><body><div class="sheet">`)
	b.WriteString(`<div class="noprint"><button onclick="window.print()" style="padding:8px 20px;font-size:15px;cursor:pointer;">طباعة / حفظ PDF</button></div>`)
	b.WriteString(`<div class="bar"></div>`)
	if d.Status == "cancelled" || d.Status == "ملغية" {
		b.WriteString(`<div class="cancel">هذه الفاتورة ملغية ولا يعتد بها — لا تستخدمها كفاتورة سليمة · CANCELLED</div>`)
	}

	// header
	b.WriteString(`<div class="head">`)
	b.WriteString(`<div class="seller"><div>ب. ض : <bdi>` + esc(d.IssuerTaxID) + `</bdi></div>`)
	if d.City != "" {
		b.WriteString(`<div class="city">` + esc(d.City) + `</div>`)
	}
	b.WriteString(`</div>`)
	b.WriteString(`<div class="brand">`)
	if d.Logo != "" {
		b.WriteString(`<img class="logo" src="` + esc(d.Logo) + `" alt="logo">`)
	}
	b.WriteString(`<div class="hotel">` + esc(d.IssuerName) + `</div>`)
	if en := d.HotelNameEn; en != "" {
		b.WriteString(`<div class="hotel-en">` + esc(en) + `</div>`)
	}
	b.WriteString(`</div>`)
	b.WriteString(`<div class="meta"><div class="doc"><div class="t">فاتورة · INVOICE</div><div class="n">No. <bdi>` + esc(fmt.Sprintf("%d", d.Serial)) + `</bdi></div></div>`)
	b.WriteString(`<div class="d">` + esc(d.IssuedAt) + `</div>`)
	b.WriteString(`<div class="badge">` + esc(payBadge(d)) + `</div></div>`)
	b.WriteString(`</div>`)

	// guest details
	b.WriteString(`<div class="guest"><div class="guest-cap">بيانات النزيل — GUEST DETAILS</div>`)
	b.WriteString(`<table class="guest-grid"><tr>`)
	b.WriteString(`<td><div class="k">اسم النزيل</div><div class="k-en">Guest Name</div><div class="v">` + esc(d.GuestName) + `</div></td>`)
	b.WriteString(`<td><div class="k">رقم الغرفة</div><div class="k-en">Room No.</div><div class="v"><bdi>` + esc(d.RoomNumber) + `</bdi></div></td>`)
	b.WriteString(`<td><div class="k">تاريخ الوصول</div><div class="k-en">Arrival</div><div class="v"><bdi>` + esc(d.CheckIn) + `</bdi></div></td>`)
	b.WriteString(`<td><div class="k">تاريخ المغادرة</div><div class="k-en">Departure</div><div class="v"><bdi>` + esc(d.CheckOut) + `</bdi></div></td>`)
	b.WriteString(`</tr><tr>`)
	b.WriteString(`<td><div class="k">عدد الليالي</div><div class="k-en">Nights</div><div class="v"><bdi>` + esc(fmt.Sprintf("%d", d.Calc.Nights)) + `</bdi> ليلة</div></td>`)
	b.WriteString(`<td><div class="k">تاريخ الفاتورة</div><div class="k-en">Invoice Date</div><div class="v"><bdi>` + esc(d.IssuedAt) + `</bdi></div></td>`)
	b.WriteString(`<td><div class="k">الحالة</div><div class="k-en">Status</div><div class="v">` + esc(statusLabel(d.Status)) + `</div></td>`)
	b.WriteString(`<td class="due"><div class="k">المبلغ المطلوب</div><div class="k-en">Total Due</div><div class="v"><bdi>` + esc(d.Calc.Total) + `</bdi></div></td>`)
	b.WriteString(`</tr></table></div>`)

	// lines
	b.WriteString(`<table class="lines"><thead><tr>`)
	b.WriteString(`<th class="c-idx">#</th><th class="c-desc">البيان / DESCRIPTION</th><th class="c-qty">الكمية<br>Qty</th><th class="c-unit">سعر الوحدة<br>Unit price</th><th class="c-net">مبلغ جزئي<br>Subtotal</th><th class="c-gross">مبلغ كلي<br>Total</th>`)
	b.WriteString(`</tr></thead><tbody>`)
	for i, l := range d.Lines {
		b.WriteString(`<tr>`)
		b.WriteString(`<td class="c-idx">` + esc(fmt.Sprintf("%d", i+1)) + `</td>`)
		b.WriteString(`<td class="c-desc">` + esc(l.Description) + `</td>`)
		b.WriteString(`<td class="c-qty">` + esc(fmt.Sprintf("%g", l.Qty)) + `</td>`)
		b.WriteString(`<td class="c-unit">` + esc(l.UnitPrice) + `</td>`)
		b.WriteString(`<td class="c-net">` + esc(l.Net) + `</td>`)
		b.WriteString(`<td class="c-gross">` + esc(l.Gross) + `</td>`)
		b.WriteString(`</tr>`)
	}
	b.WriteString(`<tr class="sub"><td class="c-desc" colspan="4">إجمالي المبلغ الجزئي / Subtotal</td><td class="c-net">` + esc(d.Calc.SubtotalNet) + `</td><td class="c-gross">` + esc(d.Calc.SubtotalGross) + `</td></tr>`)
	b.WriteString(`</tbody></table>`)

	// words + totals
	b.WriteString(`<div class="lower"><div>`)
	b.WriteString(`<div class="words-cap">المبلغ بالحروف / Amount in words</div><div class="words">` + esc(d.TotalInWords) + `</div>`)
	if d.Notes != "" {
		b.WriteString(`<div class="notes"><div class="words-cap">ملاحظات / Notes</div>` + esc(d.Notes) + `</div>`)
	}
	b.WriteString(`</div><table class="totals">`)
	b.WriteString(`<tr><th>ضريبة القيمة المضافة ` + esc(fmt.Sprintf("%g", d.Calc.VatRate)) + `%</th><td>` + esc(d.Calc.TaxTotal) + `</td></tr>`)
	b.WriteString(`<tr><th>خصم ` + esc(fmt.Sprintf("%g", d.Calc.DiscountRate)) + `%</th><td>` + esc(d.Calc.Discount) + `</td></tr>`)
	if d.Paid != "" && d.Paid != "0.00" && d.Paid != "0" {
		b.WriteString(`<tr><th>المدفوع</th><td>` + esc(d.Paid) + `</td></tr>`)
	}
	b.WriteString(`<tr class="grand"><th>المبلغ المطلوب دفعه</th><td>` + esc(d.Calc.Total) + `</td></tr>`)
	b.WriteString(`</table></div>`)

	// signatures
	b.WriteString(`<div class="sigs">`)
	b.WriteString(`<div class="sig"><div class="line"></div><div class="ar">` + esc(sigOr(d.SigLeft, "المدير المالي")) + `</div><div class="en">Financial Controller</div></div>`)
	b.WriteString(`<div class="stamp">ختم / Stamp</div>`)
	b.WriteString(`<div class="sig"><div class="line"></div><div class="ar">` + esc(sigOr(d.SigRight, "مدير الائتمان")) + `</div><div class="en">Credit Manager</div></div>`)
	b.WriteString(`</div>`)

	// footer
	b.WriteString(`<div class="foot">`)
	if d.QR != "" {
		b.WriteString(`<div class="qr"><img src="` + esc(d.QR) + `" alt="QR"><div class="qr-note">رمز الاستجابة السريعة<br>لمصلحة الضرائب المصرية</div></div>`)
	}
	b.WriteString(`<div class="foot-body">` + esc(d.Footer) + `<br>UUID: <bdi>` + esc(d.UUID) + `</bdi><div class="foot-made">هذه الفاتورة صادرة إلكترونيًا — نظام فواتير فندق قاعود</div></div>`)
	b.WriteString(`</div>`)

	b.WriteString(`</div></body></html>`)
	return b.String()
}

func sigOr(s, fallback string) string {
	if v := sigLine(s); v != "" {
		return v
	}
	return fallback
}

func payBadge(d printData) string {
	total := d.Calc.Total
	paid := d.Paid
	if paid == "" || paid == "0" || paid == "0.00" {
		return "غير مدفوعة"
	}
	if paid == total {
		return "مدفوعة"
	}
	return "مدفوعة جزئيًا"
}

// sigLine shows the Arabic label of an "AR|EN" signature setting.
func sigLine(s string) string {
	if s == "" {
		return ""
	}
	parts := strings.SplitN(s, "|", 2)
	return parts[0]
}
