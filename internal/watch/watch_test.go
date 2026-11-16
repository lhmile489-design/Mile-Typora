package watch

import (
	"testing"

	"github.com/egoist/mygo"
)

func TestMapOp(t *testing.T) {
	cases := map[mygo.FileOp]Op{
		mygo.FileWrite:  Write,
		mygo.FileCreate: Write,
		mygo.FileRename: Write,
		mygo.FileRemove: Remove,
	}
	for in, want := range cases {
		if got, ok := mapOp(in); !ok || got != want {
			t.Errorf("mapOp(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	if _, ok := mapOp(mygo.FileHint); ok {
		t.Error("mapOp accepted a hint, which names no file")
	}
}
