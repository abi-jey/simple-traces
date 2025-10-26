package main

import (
	"flag"
	"log"

	"github.com/abi-jey/simple-traces/src/simple-traces/backend"
)

func main() {
	logLevel := flag.String("log-level", "", "Set log level (DEBUG, INFO, WARN, ERROR)")
	flag.Parse()

	if err := backend.Run(*logLevel); err != nil {
		log.Fatal(err)
	}
}
