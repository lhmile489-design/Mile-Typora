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

// NewWindowResult answers a request for another window. WindowID is zero when
// Failure is set.
type NewWindowResult struct {
	WindowID int      `json:"windowId"`
	Failure  *Failure `json:"failure,omitempty"`
}
