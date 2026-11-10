// Package api is the HTTP client for the Cloudflare Worker. It keeps a cookie
// jar (the session cookie is HttpOnly) and echoes the CSRF token on writes,
// exactly like the browser SPA does.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
)

// Client talks to the Worker API.
type Client struct {
	BaseURL string
	http    *http.Client
	csrf    string
	jar     http.CookieJar
}

// New builds a client for baseURL (e.g. https://kaoud-hotel-api...workers.dev).
func New(baseURL string) *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		jar:     jar,
		http:    &http.Client{Jar: jar, Timeout: 20 * time.Second},
	}
}

// APIError is a non-2xx response from the server.
type APIError struct {
	Status  int
	Code    string
	Message string
	Details []string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%d %s", e.Status, e.Code)
	}
	return fmt.Sprintf("%d %s", e.Status, e.Message)
}

func (c *Client) do(method, path string, body interface{}, out interface{}) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		if c.csrf != "" {
			req.Header.Set("X-CSRF-Token", c.csrf)
		}
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)

	if res.StatusCode >= 400 {
		var e model.ErrorResponse
		_ = json.Unmarshal(data, &e)
		return &APIError{Status: res.StatusCode, Code: e.Error, Message: e.Message, Details: e.Details}
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return err
		}
	}
	return nil
}

// Csrf returns the current CSRF token.
func (c *Client) Csrf() string { return c.csrf }

// Health checks connectivity to the Worker.
func (c *Client) Health(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/api/health", nil)
	if err != nil {
		return false
	}
	res, err := c.http.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == http.StatusOK
}

// CookieHeader serialises the jar's cookies for this host (persisted between runs).
func (c *Client) CookieHeader() string {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return ""
	}
	var parts []string
	for _, ck := range c.jar.Cookies(u) {
		parts = append(parts, ck.Name+"="+ck.Value)
	}
	return strings.Join(parts, "; ")
}

// LoadCookies restores cookies from a header string and sets the CSRF token.
func (c *Client) LoadCookies(header, csrf string) {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return
	}
	var cookies []*http.Cookie
	for _, kv := range strings.Split(header, ";") {
		kv = strings.TrimSpace(kv)
		if kv == "" {
			continue
		}
		i := strings.IndexByte(kv, '=')
		if i < 0 {
			continue
		}
		cookies = append(cookies, &http.Cookie{Name: kv[:i], Value: kv[i+1:], Path: "/", Secure: true})
	}
	c.jar.SetCookies(u, cookies)
	c.csrf = csrf
}

// ---- auth ----

// Login authenticates and stores the CSRF token from the response body.
func (c *Client) Login(username, password string) (model.LoginResponse, error) {
	var out model.LoginResponse
	err := c.do(http.MethodPost, "/api/auth/login",
		map[string]string{"username": username, "password": password}, &out)
	if err == nil {
		c.csrf = out.Csrf
	}
	return out, err
}

// Logout ends the session.
func (c *Client) Logout() error {
	err := c.do(http.MethodPost, "/api/auth/logout", nil, nil)
	c.csrf = ""
	return err
}

// Me returns the current user and refreshes the CSRF token.
func (c *Client) Me() (model.LoginResponse, error) {
	var out model.LoginResponse
	err := c.do(http.MethodGet, "/api/me", nil, &out)
	if err == nil && out.Csrf != "" {
		c.csrf = out.Csrf
	}
	return out, err
}

// ---- reads ----

func (c *Client) Settings() (model.Settings, error) {
	var out model.SettingsResponse
	err := c.do(http.MethodGet, "/api/settings", nil, &out)
	return out.Settings, err
}

func (c *Client) Invoices(query string) (model.InvoiceList, error) {
	var out model.InvoiceList
	p := "/api/invoices"
	if query != "" {
		p += "?" + query
	}
	err := c.do(http.MethodGet, p, nil, &out)
	return out, err
}

