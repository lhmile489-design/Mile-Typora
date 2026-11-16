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

// ReadyInfo answers the page's ready handshake.
type ReadyInfo struct {
	WindowID int    `json:"windowId"`
	Version  string `json:"version"`
}

// NewWindowResult answers a request for another window. WindowID is zero when
// Failure is set.
type NewWindowResult struct {
	WindowID int      `json:"windowId"`
	Failure  *Failure `json:"failure,omitempty"`
}
