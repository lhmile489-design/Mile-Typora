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
	// StartupNotice explains why the launch opened a blank page instead of
	// the document it meant to restore (PRD FR-10.6).
	StartupNotice string `json:"startupNotice,omitempty"`
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
	Truncated bool        `json:"truncated,omitempty"`
	Bound     string      `json:"bound,omitempty"`
	Skipped   int         `json:"skipped,omitempty"`
	Failure   *Failure    `json:"failure,omitempty"`
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

// FolderInfo is a folder a request opened.
type FolderInfo struct {
	Root string `json:"root"`
	Name string `json:"name"`
}

// OpenRequestResult answers an open request. Kind says what opened: "file"
// carries Doc, "folder" carries Folder. Kind is empty when the request went to
// a new window, which opens it there.
type OpenRequestResult struct {
	Kind   string      `json:"kind"`
	Doc    *Doc        `json:"doc,omitempty"`
	Folder *FolderInfo `json:"folder,omitempty"`
	// Rel is the document's path relative to the window's folder, when the
	// document is inside it: the page then keeps the tree.
	Rel     string   `json:"rel,omitempty"`
	Failure *Failure `json:"failure,omitempty"`
}

// LinkTarget says what a link click means. The page scrolls an anchor, opens
// a document from the tree, or says why nothing opened (PRD FR-06).
type LinkTarget struct {
	// Kind is "anchor", "document", "attachment", "blocked", "handled" or
	// "cancelled".
	Kind string `json:"kind"`
	// Anchor is the fragment of an "anchor" link, without the "#".
	Anchor string `json:"anchor,omitempty"`
	// Rel is the path of a "document" link, relative to the window's folder.
	Rel string `json:"rel,omitempty"`
	// Reason explains an "attachment" or "blocked" link to the user.
	Reason string `json:"reason,omitempty"`
}

// DocUpdate tells a window that its document changed outside the app
// (PRD FR-07). Failure means the old content stays and is marked stale.
type DocUpdate struct {
	Doc     *Doc     `json:"doc,omitempty"`
	Failure *Failure `json:"failure,omitempty"`
	// Seq increases per refresh: the page drops anything older than what it
	// already shows (PRD §9.2.5).
	Seq int64 `json:"seq"`
}

// ThemeChange tells every window that the appearance preference changed
// (PRD FR-10.12: all windows switch at once).
type ThemeChange struct {
	// Appearance is "system", "light" or "dark".
	Appearance string `json:"appearance"`
}

// RecentEntry is one row of the start page's recent list.
type RecentEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// IsDir tells a folder from a file.
	IsDir bool `json:"isDir"`
}

// SettingsView is what the page shows and edits.
type SettingsView struct {
	Startup    string        `json:"startup"`
	Appearance string        `json:"appearance"`
	Recent     []RecentEntry `json:"recent"`
}

// SettingsResult answers the settings read. Corrupt is true when the file
// could not be read and defaults are in use (PRD FR-10.11).
type SettingsResult struct {
	Settings SettingsView `json:"settings"`
	Corrupt  bool         `json:"corrupt,omitempty"`
	Failure  *Failure     `json:"failure,omitempty"`
}

// SaveOutcome answers a settings write. Failure is set when nothing was saved.
type SaveOutcome struct {
	Failure *Failure `json:"failure,omitempty"`
}
