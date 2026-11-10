// Package model holds the JSON shapes exchanged with the Worker API and stored
// locally. Server DB rows are snake_case; computed envelopes are camelCase —
// both are mirrored exactly so the desktop and cloud agree.
package model

type User struct {
	ID          string `json:"id"`
	TenantID    string `json:"tenantId,omitempty"`
	Username    string `json:"username"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Active      int    `json:"active,omitempty"`
	IsOwner     bool   `json:"isOwner"`
	CreatedAt   string `json:"created_at,omitempty"`
	LastLoginAt string `json:"last_login_at,omitempty"`
}

type Invoice struct {
	ID             string   `json:"id"`
	TenantID       string   `json:"tenant_id,omitempty"`
	Serial         int      `json:"serial"`
	UUID           string   `json:"uuid"`
	GuestID        string   `json:"guest_id,omitempty"`
	GuestName      string   `json:"guest_name"`
	ReceiverTaxID  string   `json:"receiver_tax_id"`
	RoomNumber     string   `json:"room_number"`
	CheckIn        *string  `json:"check_in"`
	CheckOut       *string  `json:"check_out"`
	Status         string   `json:"status"`
	IssuedAt       string   `json:"issued_at"`
	SubtotalNet    string   `json:"subtotal_net"`
	SubtotalGross  string   `json:"subtotal_gross"`
	TaxTotal       string   `json:"tax_total"`
	Discount       string   `json:"discount"`
	Total          string   `json:"total"`
	Notes          string   `json:"notes"`
	VatRate        *float64 `json:"vat_rate"`
	DiscountRate   *float64 `json:"discount_rate"`
	IssuerName     *string  `json:"issuer_name"`
	IssuerTaxID    *string  `json:"issuer_tax_id"`
	IssuerAddress  *string  `json:"issuer_address"`
	EtaUUID        *string  `json:"eta_uuid"`
	EtaStatus      string   `json:"eta_status"`
	EtaSubmittedAt *string  `json:"eta_submitted_at"`
	EtaError       *string  `json:"eta_error"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	LockedAt       *string  `json:"locked_at"`
	CancelledAt    *string  `json:"cancelled_at"`
}

type InvoiceLine struct {
	ID          string  `json:"id"`
	InvoiceID   string  `json:"invoice_id,omitempty"`
	TenantID    string  `json:"tenant_id,omitempty"`
	Description string  `json:"description"`
	Qty         float64 `json:"qty"`
	UnitPrice   string  `json:"unit_price"`
	Kind        string  `json:"kind"`
	Gross       string  `json:"gross"`
	Net         string  `json:"net"`
	Tax         string  `json:"tax"`
	Position    int     `json:"position"`
}

type Payment struct {
	ID        string `json:"id"`
	TenantID  string `json:"tenant_id,omitempty"`
	InvoiceID string `json:"invoice_id"`
	Amount    string `json:"amount"`
	Method    string `json:"method"`
	Reference string `json:"reference"`
	PaidAt    string `json:"paid_at"`
	CreatedBy string `json:"created_by,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
}

type Settings struct {
	TenantID              string  `json:"tenant_id,omitempty"`
	HotelName             string  `json:"hotel_name"`
	HotelNameEn           string  `json:"hotel_name_en"`
	TaxRegistrationNumber string  `json:"tax_registration_number"`
	CommercialRegister    string  `json:"commercial_register"`
	ActivityCode          string  `json:"activity_code"`
	Address               string  `json:"address"`
	City                  string  `json:"city"`
	Phone                 string  `json:"phone"`
	Email                 string  `json:"email"`
	VatRate               float64 `json:"vat_rate"`
	DiscountRate          float64 `json:"discount_rate"`
	PricesIncludeTax      int     `json:"prices_include_tax"`
	SerialStart           int     `json:"serial_start"`
	Currency              string  `json:"currency"`
	UpdatedAt             string  `json:"updated_at,omitempty"`
	LogoData              string  `json:"logo_data"`
	SignatureLeft         string  `json:"signature_left"`
	SignatureRight        string  `json:"signature_right"`
	FooterNote            string  `json:"footer_note"`
}

type Room struct {
	ID          string `json:"id"`
	TenantID    string `json:"tenant_id,omitempty"`
	Number      string `json:"number"`
	Type        string `json:"type"`
	NightlyRate string `json:"nightly_rate"`
	Capacity    int    `json:"capacity"`
	Active      int    `json:"active"`
}

type Guest struct {
	ID        string `json:"id"`
	TenantID  string `json:"tenant_id,omitempty"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Email     string `json:"email"`
	TaxID     string `json:"tax_id"`
	Address   string `json:"address"`
	CreatedAt string `json:"created_at,omitempty"`
}

