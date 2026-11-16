package webview

import (
	"syscall"
	"testing"
)

func TestMissingClientKeyHasNoVersion(t *testing.T) {
	const absent = `Software\Microsoft\EdgeUpdate\Clients\{00000000-0000-0000-0000-000000000000}`
	if got := version(syscall.HKEY_CURRENT_USER, absent); got != "" {
		t.Fatalf("version = %q, want empty for an absent key", got)
	}
}
