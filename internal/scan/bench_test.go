package scan

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// benchTree builds a folder with 40 folders and 1,000 Markdown files: enough
// to exercise sorting and the tree build without making the benchmark about
// the disk cache.
func benchTree(b *testing.B) string {
	b.Helper()
	root := b.TempDir()
	for d := 0; d < 40; d++ {
		dir := filepath.Join(root, fmt.Sprintf("folder-%02d", d))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		for f := 0; f < 25; f++ {
			name := filepath.Join(dir, fmt.Sprintf("note-%02d.md", f))
			if err := os.WriteFile(name, []byte("# note\n"), 0o644); err != nil {
				b.Fatal(err)
			}
		}
	}
	return root
}

// BenchmarkScan measures one full scan of the 1,000-file tree: the number
// M3-7 records as the scan baseline (docs/develop/性能基线.md).
func BenchmarkScan(b *testing.B) {
	root := benchTree(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result, err := Scan(context.Background(), root, Options{})
		if err != nil {
			b.Fatal(err)
		}
		if len(result.Entries) != 1040 {
			b.Fatalf("entries = %d, want 1040", len(result.Entries))
		}
	}
}