// ---- computed envelopes (camelCase) ----

type Issuer struct {
	Name    string `json:"name"`
	TaxID   string `json:"taxId"`
	Address string `json:"address"`
	City    string `json:"city"`
}

type CalcLine struct {
	Description string  `json:"description"`
	Qty         float64 `json:"qty"`
	UnitPrice   string  `json:"unitPrice"`
	Gross       string  `json:"gross"`
	Net         string  `json:"net"`
	Tax         string  `json:"tax"`
}

type Calc struct {
	Lines         []CalcLine `json:"lines"`
	Nights        int        `json:"nights"`
	SubtotalNet   string     `json:"subtotalNet"`
	SubtotalGross string     `json:"subtotalGross"`
	TaxTotal      string     `json:"taxTotal"`
	Discount      string     `json:"discount"`
	Total         string     `json:"total"`
	VatRate       float64    `json:"vatRate"`
	DiscountRate  float64    `json:"discountRate"`
}

type LoginResponse struct {
	User User   `json:"user"`
	Csrf string `json:"csrf"`
}

type InvoiceList struct {
	Invoices []Invoice `json:"invoices"`
	Total    int       `json:"total"`
	Limit    int       `json:"limit"`
	Offset   int       `json:"offset"`
}

type InvoiceResponse struct {
	Invoice Invoice       `json:"invoice"`
	Lines   []InvoiceLine `json:"lines"`
	Paid    string        `json:"paid,omitempty"`
}

type PrintResponse struct {
	Invoice       Invoice       `json:"invoice"`
	Lines         []InvoiceLine `json:"lines"`
	Calc          Calc          `json:"calc"`
	Settings      Settings      `json:"settings"`
	Paid          string        `json:"paid"`
	Qr            string        `json:"qr"`
	Issuer        Issuer        `json:"issuer"`
	EtaIssues     []string      `json:"etaIssues"`
	EtaConfigured bool          `json:"etaConfigured"`
}

type SettingsResponse struct {
	Settings Settings `json:"settings"`
}

type RoomsResponse struct {
	Rooms []Room `json:"rooms"`
}

type GuestsResponse struct {
	Guests []Guest `json:"guests"`
}

type UsersResponse struct {
	Users []User `json:"users"`
}

type PaymentsResponse struct {
	Payments []Payment `json:"payments"`
	Paid     string    `json:"paid"`
}

type Summary struct {
	Count       int    `json:"count"`
	Valid       int    `json:"valid"`
	Cancelled   int    `json:"cancelled"`
	LastSerial  *int   `json:"lastSerial"`
	Total       string `json:"total"`
	Tax         string `json:"tax"`
	Discount    string `json:"discount"`
	Net         string `json:"net"`
	Paid        string `json:"paid"`
	Outstanding string `json:"outstanding"`
}

type SerialReserveResponse struct {
	DeviceID string `json:"deviceId"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
	Next     int    `json:"next"`
}

type ErrorResponse struct {
	Error   string   `json:"error"`
	Message string   `json:"message"`
	Details []string `json:"details"`
}
