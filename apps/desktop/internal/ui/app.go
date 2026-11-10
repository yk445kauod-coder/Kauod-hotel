// Package ui is the native Win32 interface (github.com/lxn/walk) for the hotel
// invoicing client. It runs the whole product offline against the local store
// and syncs with the Cloudflare API when online.
package ui

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/api"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/store"
	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/sync"
)

// DefaultAPI is the production Worker endpoint.
const DefaultAPI = "https://kaoud-hotel-api.yk445kauod.workers.dev"

// App holds the running state of the desktop client.
type App struct {
	store *store.Store
	api   *api.Client
	eng   *sync.Engine
	sess  store.Session

	mw        *walk.MainWindow
	invModel  *invoiceModel
	tv        *walk.TableView
	searchBox *walk.LineEdit
	statusLbl *walk.Label
	syncLbl   *walk.Label
	tab       *walk.TabWidget

	// settings widgets
	setName     *walk.LineEdit
	setNameEn   *walk.LineEdit
	setTaxID    *walk.LineEdit
	setCR       *walk.LineEdit
	setActivity *walk.LineEdit
	setAddress  *walk.LineEdit
	setCity     *walk.LineEdit
	setPhone    *walk.LineEdit
	setEmail    *walk.LineEdit
	setVat      *walk.NumberEdit
	setDiscount *walk.NumberEdit
	setFooter   *walk.LineEdit
	setSigL     *walk.LineEdit
	setSigR     *walk.LineEdit
	logoData    string
}

// DataDir returns the per-user data directory for the local store.
func DataDir() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "KaoudHotel")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kaoudhotel")
}

// Run starts the desktop application and blocks until the window closes.
func Run() error {
	dbPath := filepath.Join(DataDir(), "kaoud.db")
	st, err := store.Open(dbPath)
	if err != nil {
		return err
	}
	defer st.Close()

	base := st.GetMeta("baseUrl")
	if base == "" {
		base = DefaultAPI
	}
	app := &App{
		store:    st,
		api:      api.New(base),
		eng:      nil,
		invModel: &invoiceModel{},
	}
	app.eng = sync.New(st, app.api)

	// Restore a saved session so the app opens offline without a login prompt.
	if sess, ok := st.LoadSession(); ok {
		app.sess = sess
		app.api.LoadCookies(sess.Cookies, sess.Csrf)
	}

	if !app.showLogin() {
		return nil
	}
	return app.runMain()
}

// showLogin runs the login dialog, or returns true immediately if a session
// already exists (offline-friendly).
func (a *App) showLogin() bool {
	if a.sess.Name != "" {
		// Verify in the background; do not block startup if offline.
		go func() {
			if _, err := a.api.Me(); err == nil {
				a.persistSession()
			}
		}()
		return true
	}

	var dlg *walk.Dialog
	var user, pass *walk.LineEdit
	var status *walk.Label
	ok := false

	_, _ = (Dialog{
		AssignTo: &dlg,
		Title:    "دخول — فندق قاعود",
		MinSize:  Size{380, 240},
		Layout:   VBox{Margins: Margins{16, 16, 16, 16}},
		Children: []Widget{
			Label{Text: "اسم المستخدم"},
			LineEdit{AssignTo: &user},
			Label{Text: "كلمة المرور"},
			LineEdit{AssignTo: &pass, PasswordMode: true},
			Label{AssignTo: &status, TextColor: walk.RGB(180, 30, 30)},
			Composite{
				Layout: HBox{},
				Children: []Widget{
					HSpacer{},
					PushButton{Text: "دخول", OnClicked: func() {
						u, p := user.Text(), pass.Text()
						if u == "" || p == "" {
							status.SetText("أدخل اسم المستخدم وكلمة المرور")
							return
						}
						status.SetText("جارٍ الدخول…")
						go func() {
							res, err := a.api.Login(u, p)
							dlg.Synchronize(func() {
								if err != nil {
									status.SetText("فشل الدخول: " + friendlyErr(err))
									return
								}
								a.sess = store.Session{
									BaseURL: a.api.BaseURL, Cookies: a.api.CookieHeader(),
									Csrf: a.api.Csrf(), UserID: res.User.ID, Name: res.User.Name, Role: res.User.Role,
								}
								_ = a.store.SaveSession(a.sess)
								ok = true
								dlg.Accept()
							})
						}()
					}},
					PushButton{Text: "خروج", OnClicked: func() { dlg.Cancel() }},
				},
			},
		},
	}).Run(nil)

	return ok
}

func (a *App) persistSession() {
	a.sess.Cookies = a.api.CookieHeader()
	a.sess.Csrf = a.api.Csrf()
	_ = a.store.SaveSession(a.sess)
}

// ---- helpers ----

func (a *App) info(msg string) {
	walk.MsgBox(a.mw, "معلومة", msg, walk.MsgBoxIconInformation|walk.MsgBoxOK)
}

func (a *App) warn(msg string) {
	walk.MsgBox(a.mw, "تنبيه", msg, walk.MsgBoxIconWarning|walk.MsgBoxOK)
}

func (a *App) fail(msg string) {
	walk.MsgBox(a.mw, "خطأ", msg, walk.MsgBoxIconError|walk.MsgBoxOK)
}

func friendlyErr(err error) string {
	if ae, ok := err.(*api.APIError); ok {
		switch ae.Code {
		case "invalid_credentials":
			return "بيانات الدخول غير صحيحة"
		case "account_disabled":
			return "الحساب معطّل"
		case "rate_limited":
			return "محاولات كثيرة، حاول لاحقًا"
		case "unauthorized", "session_expired":
			return "انتهت الجلسة، سجّل الدخول من جديد"
		}
		return ae.Code
	}
	return "تعذّر الاتصال بالخادم"
}

// online reports whether the API is reachable right now.
func (a *App) online() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	return a.api.Health(ctx)
}

func (a *App) setStatus(s string) {
	if a.statusLbl != nil {
		a.statusLbl.SetText(s)
	}
}

func (a *App) setSyncStatus(s string) {
	if a.syncLbl != nil {
		a.syncLbl.SetText(s)
	}
}

// refreshTable reloads the invoice list from the local store, honouring search.
func (a *App) refreshTable() {
	q := ""
	if a.searchBox != nil {
		q = a.searchBox.Text()
	}
	items, err := a.store.Invoices()
	if err != nil {
		a.fail("تعذّر قراءة البيانات المحلية: " + err.Error())
		return
	}
	if q != "" {
		filtered := items[:0]
		for _, inv := range items {
			if containsAny(inv.GuestName, inv.RoomNumber, fmt.Sprintf("%d", inv.Serial), q) {
				filtered = append(filtered, inv)
			}
		}
		items = filtered
	}
	a.invModel.SetItems(items)
}

func containsAny(a1, a2, a3, needle string) bool {
	return (len(needle) > 0) &&
		(containsFold(a1, needle) || containsFold(a2, needle) || containsFold(a3, needle))
}

func containsFold(haystack, needle string) bool {
	return len(needle) == 0 || indexFold(haystack, needle) >= 0
}

func indexFold(h, n string) int {
	hl, nl := len(h), len(n)
	if nl == 0 {
		return 0
	}
	for i := 0; i+nl <= hl; i++ {
		if equalFold(h[i:i+nl], n) {
			return i
		}
	}
	return -1
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

// currentUserRole returns the cached role, defaulting to admin when unknown.
func (a *App) role() string {
	if a.sess.Role != "" {
		return a.sess.Role
	}
	return "admin"
}

var _ = model.Invoice{}
