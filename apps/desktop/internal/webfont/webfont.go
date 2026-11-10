// Package webfont embeds the IBM Plex Sans fonts used by the desktop client's
// print preview, so it renders identically with no network access. The files
// mirror apps/web/public/fonts (same names, same sources).
package webfont

import (
	"embed"
	"encoding/base64"
	"strings"
	"sync"
)

//go:embed fonts/*.woff2
var fontFS embed.FS

var (
	cssOnce sync.Once
	cssVal  string
)

const (
	latinRange  = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
	arabicRange = "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC"
)

type face struct {
	family string
	weight string
	file   string
	urange string
}

var faces = []face{
	{"IBM Plex Sans", "400", "fonts/ibm-plex-sans-latin-400-normal.woff2", latinRange},
	{"IBM Plex Sans", "500", "fonts/ibm-plex-sans-latin-500-normal.woff2", latinRange},
	{"IBM Plex Sans", "600", "fonts/ibm-plex-sans-latin-600-normal.woff2", latinRange},
	{"IBM Plex Sans", "700", "fonts/ibm-plex-sans-latin-700-normal.woff2", latinRange},
	{"IBM Plex Sans Arabic", "400", "fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", arabicRange},
	{"IBM Plex Sans Arabic", "500", "fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2", arabicRange},
	{"IBM Plex Sans Arabic", "600", "fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", arabicRange},
	{"IBM Plex Sans Arabic", "700", "fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", arabicRange},
}

// CSS returns an @font-face block with every embedded font inlined as a data
// URI. Latin glyphs come from "IBM Plex Sans", Arabic from "IBM Plex Sans
// Arabic"; the caller stacks the two families per script. Cached after first call.
func CSS() string {
	cssOnce.Do(func() {
		var b strings.Builder
		for _, f := range faces {
			data, err := fontFS.ReadFile(f.file)
			if err != nil {
				continue
			}
			b.WriteString("@font-face{font-family:'")
			b.WriteString(f.family)
			b.WriteString("';font-style:normal;font-weight:")
			b.WriteString(f.weight)
			b.WriteString(";font-display:swap;src:url(data:font/woff2;base64,")
			b.WriteString(base64.StdEncoding.EncodeToString(data))
			b.WriteString(") format('woff2');unicode-range:")
			b.WriteString(f.urange)
			b.WriteString(";}")
		}
		cssVal = b.String()
	})
	return cssVal
}
