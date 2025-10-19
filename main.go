package main

import (
	"log"

	"github.com/abi-jey/simple-traces/src/simple-traces/backend"
)

func main() {
	if err := backend.Run(); err != nil {
		log.Fatal(err)
	}
}
