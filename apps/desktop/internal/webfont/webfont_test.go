package webfont

import (
	"strings"
	"testing"
)

func TestCSSInlinesAllFonts(t *testing.T) {
	css := CSS()
	if css == "" {
		t.Fatal("CSS() returned empty")
	}
	if got := strings.Count(css, "@font-face{"); got != 8 {
		t.Fatalf("@font-face count = %d, want 8", got)
	}
	if got := strings.Count(css, "data:font/woff2;base64,"); got != 8 {
		t.Fatalf("data URI count = %d, want 8", got)
	}
	for _, fam := range []string{"'IBM Plex Sans'", "'IBM Plex Sans Arabic'"} {
		if !strings.Contains(css, fam) {
			t.Fatalf("missing family %s", fam)
		}
	}
	// Arabic must declare its unicode-range so Latin text falls through to
	// "IBM Plex Sans" and Arabic to "IBM Plex Sans Arabic".
	if !strings.Contains(css, "U+0600-06FF") {
		t.Fatal("arabic unicode-range missing")
	}
	if !strings.Contains(css, "U+0000-00FF") {
		t.Fatal("latin unicode-range missing")
	}
}

func TestCSSCached(t *testing.T) {
	if CSS() != CSS() {
		t.Fatal("CSS() not stable across calls")
	}
}
