package resource

import "testing"

func TestPreviewTokensDoNotDropReadingTokens(t *testing.T) {
	store := New()
	read := store.Add(1, `C:\a.png`)
	preview := store.AddKind(1, KindPreview, `C:\b.png`)
	if read == preview {
		t.Fatal("two registrations returned the same token")
	}
	store.ForgetKind(1, KindPreview)
	if _, ok := store.Lookup(read); !ok {
		t.Fatal("the reading token was dropped with the preview")
	}
	if _, ok := store.Lookup(preview); ok {
		t.Fatal("the preview token survived its own forget")
	}
	store.ForgetWindow(1)
	if _, ok := store.Lookup(read); ok {
		t.Fatal("ForgetWindow kept a reading token")
	}
}
