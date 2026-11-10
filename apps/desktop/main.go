// Command kaoud-hotel is the native Windows desktop client for the hotel
// invoicing system. It works fully offline against a local store and syncs
// with the Cloudflare API when a connection is available.
//
// Build (from this directory):
//
//	GOOS=windows GOARCH=386   CGO_ENABLED=0 go build -ldflags "-H=windowsgui -s -w" -o kaoud-hotel-386.exe .
//	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-H=windowsgui -s -w" -o kaoud-hotel-amd64.exe .
package main

import (
	"log"

	"github.com/yk445kauod-coder/Kauod-hotel/apps/desktop/internal/ui"
)

func main() {
	if err := ui.Run(); err != nil {
		log.Fatal(err)
	}
}
