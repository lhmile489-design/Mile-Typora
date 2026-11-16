// Package scan finds the Markdown files of a directory and the folders that
// lead to them (PRD FR-03). It never follows a link or a junction, and it
// stops at the bounds of PRD §8.3 with a result that says so.
package scan

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Bounds of one scan (PRD §8.3).
const (
	MaxEntries  = 50_000
	MaxMarkdown = 10_000
	MaxDepth    = 64
)

// ErrNotDirectory is returned when the root is not a folder.
var ErrNotDirectory = errors.New("scan: not a directory")

// Entry is one row of the tree: a folder or a Markdown file.
type Entry struct {
	// Path is relative to the root, separated by slashes.
	Path string
	// Name is the last element of Path.
	Name string
	// IsDir tells a folder from a file.
	IsDir bool
}

// Result is what a scan found.
type Result struct {
	// Entries are the folders leading to Markdown files and the files
	// themselves, in tree order: natural by name, a folder before its
	// contents.
	Entries []Entry
	// Truncated is true when a bound stopped the walk: part of the tree is
	// missing and the page must say so (PRD §7.2).
	Truncated bool
	// Bound names the bound that stopped the walk: "entries", "markdown" or
	// "depth".
	Bound string
	// Skipped counts what was left out: links, junctions, unreadable
	// folders, and folders deeper than the depth bound.
	Skipped int
}

// Options overrides the bounds; zero means the constant above.
type Options struct {
	MaxEntries  int
	MaxMarkdown int
	MaxDepth    int
}

func (o Options) withDefaults() Options {
	if o.MaxEntries <= 0 {
		o.MaxEntries = MaxEntries
	}
	if o.MaxMarkdown <= 0 {
		o.MaxMarkdown = MaxMarkdown
	}
	if o.MaxDepth <= 0 {
		o.MaxDepth = MaxDepth
	}
	return o
}

// markdownExt reports a Markdown extension in any case (PRD FR-01).
func markdownExt(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown":
		return true
	}
	return false
}

// Scan walks root and returns the Markdown tree under it.
func Scan(ctx context.Context, root string, opts Options) (Result, error) {
	opts = opts.withDefaults()
	root = filepath.Clean(root)
	fi, err := os.Stat(root)
	if err != nil {
		return Result{}, err
	}
	if !fi.IsDir() {
		return Result{}, ErrNotDirectory
	}

	var (
		res     Result
		files   []string
		visited int
	)
	// stop records the bound that ended the walk.
	stop := func(bound string) {
		res.Truncated = true
		if res.Bound == "" {
			res.Bound = bound
		}
	}

	var walk func(dir, rel string, depth int) bool
	walk = func(dir, rel string, depth int) bool {
		if depth > opts.MaxDepth {
			res.Skipped++
			stop("depth")
			return true
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			// A folder the user cannot read is skipped, not fatal: the rest
			// of the tree stays usable (PRD §7.2).
			res.Skipped++
			return true
		}
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].IsDir() != entries[j].IsDir() {
				return entries[i].IsDir()
			}
			return naturalLess(entries[i].Name(), entries[j].Name())
		})
		for _, entry := range entries {
			if contextDone(ctx) {
				return false
			}
			visited++
			if visited > opts.MaxEntries {
				stop("entries")
				return false
			}
			name := entry.Name()
			child := name
			if rel != "" {
				child = rel + "/" + name
			}
			path := filepath.Join(dir, name)

			// Links and junctions are never followed (PRD FR-03). Go 1.23
			// reports a junction as ModeIrregular.
			info, err := os.Lstat(path)
			if err != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeIrregular != 0 {
				res.Skipped++
				continue
			}
			if entry.IsDir() {
				if !walk(path, child, depth+1) {
					return false
				}
				continue
			}
			if !markdownExt(name) {
				continue
			}
			if len(files) >= opts.MaxMarkdown {
				stop("markdown")
				return false
			}
			files = append(files, child)
		}
		return true
	}

	walk(root, "", 0)
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	res.Entries = tree(files)
	return res, nil
}

func contextDone(ctx context.Context) bool { return ctx.Err() != nil }

// tree turns relative file paths into the rows of the tree: every folder that
// leads to a Markdown file, and the files themselves.
func tree(files []string) []Entry {
	entries := make([]Entry, 0, len(files)*2)
	seen := make(map[string]struct{})
	for _, file := range files {
		ancestors := ancestorDirs(file)
		for i := len(ancestors) - 1; i >= 0; i-- {
			dir := ancestors[i]
			if _, ok := seen[dir]; ok {
				continue
			}
			seen[dir] = struct{}{}
			entries = append(entries, Entry{Path: dir, Name: baseOf(dir), IsDir: true})
		}
		entries = append(entries, Entry{Path: file, Name: baseOf(file)})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Path == entries[j].Path {
			return entries[i].IsDir
		}
		return naturalLess(entries[i].Path, entries[j].Path)
	})
	return entries
}

// ancestorDirs lists the folders of a slash path, outermost first.
func ancestorDirs(p string) []string {
	var dirs []string
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] != '/' {
			continue
		}
		dirs = append(dirs, p[:i])
	}
	// dirs is innermost first; the caller walks it backwards.
	sort.Slice(dirs, func(a, b int) bool { return len(dirs[a]) < len(dirs[b]) })
	return dirs
}

func baseOf(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

// naturalLess orders names the way a file manager does: digit runs compare as
// numbers, so "第2章" comes before "第10章".
func naturalLess(a, b string) bool {
	ra, rb := []rune(a), []rune(b)
	for i, j := 0, 0; i < len(ra) && j < len(rb); {
		ca, cb := ra[i], rb[j]
		if isDigit(ca) && isDigit(cb) {
			si, sj := i, j
			for i < len(ra) && isDigit(ra[i]) {
				i++
			}
			for j < len(rb) && isDigit(rb[j]) {
				j++
			}
			na := strings.TrimLeft(string(ra[si:i]), "0")
			nb := strings.TrimLeft(string(rb[sj:j]), "0")
			if len(na) != len(nb) {
				return len(na) < len(nb)
			}
			if na != nb {
				return na < nb
			}
			continue
		}
		if ca != cb {
			return ca < cb
		}
		i++
		j++
	}
	return len(ra) < len(rb)
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }
