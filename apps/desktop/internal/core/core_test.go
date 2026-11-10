package core

import "testing"

func TestParseFormatMoney(t *testing.T) {
	cases := []struct{ in, want string }{
		{"1000", "1000.00"},
		{"1234.567", "1234.57"},
		{"0.005", "0.01"},
		{"-50.25", "-50.25"},
		{"", "0.00"},
		{"1,180.00", "1180.00"},
	}
	for _, c := range cases {
		m, err := ParseMoney(c.in)
		if err != nil {
			t.Fatalf("ParseMoney(%q): %v", c.in, err)
		}
		if got := FormatMoney(m); got != c.want {
			t.Errorf("FormatMoney(ParseMoney(%q)) = %q, want %q", c.in, got, c.want)
		}
	}
}

func input(over func(*InvoiceInput)) InvoiceInput {
	in := InvoiceInput{
		GuestName: "أحمد محمد",
		RoomNumber: "305",
		CheckIn:  "2026-11-05",
		CheckOut: "2026-11-08",
		HasDiscount: true, ApplyDiscount: true,
		Lines: []LineItem{
			{Description: "إقامة غرفة 305", Qty: 3, UnitPrice: "1000.00", Kind: KindRoom},
			{Description: "مطعم", Qty: 1, UnitPrice: "200.00", Kind: KindRestaurant},
			{Description: "ميني بار", Qty: 1, UnitPrice: "100.00", Kind: KindMinibar},
		},
	}
	if over != nil {
		over(&in)
	}
	return in
}

func TestCalcInvariant(t *testing.T) {
	cfg := TaxConfig{VatRate: 14, DiscountRate: 3, PricesIncludeTax: true}
	r := CalcInvoice(input(nil), cfg)
	net, _ := ParseMoney(r.SubtotalNet)
	tax, _ := ParseMoney(r.TaxTotal)
	disc, _ := ParseMoney(r.Discount)
	total, _ := ParseMoney(r.Total)
	if net+tax-disc != total {
		t.Errorf("invariant broken: %d + %d - %d = %d, want %d", net, tax, disc, net+tax-disc, total)
	}
	if r.Nights != 3 {
		t.Errorf("nights = %d, want 3", r.Nights)
	}
}

func TestCalcZeroOverride(t *testing.T) {
	cfg := TaxConfig{VatRate: 0, DiscountRate: 0, PricesIncludeTax: true}
	r := CalcInvoice(input(func(in *InvoiceInput) {
		in.Lines = []LineItem{{Description: "خدمة", Qty: 1, UnitPrice: "1000.00", Kind: KindExtra}}
	}), cfg)
	if r.TaxTotal != "0.00" || r.Discount != "0.00" || r.Total != "1000.00" {
		t.Errorf("0%% override: tax=%s disc=%s total=%s", r.TaxTotal, r.Discount, r.Total)
	}
}

func TestCalcTenPercent(t *testing.T) {
	cfg := TaxConfig{VatRate: 10, DiscountRate: 0, PricesIncludeTax: true}
	r := CalcInvoice(input(func(in *InvoiceInput) {
		in.Lines = []LineItem{{Description: "خدمة", Qty: 1, UnitPrice: "1100.00", Kind: KindExtra}}
	}), cfg)
	if r.TaxTotal != "100.00" {
		t.Errorf("10%% VAT on 1100 inclusive: tax=%s, want 100.00", r.TaxTotal)
	}
	net, _ := ParseMoney(r.SubtotalNet)
	tax, _ := ParseMoney(r.TaxTotal)
	total, _ := ParseMoney(r.Total)
	if net+tax != total {
		t.Errorf("invariant broken at 10%%: %d + %d != %d", net, tax, total)
	}
}

func TestEtaValidatesAndQr(t *testing.T) {
	cfg := TaxConfig{VatRate: 14, DiscountRate: 3, PricesIncludeTax: true}
	calc := CalcInvoice(input(nil), cfg)
	doc := BuildEtaDocument(BuildEtaArgs{
		Serial: 10246, IssuedAt: "2026-11-10T12:00:00", ReceiverName: "أحمد محمد",
		Calc: calc,
		Issuer: EtaIssuerConfig{
			TaxRegistrationNumber: "706904204", Name: "فندق قاعود",
			ActivityCode: "5510",
			Address: EtaAddress{Country: "EG", Governate: "Alexandria", RegionCity: "Alexandria", Street: "سبورتنج", BuildingNumber: "-"},
		},
	})
	if issues := ValidateEtaDocument(doc); len(issues) != 0 {
		t.Fatalf("expected no ETA issues, got %+v", issues)
	}
	qr := EtaQrPayload(QrFields{SellerName: "فندق قاعود", VatNumber: "706904204",
		IssuedAt: "2026-11-10T12:00:00", Total: calc.Total, VatTotal: calc.TaxTotal, UUID: UUIDv4()})
	if len(qr) < 10 {
		t.Errorf("qr payload too short: %q", qr)
	}
}

func TestUUIDv4Format(t *testing.T) {
	u := UUIDv4()
	if len(u) != 36 || u[8] != '-' || u[13] != '-' || u[14] != '4' || u[18] != '-' || u[23] != '-' {
		t.Errorf("bad uuid: %q", u)
	}
}
