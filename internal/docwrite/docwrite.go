// Package docwrite replaces a Markdown file with an edited buffer in one
// step: a temporary file in the same folder is written and flushed, then
// swapped in with ReplaceFileW, which keeps the original file's ACL,
// attributes and creation time (PRD 10.2).
package docwrite

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

const replaceFileWriteThrough = 0x00000001

var replaceFile = syscall.NewLazyDLL("kernel32.dll").NewProc("ReplaceFileW")

// Write stores data at path. The file must not be open for writing elsewhere;
// a failure leaves the original file as it was.
func Write(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".mile-save-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}
	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}

	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if mode == 0 {
			mode = 0o644
		}
		_ = os.Chmod(tmpName, mode)
		if err := os.Rename(tmpName, path); err != nil {
			_ = os.Remove(tmpName)
			return err
		}
		return nil
	} else if err != nil {
		_ = os.Remove(tmpName)
		return err
	}

	target, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	replacement, err := syscall.UTF16PtrFromString(tmpName)
	if err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	ok, _, callErr := replaceFile.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(unsafe.Pointer(replacement)),
		0,
		replaceFileWriteThrough,
		0,
		0,
	)
	if ok == 0 {
		_ = os.Remove(tmpName)
		if callErr != nil && callErr != syscall.Errno(0) {
			return fmt.Errorf("docwrite: replace %s: %w", filepath.Base(path), callErr)
		}
		return fmt.Errorf("docwrite: replace %s failed", filepath.Base(path))
	}
	return nil
}
