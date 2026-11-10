package core

import "testing"

func TestArabicInteger(t *testing.T) {
	cases := map[int]string{
		0:       "صفر",
		1:       "واحد",
		11:      "أحد عشر",
		21:      "واحد وعشرون",
		100:     "مئة",
		215:     "مئتان وخمسة عشر",
		1000:    "ألف",
		2000:    "ألفان",
		3000:    "ثلاثة آلاف",
		11000:   "أحد عشر ألف",
		1000000: "مليون",
		2500000: "مليونان وخمسمئة ألف",
	}
	for in, want := range cases {
		if got := ArabicInteger(in); got != want {
			t.Errorf("ArabicInteger(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestTafqeet(t *testing.T) {
	cases := map[string]string{
		"1243.50": "فقط ألف ومئتان وثلاثة وأربعون جنيه مصري وخمسون قرش لا غير",
		"500.00":  "فقط خمسمئة جنيه مصري لا غير",
		"0.75":    "فقط خمسة وسبعون قرش لا غير",
		"0":       "فقط صفر جنيه مصري لا غير",
		"100.994": "فقط مئة جنيه مصري وتسعة وتسعون قرش لا غير",
	}
	for in, want := range cases {
		if got := Tafqeet(in); got != want {
			t.Errorf("Tafqeet(%q) = %q, want %q", in, got, want)
		}
	}
}
