package core

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

// UUIDv4 returns a random RFC-4122 v4 UUID.
func UUIDv4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
}

type EtaAddress struct {
	Country        string `json:"country"`
	Governate      string `json:"governate"`
	RegionCity     string `json:"regionCity"`
	Street         string `json:"street"`
	BuildingNumber string `json:"buildingNumber"`
}

type EtaParty struct {
	Type    string     `json:"type"`
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Address EtaAddress `json:"address"`
}

type EtaTaxableItem struct {
	TaxType string `json:"taxType"`
	Amount  string `json:"amount"`
	Rate    string `json:"rate"`
}

type EtaLine struct {
	Description   string           `json:"description"`
	ItemType      string           `json:"itemType"`
	ItemCode      string           `json:"itemCode"`
	UnitType      string           `json:"unitType"`
	Quantity      float64          `json:"quantity"`
	UnitValue     EtaUnitValue     `json:"unitValue"`
	SalesTotal    string           `json:"salesTotal"`
	Discount      EtaDiscount      `json:"discount"`
	NetTotal      string           `json:"netTotal"`
	Total         string           `json:"total"`
	TaxableItems  []EtaTaxableItem `json:"taxableItems"`
}

type EtaUnitValue struct {
	CurrencySold string `json:"currencySold"`
	AmountEGP    string `json:"amountEGP"`
}

type EtaDiscount struct {
	Rate   string `json:"rate"`
	Amount string `json:"amount"`
}

type EtaDocument struct {
	Issuer                  EtaParty         `json:"issuer"`
	Receiver                EtaParty         `json:"receiver"`
	DocumentType            string           `json:"documentType"`
	DocumentTypeVersion     string           `json:"documentTypeVersion"`
	DateTimeIssued          string           `json:"dateTimeIssued"`
	TaxpayerActivityCode    string           `json:"taxpayerActivityCode"`
	InternalID              string           `json:"internalID"`
	InvoiceLines            []EtaLine        `json:"invoiceLines"`
	TotalDiscountAmount     string           `json:"totalDiscountAmount"`
	TotalSalesAmount        string           `json:"totalSalesAmount"`
	NetAmount               string           `json:"netAmount"`
	TaxTotals               []EtaTaxableItem `json:"taxTotals"`
	TotalAmount             string           `json:"totalAmount"`
	ExtraDiscountAmount     string           `json:"extraDiscountAmount"`
	TotalItemsDiscountAmount string          `json:"totalItemsDiscountAmount"`
}

type EtaIssuerConfig struct {
	TaxRegistrationNumber string
	Name                  string
	Address               EtaAddress
	ActivityCode          string
}

type BuildEtaArgs struct {
	Serial         int
	IssuedAt       string
	ReceiverName   string
	ReceiverTaxID  string
	Calc           CalcResult
	Issuer         EtaIssuerConfig
	TaxType        string
}

func to2(s string) string {
	m, err := ParseMoney(s)
	if err != nil {
		return "0.00"
	}
	return FormatMoney(m)
}

// BuildEtaDocument mirrors buildEtaDocument() in packages/core/src/eta.ts.
func BuildEtaDocument(a BuildEtaArgs) EtaDocument {
	taxType := a.TaxType
	if taxType == "" {
		taxType = "T1"
	}
	rate := fmt.Sprintf("%g", a.Calc.VatRate)

	lines := make([]EtaLine, 0, len(a.Calc.Lines))
	for _, l := range a.Calc.Lines {
		unit := l.Net
		if a.Calc.VatRate > 0 {
			unit = l.Gross
		}
		code := "KH-" + etaCodeSeed(l.Description)
		amountEGP := "0.00"
		if l.Qty != 0 {
			amountEGP = fmt.Sprintf("%.2f", num(unit)/l.Qty)
		}
		lines = append(lines, EtaLine{
			Description: l.Description,
			ItemType:    "EGS",
			ItemCode:    code,
			UnitType:    "EA",
			Quantity:    l.Qty,
			UnitValue:   EtaUnitValue{CurrencySold: "EGP", AmountEGP: amountEGP},
			SalesTotal:  fmt.Sprintf("%.2f", num(l.Gross)),
			Discount:    EtaDiscount{Rate: "0", Amount: "0.00"},
			NetTotal:    l.Net,
			Total:       l.Gross,
			TaxableItems: []EtaTaxableItem{
				{TaxType: taxType, Amount: to2(l.Tax), Rate: rate},
			},
		})
	}

	recvType := "P"
	recvID := "000000000"
	if a.ReceiverTaxID != "" {
		recvType = "B"
		recvID = a.ReceiverTaxID
	}

	return EtaDocument{
		Issuer: EtaParty{Type: "B", ID: a.Issuer.TaxRegistrationNumber, Name: a.Issuer.Name, Address: a.Issuer.Address},
		Receiver: EtaParty{Type: recvType, ID: recvID, Name: a.ReceiverName,
			Address: EtaAddress{Country: "EG", Governate: "Alexandria", RegionCity: "Alexandria", Street: "-", BuildingNumber: "-"}},
		DocumentType:        "I",
		DocumentTypeVersion: "1.0",
		DateTimeIssued:      a.IssuedAt,
		TaxpayerActivityCode: a.Issuer.ActivityCode,
		InternalID:          fmt.Sprintf("%d", a.Serial),
		InvoiceLines:        lines,
		TotalDiscountAmount: to2(a.Calc.Discount),
		TotalSalesAmount:    a.Calc.SubtotalGross,
		NetAmount:           a.Calc.SubtotalNet,
		TaxTotals:           []EtaTaxableItem{{TaxType: taxType, Amount: a.Calc.TaxTotal, Rate: rate}},
		TotalAmount:         a.Calc.Total,
		ExtraDiscountAmount: "0.00",
		TotalItemsDiscountAmount: "0.00",
	}
}

