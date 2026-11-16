// Package pathguard decides which paths the app may read. Every path that
// comes from the page or from a document is canonicalized here and checked
// against an authorized root; a string prefix is never enough (CLAUDE.md §5.6).
package pathguard

import (
	"os"
	"path/filepath"
	"strings"
)

// Failure is an expected path problem, phrased for the user.
type Failure struct {
	Code   string
	Detail string
}

func (f *Failure) Error() string { return f.Code + ": " + f.Detail }

func fail(code, detail string) *Failure { return &Failure{Code: code, Detail: detail} }

// MarkdownExt reports whether name has a Markdown extension, in any case
// (PRD FR-01).
func MarkdownExt(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown":
		return true
	}
	return false
}

// Canon returns the real path of path: absolute, cleaned, with links resolved.
// UNC and device paths are refused because the P0 scope does not include
// network shares (PRD §3.2, §8.1).
func Canon(path string) (string, *Failure) {
	if path == "" {
		return "", fail("not_found", "没有选择文件")
	}
	if isUNC(path) || isDevice(path) {
		return "", fail("out_of_scope", "暂不支持网络共享或设备路径")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fail("not_found", "无法解析此路径")
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fail("not_found", "文件不存在或已被移动")
		}
		if os.IsPermission(err) {
			return "", fail("permission", "没有权限读取此路径")
		}
		return "", fail("not_found", "无法解析此路径")
	}
	return filepath.Clean(real), nil
}

// isUNC reports whether path names a network share, in either the \\server
// form or the extended \\?\UNC\ form.
func isUNC(path string) bool {
	if strings.HasPrefix(path, `\\?\UNC\`) || strings.HasPrefix(path, `\\.\UNC\`) {
		return true
	}
	return strings.HasPrefix(path, `\\`) && !isDevice(path)
}

// isDevice reports whether path addresses a device, as \\.\COM1 does.
func isDevice(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasPrefix(lower, `\\.\`) || strings.HasPrefix(lower, `\\?\`)
}

// Within reports whether target is root itself or below it. Both must already
// be canonical: comparing cleaned absolute paths with filepath.Rel is the only
// safe test; a prefix test would accept "C:\docs2" for the root "C:\docs".
func Within(root, target string) (bool, *Failure) {
	if root == "" {
		return false, fail("out_of_scope", "尚未打开工作区")
	}
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil {
		return false, fail("out_of_scope", "此路径不在当前工作区内")
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return false, fail("out_of_scope", "此路径不在当前工作区内")
	}
	return true, nil
}

// CheckComponents walks from root down to target and refuses any component
// that is a reparse point: a symlink, or a directory junction, which Go 1.23
// and later report as ModeIrregular instead of resolving in EvalSymlinks
// (PRD FR-03: do not follow links or junctions).
func CheckComponents(root, target string) *Failure {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil || rel == "." {
		return nil
	}
	path := filepath.Clean(root)
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		path = filepath.Join(path, part)
		fi, err := os.Lstat(path)
		if err != nil {
			if os.IsNotExist(err) {
				return fail("not_found", "文件或目录不存在")
			}
			if os.IsPermission(err) {
				return fail("permission", "没有权限访问此路径")
			}
			return fail("not_found", "无法访问此路径")
		}
		if fi.Mode()&os.ModeSymlink != 0 || fi.Mode()&os.ModeIrregular != 0 {
			return fail("out_of_scope", "此路径经过链接或目录联接，已跳过")
		}
	}
	return nil
}