func (c *Client) Invoice(id string) (model.InvoiceResponse, error) {
	var out model.InvoiceResponse
	err := c.do(http.MethodGet, "/api/invoices/"+id, nil, &out)
	return out, err
}

func (c *Client) Payments(invoiceID string) (model.PaymentsResponse, error) {
	var out model.PaymentsResponse
	err := c.do(http.MethodGet, "/api/invoices/"+invoiceID+"/payments", nil, &out)
	return out, err
}

func (c *Client) Rooms() (model.RoomsResponse, error) {
	var out model.RoomsResponse
	err := c.do(http.MethodGet, "/api/rooms", nil, &out)
	return out, err
}

func (c *Client) Guests() (model.GuestsResponse, error) {
	var out model.GuestsResponse
	err := c.do(http.MethodGet, "/api/guests", nil, &out)
	return out, err
}

func (c *Client) Users() (model.UsersResponse, error) {
	var out model.UsersResponse
	err := c.do(http.MethodGet, "/api/users", nil, &out)
	return out, err
}

func (c *Client) Summary() (model.Summary, error) {
	var out model.Summary
	err := c.do(http.MethodGet, "/api/reports/summary", nil, &out)
	return out, err
}

// Print fetches the print payload (calc, issuer, QR) for a locked invoice.
func (c *Client) Print(invoiceID string) (model.PrintResponse, error) {
	var out model.PrintResponse
	err := c.do(http.MethodGet, "/api/invoices/"+invoiceID+"/print", nil, &out)
	return out, err
}

// NextSerial asks the server for the next single serial (online path).
func (c *Client) NextSerial() (int, error) {
	var out struct {
		NextSerial int `json:"nextSerial"`
	}
	err := c.do(http.MethodGet, "/api/invoices/next-serial", nil, &out)
	return out.NextSerial, err
}

// ---- writes ----

func (c *Client) UpdateSettings(body interface{}) (model.Settings, error) {
	var out model.SettingsResponse
	err := c.do(http.MethodPut, "/api/settings", body, &out)
	return out.Settings, err
}

func (c *Client) CreateInvoice(body interface{}) (model.InvoiceResponse, error) {
	var out model.InvoiceResponse
	err := c.do(http.MethodPost, "/api/invoices", body, &out)
	return out, err
}

func (c *Client) UpdateInvoice(id string, body interface{}) (model.InvoiceResponse, error) {
	var out model.InvoiceResponse
	err := c.do(http.MethodPut, "/api/invoices/"+id, body, &out)
	return out, err
}

func (c *Client) LockInvoice(id string) error {
	return c.do(http.MethodPost, "/api/invoices/"+id+"/lock", nil, nil)
}

func (c *Client) CancelInvoice(id, reason string) error {
	return c.do(http.MethodPost, "/api/invoices/"+id+"/cancel", map[string]string{"reason": reason}, nil)
}

func (c *Client) AddPayment(invoiceID string, body interface{}) error {
	return c.do(http.MethodPost, "/api/invoices/"+invoiceID+"/payments", body, nil)
}

// ReserveSerials asks the server for a block of offline serial numbers.
func (c *Client) ReserveSerials(deviceID string, size int) (model.SerialReserveResponse, error) {
	var out model.SerialReserveResponse
	err := c.do(http.MethodPost, "/api/serial/reserve",
		map[string]interface{}{"deviceId": deviceID, "size": size}, &out)
	return out, err
}

// DoRaw performs an arbitrary request (used by the sync engine to replay the outbox).
func (c *Client) DoRaw(method, path string, body json.RawMessage, out interface{}) error {
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, reader)
	if err != nil {
		return err
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead && c.csrf != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		var e model.ErrorResponse
		_ = json.Unmarshal(data, &e)
		return &APIError{Status: res.StatusCode, Code: e.Error, Message: e.Message, Details: e.Details}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}
