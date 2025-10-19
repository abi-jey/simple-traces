package backend

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed frontend/dist
var frontendFiles embed.FS

func getFrontendFS() http.FileSystem {
	fsys, err := fs.Sub(frontendFiles, "frontend/dist")
	if err != nil {
		panic(err)
	}
	return http.FS(fsys)
}
