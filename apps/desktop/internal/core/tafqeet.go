package core

import (
	"math"
	"strconv"
	"strings"
)

// Arabic amount-in-words (تفقيط), mirroring packages/core/src/tafqeet.ts so an
// offline invoice prints the same wording as the cloud copy.

var arOnes = []string{"", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"}
var arTeens = []string{"عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"}
var arTens = []string{"", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"}
var arHundreds = []string{"", "مئة", "مئتان", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"}

func arUnder1000(n int) string {
	var parts []string
	h := n / 100
	r := n % 100
	if h > 0 {
		parts = append(parts, arHundreds[h])
	}
	if r >= 10 && r < 20 {
		parts = append(parts, arTeens[r-10])
	} else {
		t := r / 10
		o := r % 10
		if o > 0 {
			parts = append(parts, arOnes[o])
		}
		if t > 0 {
			parts = append(parts, arTens[t])
		}
	}
	return strings.Join(parts, " و")
}

func arScale(n int, one, two, few, many string) string {
	switch {
	case n == 1:
		return one
	case n == 2:
		return two
	case n >= 3 && n <= 10:
		return arUnder1000(n) + " " + few
	case n < 100:
		return arUnder1000(n) + " " + many
	default:
		return arUnder1000(n) + " " + one
	}
}

// ArabicInteger renders a non-negative integer in Arabic words.
func ArabicInteger(n int) string {
	if n == 0 {
		return "صفر"
	}
	var parts []string
	millions := n / 1_000_000
	thousands := (n % 1_000_000) / 1000
	rest := n % 1000
	if millions > 0 {
		parts = append(parts, arScale(millions, "مليون", "مليونان", "ملايين", "مليون"))
	}
	if thousands > 0 {
		parts = append(parts, arScale(thousands, "ألف", "ألفان", "آلاف", "ألف"))
	}
	if rest > 0 {
		parts = append(parts, arUnder1000(rest))
	}
	return strings.Join(parts, " و")
}

// Tafqeet renders a decimal money string (EGP) as Arabic words.
func Tafqeet(value string) string {
	return tafqeetWith(value, "جنيه مصري", "قرش")
}

func tafqeetWith(value, currency, subunit string) string {
	f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		f = 0
	}
	minor := int(math.Round(f * 100))
	pounds := minor / 100
	piastres := minor % 100

	var segs []string
	if pounds != 0 {
		segs = append(segs, ArabicInteger(pounds)+" "+currency)
	}
	if piastres != 0 {
		segs = append(segs, ArabicInteger(piastres)+" "+subunit)
	}
	body := "صفر " + currency
	if len(segs) > 0 {
		body = strings.Join(segs, " و")
	}
	return "فقط " + body + " لا غير"
}
