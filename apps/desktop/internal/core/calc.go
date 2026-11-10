package core

import (
	"math"
	"time"
)

type LineKind string

const (
	KindRoom       LineKind = "room"
	KindRestaurant LineKind = "restaurant"
	KindMinibar    LineKind = "minibar"
	KindLaundry    LineKind = "laundry"
	KindExtra      LineKind = "extra"
)

type LineItem struct {
	Description string
	Qty         float64
	UnitPrice   string
	Kind        LineKind
}

type InvoiceInput struct {
	GuestName       string
	RoomNumber      string
	CheckIn         string
	CheckOut        string
	Lines           []LineItem
	DiscountPercent float64
	HasDiscount     bool // applyDiscount present
	ApplyDiscount   bool
	Notes           string
}

type TaxConfig struct {
	VatRate         float64
	DiscountRate    float64
	PricesIncludeTax bool
}

type LineResult struct {
	Description string  `json:"description"`
	Qty         float64 `json:"qty"`
	UnitPrice   string  `json:"unitPrice"`
	Gross       string  `json:"gross"`
	Net         string  `json:"net"`
	Tax         string  `json:"tax"`
}

type CalcResult struct {
	Lines         []LineResult `json:"lines"`
	Nights        int          `json:"nights"`
	SubtotalNet   string       `json:"subtotalNet"`
	SubtotalGross string       `json:"subtotalGross"`
	TaxTotal      string       `json:"taxTotal"`
	Discount      string       `json:"discount"`
	Total         string       `json:"total"`
	VatRate       float64      `json:"vatRate"`
	DiscountRate  float64      `json:"discountRate"`
}

// NightsBetween counts whole nights between two ISO dates; 0 on bad input.
func NightsBetween(checkIn, checkOut string) int {
	if checkIn == "" || checkOut == "" {
		return 0
	}
	a, err1 := time.Parse("2006-01-02", checkIn)
	b, err2 := time.Parse("2006-01-02", checkOut)
	if err1 != nil || err2 != nil {
		return 0
	}
	d := int(math.Round(b.Sub(a).Hours() / 24))
	if d > 0 {
		return d
	}
	return 0
}

// CalcInvoice mirrors calcInvoice() in packages/core/src/calc.ts.
// Prices are tax-inclusive by default; the invariant
// net + tax - discount == total always holds.
func CalcInvoice(in InvoiceInput, cfg TaxConfig) CalcResult {
	vatRate := math.Max(0, cfg.VatRate)
	discountRate := cfg.DiscountRate
	if in.HasDiscount && !in.ApplyDiscount {
		discountRate = 0
	}
	discountRate = math.Max(0, discountRate)

	lines := make([]LineResult, 0, len(in.Lines))
	var subGross, subNet, taxTotal int64

	for _, li := range in.Lines {
		qty := li.Qty
		unitM, err := ParseMoney(li.UnitPrice)
		if err != nil {
			unitM = 0
		}
		grossM := int64(math.Round(qty * float64(unitM)))
		var netM, taxM int64
		if cfg.PricesIncludeTax {
			netM = MulDiv(grossM, 100, 100+int64(math.Round(vatRate)))
			taxM = grossM - netM
		} else {
			netM = grossM
			taxM = MulDiv(netM, int64(math.Round(vatRate)), 100)
		}
		subGross += grossM
		subNet += netM
		taxTotal += taxM
		lines = append(lines, LineResult{
			Description: li.Description,
			Qty:         qty,
			UnitPrice:   FormatMoney(unitM),
			Gross:       FormatMoney(Minor(grossM)),
			Net:         FormatMoney(Minor(netM)),
			Tax:         FormatMoney(Minor(taxM)),
		})
	}

	discountM := MulDiv(subNet, int64(math.Round(discountRate*100)), 10_000)
	totalM := subNet + taxTotal - discountM

	return CalcResult{
		Lines:         lines,
		Nights:        NightsBetween(in.CheckIn, in.CheckOut),
		SubtotalNet:   FormatMoney(Minor(subNet)),
		SubtotalGross: FormatMoney(Minor(subGross)),
		TaxTotal:      FormatMoney(Minor(taxTotal)),
		Discount:      FormatMoney(Minor(discountM)),
		Total:         FormatMoney(Minor(totalM)),
		VatRate:       vatRate,
		DiscountRate:  discountRate,
	}
}
