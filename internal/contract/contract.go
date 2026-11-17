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
	// StartUntitled asks the page to begin with an unsaved document (Ctrl+N).
	StartUntitled bool `json:"startUntitled,omitempty"`
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
	// Hash is the SHA-256 of the file on disk, the base for save conflicts.
	Hash string `json:"hash"`
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
	// Unreadable counts folders the scan could not read; the page says the
	// result is partial (PRD §7.2).
	Unreadable int      `json:"unreadable,omitempty"`
	Failure    *Failure `json:"failure,omitempty"`
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

// RenderSourceResult is the preview of an edited buffer. The renderer is the
// same one that renders files, so preview and reading cannot drift apart.
type RenderSourceResult struct {
	HTML    string   `json:"html,omitempty"`
	Counts  Counts   `json:"counts"`
	Failure *Failure `json:"failure,omitempty"`
}

// SaveResult answers a save or save-as. Failure means nothing was written.
type SaveResult struct {
	Path       string   `json:"path,omitempty"`
	Name       string   `json:"name,omitempty"`
	Size       int64    `json:"size,omitempty"`
	Hash       string   `json:"hash,omitempty"`
	HasBOM     bool     `json:"hasBom,omitempty"`
	LineEnding string   `json:"lineEnding,omitempty"`
	Failure    *Failure `json:"failure,omitempty"`
}

// CloseRequested asks a window's page to run the unsaved-changes prompt
// before the native close goes through.
type CloseRequested struct{}

// Notice is a short message a window shows in its status bar: something the
// app refused or could not do, said without blocking (PRD §7.3, §9.2.4).
type Notice struct {
	Text string `json:"text"`
}

// TreeChanged tells a window that the structure of its folder changed, so
// the page rescans the tree (PRD FR-03.12, FR-07.1). It carries nothing:
// the page already knows its folder.
type TreeChanged struct{}

// DocUpdate tells a window that its document changed outside the app
// (PRD FR-07). Failure means the old content stays and is marked stale.
type DocUpdate struct {
	Doc     *Doc     `json:"doc,omitempty"`
	Failure *Failure `json:"failure,omitempty"`
	// Seq increases per refresh: the page drops anything older than what it
	// already shows (PRD §9.2.5).
	Seq int64 `json:"seq"`
	// Rel is the document's path relative to the window's folder, when it is
	// inside it. A move updates the tree's selection with it (M5-1).
	Rel string `json:"rel,omitempty"`
}

// FileOpResult answers a move, reveal or trash. Failure means nothing changed.
type FileOpResult struct {
	Path    string   `json:"path,omitempty"`
	Name    string   `json:"name,omitempty"`
	Failure *Failure `json:"failure,omitempty"`
}

// FileProperties is the read-only information the properties dialog shows.
type FileProperties struct {
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	Size       int64    `json:"size"`
	Encoding   string   `json:"encoding"`
	LineEnding string   `json:"lineEnding"`
	Modified   string   `json:"modified"`
	ReadOnly   bool     `json:"readOnly"`
	Failure    *Failure `json:"failure,omitempty"`
}

// AttachFolderResult answers "show in sidebar" when the window had no folder
// root: the file's parent becomes the root, the document stays open.
type AttachFolderResult struct {
	Folder  *FolderInfo `json:"folder,omitempty"`
	Rel     string      `json:"rel,omitempty"`
	Failure *Failure    `json:"failure,omitempty"`
}

// FileTrashed tells a window that its file was moved to the recycle bin.
type FileTrashed struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// OutlineHeading is one row of the left outline (M5-2 VIEW-02).
type OutlineHeading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Line  int    `json:"line"`
}

// OutlineResult is the heading list of the current buffer or document.
type OutlineResult struct {
	Headings  []OutlineHeading `json:"headings"`
	Truncated bool             `json:"truncated,omitempty"`
	Failure   *Failure         `json:"failure,omitempty"`
}

// SearchMatch is one directory-search result (M5-2 VIEW-05). Path is relative
// to the window's root; Line is 1-based and zero for a file-name match.
type SearchMatch struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Line   int    `json:"line,omitempty"`
	Text   string `json:"text,omitempty"`
	IsName bool   `json:"isName,omitempty"`
}

// SearchFrame is one batch of directory-search results. Done marks the last
// frame and carries the outcome.
type SearchFrame struct {
	Matches   []SearchMatch `json:"matches,omitempty"`
	Done      bool          `json:"done"`
	Truncated bool          `json:"truncated,omitempty"`
	Files     int           `json:"files,omitempty"`
	Failure   *Failure      `json:"failure,omitempty"`
}

// ImagePickResult is a picked image waiting for confirmation before it is
// copied into the document's assets folder (M5-4 FORMAT-09).
type ImagePickResult struct {
	Token   string   `json:"token,omitempty"`
	Name    string   `json:"name,omitempty"`
	Target  string   `json:"target,omitempty"`
	Size    int64    `json:"size,omitempty"`
	Failure *Failure `json:"failure,omitempty"`
}

// ImageCopyResult is the copied image and the relative path to insert.
type ImageCopyResult struct {
	Path     string   `json:"path,omitempty"`
	Markdown string   `json:"markdown,omitempty"`
	Name     string   `json:"name,omitempty"`
	Failure  *Failure `json:"failure,omitempty"`
}

// ClipboardResult reports a clipboard write that may fail for an expected
// reason, such as an empty selection or a failed image decode (M5-5).
type ClipboardResult struct {
	Failure *Failure `json:"failure,omitempty"`
}

// ExportResult is one finished HTML or PDF export (M5-6 FILE-16).
type ExportResult struct {
	Path     string   `json:"path,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	Failure  *Failure `json:"failure,omitempty"`
}

// PrintResult reports a print preview opened from the dedicated print view
// (M5-6 FILE-17).
type PrintResult struct {
	Warnings []string `json:"warnings,omitempty"`
	Failure  *Failure `json:"failure,omitempty"`
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

// SaveAllStart is the request id of a save-all run.
type SaveAllStart struct {
	RequestID int `json:"requestId"`
}

// SaveAllRequest asks one page to save its dirty buffer.
type SaveAllRequest struct {
	RequestID int `json:"requestId"`
}

// SaveAllResult is one window's outcome in a save-all run.
type SaveAllResult struct {
	WindowID int    `json:"windowId"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
}

// SaveAllSummary is sent to the window that started the run.
type SaveAllSummary struct {
	RequestID int             `json:"requestId"`
	Results   []SaveAllResult `json:"results"`
	Saved     int             `json:"saved"`
	Failed    int             `json:"failed"`
	Unhandled int             `json:"unhandled"`
}
