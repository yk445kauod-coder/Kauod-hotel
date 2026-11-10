package ui

import (
	"fmt"
	"strings"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"
)

var syncLog *walk.TextEdit

func (a *App) syncPage() []Widget {
	return []Widget{
		Composite{Layout: VBox{Margins: Margins{14, 14, 14, 14}, Spacing: 8}, Children: []Widget{
			Label{Text: "حالة الاتصال والبيانات المحلية"},
			Label{AssignTo: &a.syncLbl},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				PushButton{Text: "تحديث الحالة", OnClicked: func() { a.updateSyncLabel(); a.refreshSyncLog() }},
				PushButton{Text: "مزامنة الآن", OnClicked: a.doSync},
				PushButton{Text: "حجز أرقام للعمل بدون إنترنت", OnClicked: a.reserveNumbers},
			}},
			TextEdit{AssignTo: &syncLog, ReadOnly: true, VScroll: true, HScroll: true, MinSize: Size{700, 320}},
		}},
	}
}

func (a *App) refreshSyncLog() {
	if syncLog == nil {
		return
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("الخادم: %s\n", a.api.BaseURL))
	b.WriteString(fmt.Sprintf("المستخدم: %s (%s)\n", a.sess.Name, a.role()))
	b.WriteString(fmt.Sprintf("معرّف الجهاز: %s\n", a.eng.DeviceID()))
	b.WriteString(fmt.Sprintf("أرقام محجوزة متاحة: %d\n", a.store.RemainingNumbers()))
	b.WriteString(fmt.Sprintf("عمليات معلّقة في صندوق الصادر: %d\n\n", a.store.OutboxCount()))
	ops, _ := a.store.OutboxList()
	for _, op := range ops {
		b.WriteString(fmt.Sprintf("#%d %s %s (%s)\n", op.Seq, op.Method, op.Path, op.CreatedAt))
	}
	if len(ops) == 0 {
		b.WriteString("لا توجد عمليات معلّقة.\n")
	}
	syncLog.SetText(b.String())
}

// reserveNumbers asks the server for an offline number block.
func (a *App) reserveNumbers() {
	if !a.online() {
		a.warn("تحتاج اتصالًا بالإنترنت لحجز أرقام جديدة")
		return
	}
	if err := a.eng.EnsureBlock(a.eng.DeviceID(), 100); err != nil {
		a.fail("تعذّر حجز الأرقام: " + friendlyErr(err))
		return
	}
	a.info("تم حجز أرقام للعمل بدون إنترنت")
	a.updateSyncLabel()
	a.refreshSyncLog()
}
