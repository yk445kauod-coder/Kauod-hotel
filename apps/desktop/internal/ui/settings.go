package ui

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"
)

func (a *App) settingsPage() []Widget {
	s, _ := a.store.Settings()
	a.logoData = s.LogoData
	return []Widget{
		Composite{Layout: VBox{Margins: Margins{14, 14, 14, 14}, Spacing: 6}, Children: []Widget{
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "اسم الفندق"}, LineEdit{AssignTo: &a.setName, Text: s.HotelName, MinSize: Size{240, 0}},
				Label{Text: "الاسم بالإنجليزية"}, LineEdit{AssignTo: &a.setNameEn, Text: s.HotelNameEn, MinSize: Size{220, 0}},
			}},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "الرقم الضريبي (9)"}, LineEdit{AssignTo: &a.setTaxID, Text: s.TaxRegistrationNumber, MinSize: Size{120, 0}},
				Label{Text: "السجل التجاري"}, LineEdit{AssignTo: &a.setCR, Text: s.CommercialRegister, MinSize: Size{120, 0}},
				Label{Text: "كود النشاط (4)"}, LineEdit{AssignTo: &a.setActivity, Text: s.ActivityCode, MinSize: Size{80, 0}},
			}},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "العنوان"}, LineEdit{AssignTo: &a.setAddress, Text: s.Address, MinSize: Size{280, 0}},
				Label{Text: "المدينة"}, LineEdit{AssignTo: &a.setCity, Text: s.City, MinSize: Size{120, 0}},
			}},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "هاتف"}, LineEdit{AssignTo: &a.setPhone, Text: s.Phone, MinSize: Size{140, 0}},
				Label{Text: "بريد"}, LineEdit{AssignTo: &a.setEmail, Text: s.Email, MinSize: Size{200, 0}},
			}},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "نسبة الضريبة %"}, NumberEdit{AssignTo: &a.setVat, Value: s.VatRate, Decimals: 2, MinValue: 0, MaxValue: 100, MinSize: Size{80, 0}},
				Label{Text: "نسبة الخصم %"}, NumberEdit{AssignTo: &a.setDiscount, Value: s.DiscountRate, Decimals: 2, MinValue: 0, MaxValue: 100, MinSize: Size{80, 0}},
			}},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				Label{Text: "توقيع يسار (AR|EN)"}, LineEdit{AssignTo: &a.setSigL, Text: s.SignatureLeft, MinSize: Size{240, 0}},
				Label{Text: "توقيع يمين (AR|EN)"}, LineEdit{AssignTo: &a.setSigR, Text: s.SignatureRight, MinSize: Size{240, 0}},
			}},
			Label{Text: "ملاحظة أسفل الفاتورة"},
			LineEdit{AssignTo: &a.setFooter, Text: s.FooterNote},
			Composite{Layout: HBox{Spacing: 8}, Children: []Widget{
				PushButton{Text: "رفع شعار", OnClicked: a.pickLogo},
				Label{Text: "(PNG/JPG حتى 200 ك.ب)"},
			}},
			Composite{Layout: HBox{}, Children: []Widget{
				VSpacer{},
				PushButton{Text: "حفظ الإعدادات", OnClicked: a.saveSettings},
			}},
		}},
	}
}

// pickLogo reads an image file and stores it as a data URI.
func (a *App) pickLogo() {
	fd := walk.FileDialog{
		Title:  "اختر شعار الفندق",
		Filter: "Images (*.png;*.jpg;*.jpeg)|*.png;*.jpg;*.jpeg",
	}
	if ok, err := fd.ShowOpen(a.mw); err != nil || !ok {
		return
	}
	data, err := os.ReadFile(fd.FilePath)
	if err != nil {
		a.fail("تعذّر قراءة الملف: " + err.Error())
		return
	}
	if len(data) > 200*1024 {
		a.warn("حجم الصورة كبير — استخدم صورة أصغر من 200 ك.ب")
		return
	}
	ext := strings.ToLower(fd.FilePath[strings.LastIndex(fd.FilePath, ".")+1:])
	mime := "image/png"
	if ext == "jpg" || ext == "jpeg" {
		mime = "image/jpeg"
	}
	a.logoData = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	a.info("تم تحميل الشعار — اضغط «حفظ الإعدادات»")
}

func (a *App) saveSettings() {
	body := map[string]any{
		"hotelName":             a.setName.Text(),
		"hotelNameEn":           a.setNameEn.Text(),
		"taxRegistrationNumber": a.setTaxID.Text(),
		"commercialRegister":    a.setCR.Text(),
		"activityCode":          a.setActivity.Text(),
		"address":               a.setAddress.Text(),
		"city":                  a.setCity.Text(),
		"phone":                 a.setPhone.Text(),
		"email":                 a.setEmail.Text(),
		"vatRate":               a.setVat.Value(),
		"discountRate":          a.setDiscount.Value(),
		"pricesIncludeTax":      true,
		"serialStart":           10246,
		"currency":              "EGP",
		"logoData":              a.logoData,
		"signatureLeft":         a.setSigL.Text(),
		"signatureRight":        a.setSigR.Text(),
		"footerNote":            a.setFooter.Text(),
	}
	if a.online() {
		if _, err := a.api.UpdateSettings(body); err != nil {
			a.fail("تعذّر حفظ الإعدادات على الخادم: " + friendlyErr(err))
			return
		}
	}
	// Always mirror locally.
	s, _ := a.store.Settings()
	s.HotelName = a.setName.Text()
	s.HotelNameEn = a.setNameEn.Text()
	s.TaxRegistrationNumber = a.setTaxID.Text()
	s.CommercialRegister = a.setCR.Text()
	s.ActivityCode = a.setActivity.Text()
	s.Address = a.setAddress.Text()
	s.City = a.setCity.Text()
	s.Phone = a.setPhone.Text()
	s.Email = a.setEmail.Text()
	s.VatRate = a.setVat.Value()
	s.DiscountRate = a.setDiscount.Value()
	s.PricesIncludeTax = 1
	s.Currency = "EGP"
	s.LogoData = a.logoData
	s.SignatureLeft = a.setSigL.Text()
	s.SignatureRight = a.setSigR.Text()
	s.FooterNote = a.setFooter.Text()
	_ = a.store.PutSettings(s)
	if !a.online() {
		raw := marshalSettings(body)
		_, _ = a.store.Enqueue(outbox("PUT", "/api/settings", "settings", "current", raw))
	}
	a.info("تم حفظ الإعدادات")
	a.updateSyncLabel()
}

func marshalSettings(body map[string]any) []byte {
	b, _ := json.Marshal(body)
	return b
}
