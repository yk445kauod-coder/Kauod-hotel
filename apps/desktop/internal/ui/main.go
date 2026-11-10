package ui

import (
	"context"
	"fmt"
	"time"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/model"
)

// runMain builds and shows the main window, then blocks until it is closed.
func (a *App) runMain() error {
	a.refreshTable()
	a.updateSyncLabel()

	mw := MainWindow{
		AssignTo:          &a.mw,
		Title:             "فندق قاعود — الفواتير",
		Size:              Size{1100, 720},
		MinSize:           Size{900, 600},
		Layout:            VBox{MarginsZero: true, SpacingZero: true},
		RightToLeftLayout: true,
		Children: []Widget{
			a.buildToolbar(),
			TabWidget{
				AssignTo: &a.tab,
				Pages: []TabPage{
					{Title: "الفواتير", Layout: VBox{}, Children: a.invoicesPage()},
					{Title: "الإعدادات", Layout: VBox{}, Children: a.settingsPage()},
					{Title: "حالة المزامنة", Layout: VBox{}, Children: a.syncPage()},
				},
			},
			a.buildStatusBar(),
		},
	}
	if err := mw.Create(); err != nil {
		return err
	}
	// Refresh from the server shortly after start (non-blocking).
	go func() {
		time.Sleep(500 * time.Millisecond)
		a.doPull()
	}()
	a.mw.Run()
	return nil
}

func (a *App) buildToolbar() Widget {
	return Composite{
		Layout: HBox{Margins: Margins{8, 8, 8, 4}, Spacing: 6},
		Children: []Widget{
			PushButton{Text: "فاتورة جديدة", OnClicked: a.newInvoice},
			PushButton{Text: "فتح / تعديل", OnClicked: a.openSelected},
			PushButton{Text: "قفل", OnClicked: a.lockSelected},
			PushButton{Text: "إلغاء الفاتورة", OnClicked: a.cancelSelected},
			PushButton{Text: "تسجيل دفعة", OnClicked: a.paySelected},
			PushButton{Text: "طباعة", OnClicked: a.printSelected},
			VSpacer{},
			PushButton{Text: "مزامنة الآن", OnClicked: a.doSync},
			Label{Text: "بحث:"},
			LineEdit{AssignTo: &a.searchBox, MinSize: Size{200, 0}, OnTextChanged: func() { a.refreshTable() }},
		},
	}
}

func (a *App) invoicesPage() []Widget {
	return []Widget{
		TableView{
			AssignTo:             &a.tv,
			AlternatingRowBG:     true,
			ColumnsOrderable:     false,
			ColumnsSizable:       true,
			LastColumnStretched:  true,
			Model:                a.invModel,
			OnItemActivated:      a.openSelected,
			OnCurrentIndexChanged: func() {},
			Columns: []TableViewColumn{
				{Title: "الرقم", Width: 90, Alignment: AlignFar},
				{Title: "العميل", Width: 220},
				{Title: "الغرفة", Width: 80},
				{Title: "الإجمالي", Width: 120, Alignment: AlignFar},
				{Title: "الحالة", Width: 100},
				{Title: "التاريخ", Width: 160},
			},
		},
	}
}

func (a *App) buildStatusBar() Widget {
	return Composite{
		Layout: HBox{Margins: Margins{8, 2, 8, 6}, Spacing: 8},
		Children: []Widget{
			Label{AssignTo: &a.statusLbl, Text: "جاهز"},
			VSpacer{},
			Label{AssignTo: &a.syncLbl, Text: ""},
		},
	}
}

func (a *App) updateSyncLabel() {
	n := a.store.OutboxCount()
	rem := a.store.RemainingNumbers()
	txt := fmt.Sprintf("عمليات معلّقة: %d • أرقام محجوزة متاحة: %d", n, rem)
	if a.online() {
		txt += " • متصل"
	} else {
		txt += " • غير متصل (وضع محلي)"
	}
	a.setSyncStatus(txt)
}

// selectedInvoice returns the invoice highlighted in the table.
func (a *App) selectedInvoice() (model.Invoice, bool) {
	if a.tv == nil {
		return model.Invoice{}, false
	}
	return a.invModel.At(a.tv.CurrentIndex())
}

// ---- toolbar actions ----

func (a *App) openSelected() {
	inv, ok := a.selectedInvoice()
	if !ok {
		a.warn("اختر فاتورة أولًا")
		return
	}
	a.editInvoice(inv)
}

func (a *App) lockSelected() {
	inv, ok := a.selectedInvoice()
	if !ok {
		a.warn("اختر فاتورة أولًا")
		return
	}
	if inv.Status == "locked" {
		a.info("الفاتورة مقفلة بالفعل")
		return
	}
	// Locking must reach the server (it is the send gate). Offline, queue it.
	if a.online() {
		if err := a.api.LockInvoice(inv.ID); err != nil {
			a.fail("تعذّر القفل: " + friendlyErr(err))
			return
		}
		inv.Status = "locked"
		_ = a.store.PutInvoice(inv)
		a.refreshTable()
		a.info("تم قفل الفاتورة " + fmt.Sprintf("%d", inv.Serial))
	} else {
		body := []byte(`{}`)
		_, _ = a.store.Enqueue(outbox("POST", "/api/invoices/"+inv.ID+"/lock", "invoice", inv.ID, body))
		a.info("تم جدولة القفل — سيُنفّذ عند عودة الاتصال")
	}
	a.updateSyncLabel()
}

func (a *App) cancelSelected() {
	inv, ok := a.selectedInvoice()
	if !ok {
		a.warn("اختر فاتورة أولًا")
		return
	}
	if walk.MsgBox(a.mw, "تأكيد", "إلغاء الفاتورة "+fmt.Sprintf("%d", inv.Serial)+"؟", walk.MsgBoxYesNo|walk.MsgBoxIconQuestion) != walk.DlgCmdYes {
		return
	}
	if err := a.api.CancelInvoice(inv.ID, "cancelled at reception"); err != nil {
		a.fail("تعذّر الإلغاء: " + friendlyErr(err))
		return
	}
	inv.Status = "cancelled"
	_ = a.store.PutInvoice(inv)
	a.refreshTable()
	a.info("تم إلغاء الفاتورة")
}

func (a *App) paySelected() {
	inv, ok := a.selectedInvoice()
	if !ok {
		a.warn("اختر فاتورة أولًا")
		return
	}
	a.paymentDialog(inv)
}

func (a *App) printSelected() {
	inv, ok := a.selectedInvoice()
	if !ok {
		a.warn("اختر فاتورة أولًا")
		return
	}
	a.printInvoice(inv)
}

// ---- sync ----

func (a *App) doPull() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := a.eng.Pull(ctx); err != nil {
		a.setStatus("تعذّر التحديث من الخادم (وضع محلي)")
	} else {
		a.setStatus("تم التحديث من الخادم")
	}
	a.refreshTable()
	a.updateSyncLabel()
}

func (a *App) doSync() {
	a.setStatus("جارٍ المزامنة…")
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		// Make sure we have numbers to allocate offline.
		if a.online() {
			_ = a.eng.EnsureBlock(a.eng.DeviceID(), 100)
		}
		res, err := a.eng.Sync(ctx)
		a.mw.Synchronize(func() {
			if err != nil {
				a.setStatus("المزامنة متوقفة — سيُعاد المحاولة")
			} else {
				a.setStatus(fmt.Sprintf("تمت المزامنة: %d عملية، %d فشل", res.Pushed, res.Failed))
			}
			a.refreshTable()
			a.updateSyncLabel()
		})
	}()
}
