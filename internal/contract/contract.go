// Package contract holds the types the frontend sees through the bindings.
// Expected failures travel in a Failure field of the result, because the
// frontend CallError carries no code (docs/decisions.md D-T01).
package contract

// Failure is an expected, user-facing failure. Detail never contains
// document text or unauthorized paths.
type Failure struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Size   int64  `json:"size,omitempty"`
	Limit  int64  `json:"limit,omitempty"`
}

// OpenRequest asks a window to open something. Seq orders requests within a
// window: the page ignores any it has already handled, whatever order the
// transports deliver them in (PRD §9.2.3).
type OpenRequest struct {
	Seq  int64  `json:"seq"`
	Path string `json:"path,omitempty"`
}

// ReadyInfo answers the page's ready handshake.
type ReadyInfo struct {
	WindowID int    `json:"windowId"`
	Version  string `json:"version"`
}

// PendingResult lists the open requests the page has not acknowledged yet, in
// order. The page asks again after a remount or a reload and gets them back.
type PendingResult struct {
	Requests []OpenRequest `json:"requests"`
}

// Doc is one opened Markdown file, as text. From M1-4 the text becomes
// rendered HTML.
type Doc struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	HasBOM     bool   `json:"hasBom"`
	LineEnding string `json:"lineEnding"`
	// Text is the Markdown source, with the BOM removed and LF endings.
	Text string `json:"text"`
	// HTML is the rendered, whitelisted markup the page shows.
	HTML string `json:"html"`
	// Counts tells the page how much was enhanced and how much stayed
	// source because of a limit (PRD §8.3).
	Counts Counts `json:"counts"`
}

// Counts are a document's formula and diagram totals.
type Counts struct {
	Math           int `json:"math"`
	MathLimited    int `json:"mathLimited"`
	Mermaid        int `json:"mermaid"`
	MermaidLimited int `json:"mermaidLimited"`
}

// LoadResult answers an open request. Doc is nil when Failure is set or when
// the user cancelled the dialog, which both fields nil also mark.
type LoadResult struct {
	Doc     *Doc     `json:"doc,omitempty"`
	Failure *Failure `json:"failure,omitempty"`
}

// TreeEntry is one row of the file tree: a folder or a Markdown file.
type TreeEntry struct {
	// Path is relative to the folder's root, separated by slashes.
	Path  string `json:"path"`
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
}

// ScanFrame is one batch of a folder scan. The page appends Entries as they
// arrive; Done marks the last frame, which carries the outcome.
type ScanFrame struct {
	Entries   []TreeEntry `json:"entries"`
	Done      bool        `json:"done"`
	Truncated bool     `json:"truncated,omitempty"`
	Bound     string   `json:"bound,omitempty"`
	Skipped   int      `json:"skipped,omitempty"`
	Failure   *Failure `json:"failure,omitempty"`
}

// OpenFolderResult answers the folder dialog. Root is empty when cancelled.
type OpenFolderResult struct {
	Root    string   `json:"root"`
	Name    string   `json:"name"`
	Failure *Failure `json:"failure,omitempty"`
}

// NewWindowResult answers a request for another window. WindowID is zero when
// Failure is set.
type NewWindowResult struct {
	WindowID int      `json:"windowId"`
	Failure  *Failure `json:"failure,omitempty"`
}
