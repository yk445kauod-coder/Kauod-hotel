// Package core is the Go port of packages/core (money, calc, ETA, QR).
// It must produce byte-identical money strings to the TypeScript engine so an
// offline invoice printed on the desktop matches the cloud copy exactly.
package core

import (
	"errors"
	"strconv"
	"strings"
)

// Minor is an integer number of piastres (1 EGP = 100).
type Minor int64

// ParseMoney accepts strings/numbers with up to 2 decimals, rounding half up on
// the third decimal, and returns minor units. Mirrors parseMoney() in TS.
func ParseMoney(input string) (Minor, error) {
	s := strings.TrimSpace(strings.ReplaceAll(input, ",", ""))
	if s == "" {
		return 0, nil
	}
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	for _, c := range intPart + fracPart {
		if c < '0' || c > '9' {
			return 0, errors.New("invalid money value: " + input)
		}
	}
	whole, err := strconv.ParseInt(orZero(intPart), 10, 64)
	if err != nil {
		return 0, err
	}
	frac2 := (fracPart + "00")[:2]
	cents, err := strconv.ParseInt(orZero(frac2), 10, 64)
	if err != nil {
		return 0, err
	}
	minor := whole*100 + cents
	if len(fracPart) > 2 && fracPart[2] >= '5' {
		minor++
	}
	if neg {
		minor = -minor
	}
	return Minor(minor), nil
}

// FormatMoney renders minor units as a fixed 2-decimal string.
func FormatMoney(m Minor) string {
	neg := m < 0
	abs := m
	if neg {
		abs = -abs
	}
	whole := abs / 100
	cents := abs % 100
	out := strconv.FormatInt(int64(whole), 10) + "." + pad2(int64(cents))
	if neg {
		return "-" + out
	}
	return out
}

func pad2(n int64) string {
	if n < 10 {
		return "0" + strconv.FormatInt(n, 10)
	}
	return strconv.FormatInt(n, 10)
}

func orZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

// MulDiv computes round-half-up(a*b/c) in integer space.
func MulDiv(a, b, c int64) int64 {
	prod := a * b
	q := prod / c
	r := prod - q*c
	if r*2 >= c {
		return q + 1
	}
	return q
}
