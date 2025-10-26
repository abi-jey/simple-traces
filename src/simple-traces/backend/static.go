package backend

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"path"
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

type spaHandler struct {
	staticFS   http.FileSystem
	fileServer http.Handler
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Get the absolute path to prevent directory traversal
	urlPath := r.URL.Path
	if urlPath == "" {
		urlPath = "/"
	}

	// Try to open the file
	f, err := h.staticFS.Open(path.Clean(urlPath))
	if err == nil {
		defer f.Close()
		// Check if it's a file (not a directory)
		stat, err := f.Stat()
		if err == nil && !stat.IsDir() {
			// File exists, serve it
			h.fileServer.ServeHTTP(w, r)
			return
		}
	}

	// If it's a request for a static asset that doesn't exist, return 404
	ext := path.Ext(urlPath)
	if ext == ".js" || ext == ".css" || ext == ".png" || ext == ".jpg" || ext == ".ico" || ext == ".svg" {
		http.NotFound(w, r)
		return
	}

	// For all other routes (SPA routes), serve index.html
	indexFile, err := h.staticFS.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer indexFile.Close()

	indexStat, err := indexFile.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// Serve index.html with proper content type
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "index.html", indexStat.ModTime(), indexFile.(io.ReadSeeker))
}

func newSPAHandler(staticFS http.FileSystem) http.Handler {
	return spaHandler{
		staticFS:   staticFS,
		fileServer: http.FileServer(staticFS),
	}
}