func num(s string) float64 {
	m, err := ParseMoney(s)
	if err != nil {
		return 0
	}
	return float64(m)
}

// etaCodeSeed mirrors `description.slice(0,4).toUpperCase().replace(/[^A-Z0-9]/g,'') || 'ITEM'`.
func etaCodeSeed(desc string) string {
	r := []rune(desc)
	if len(r) > 4 {
		r = r[:4]
	}
	var b strings.Builder
	for _, c := range r {
		if c >= 'a' && c <= 'z' {
			c = c - 'a' + 'A'
		}
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		}
	}
	if b.Len() == 0 {
		return "ITEM"
	}
	return b.String()
}

type QrFields struct {
	SellerName string
	VatNumber  string
	IssuedAt   string
	Total      string
	VatTotal   string
	UUID       string
}

// EtaQrPayload returns base64 of the ETA TLV (tags 1..6).
func EtaQrPayload(f QrFields) string {
	fields := []struct {
		tag   byte
		value string
	}{
		{1, f.SellerName}, {2, f.VatNumber}, {3, f.IssuedAt},
		{4, f.Total}, {5, f.VatTotal}, {6, f.UUID},
	}
	var out []byte
	for _, fl := range fields {
		v := []byte(fl.value)
		if len(v) > 255 {
			continue
		}
		out = append(out, fl.tag, byte(len(v)))
		out = append(out, v...)
	}
	return base64.StdEncoding.EncodeToString(out)
}

type EtaIssue struct {
	Path    string
	Message string
}

// ValidateEtaDocument mirrors validateEtaDocument() in TS.
func ValidateEtaDocument(doc EtaDocument) []EtaIssue {
	var issues []EtaIssue
	req := func(cond bool, path, msg string) {
		if !cond {
			issues = append(issues, EtaIssue{path, msg})
		}
	}
	req(isDigits(doc.Issuer.ID, 9), "issuer.id", "issuer tax registration number must be 9 digits")
	req(len(doc.Issuer.Name) > 0, "issuer.name", "issuer name is required")
	req(isDigits(doc.TaxpayerActivityCode, 4), "taxpayerActivityCode", "activity code must be 4 digits")
	req(len(doc.InvoiceLines) > 0, "invoiceLines", "at least one line is required")
	req(doc.DateTimeIssued != "", "dateTimeIssued", "issued datetime must be valid")

	net := num(doc.NetAmount)
	var tax float64
	for _, t := range doc.TaxTotals {
		tax += num(t.Amount)
	}
	disc := num(doc.TotalDiscountAmount)
	expected := net + tax - disc
	req(abs(expected-num(doc.TotalAmount)) < 0.01, "totalAmount",
		fmt.Sprintf("totalAmount (%s) must equal netAmount + tax - discount (%.2f)", doc.TotalAmount, expected))
	var first float64
	if len(doc.TaxTotals) > 0 {
		first = num(doc.TaxTotals[0].Amount)
	}
	req(abs(tax-first) < 0.01, "taxTotals", "tax totals must be consistent")
	return issues
}

func isDigits(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}
