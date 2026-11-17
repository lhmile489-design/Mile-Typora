// Package docread reads one Markdown file for display: a size limit before and
// after reading, UTF-8 only, and line endings reported rather than hidden
// (PRD FR-01, §8.3).
package docread

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"unicode/utf8"
)

// MaxBytes is the largest Markdown file the app reads (PRD §8.3).
const MaxBytes = 10 << 20

// Doc is a file ready to be shown as text.
type Doc struct {
	// Text is the content with the BOM removed and CRLF turned into LF.
	Text string
	// Size is the file's size on disk, in bytes.
	Size int64
	// HasBOM reports whether the file started with a UTF-8 byte order mark.
	HasBOM bool
	// LineEnding is "CRLF" when the file used Windows line endings, else "LF".
	LineEnding string
	// Hash is the SHA-256 of the bytes on disk, BOM included. Saving compares
	// it with the disk before overwriting (PRD 10.3).
	Hash string
}

// Failure is an expected read problem, phrased for the user. Its fields mirror
// contract.Failure so the service can pass them through.
type Failure struct {
	Code   string
	Detail string
	Size   int64
	Limit  int64
}

func (f *Failure) Error() string { return f.Code + ": " + f.Detail }

// Read loads the file at path. A nil Failure means success.
func Read(path string) (*Doc, *Failure) {
	fi, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, &Failure{Code: "not_found", Detail: "文件不存在或已被移动"}
		}
		if os.IsPermission(err) {
			return nil, &Failure{Code: "permission", Detail: "没有权限读取此文件"}
		}
		return nil, &Failure{Code: "not_found", Detail: "无法读取此文件"}
	}
	if fi.IsDir() {
		return nil, &Failure{Code: "unsupported_type", Detail: "这是一个目录，不是 Markdown 文件"}
	}
	if fi.Size() > MaxBytes {
		return nil, &Failure{
			Code:   "too_large",
			Detail: "文件超过读取上限",
			Size:   fi.Size(),
			Limit:  MaxBytes,
		}
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsPermission(err) {
			return nil, &Failure{Code: "permission", Detail: "没有权限读取此文件"}
		}
		return nil, &Failure{Code: "not_found", Detail: "无法读取此文件"}
	}
	defer f.Close()

	// Read one byte past the limit so a file that grew since Stat is caught
	// too (PRD §8.3: checked before and after reading).
	data, err := io.ReadAll(io.LimitReader(f, MaxBytes+1))
	if err != nil {
		if os.IsPermission(err) {
			return nil, &Failure{Code: "permission", Detail: "没有权限读取此文件"}
		}
		return nil, &Failure{Code: "not_found", Detail: "读取文件时出错"}
	}
	if len(data) > MaxBytes {
		return nil, &Failure{
			Code:   "too_large",
			Detail: "文件超过读取上限",
			Size:   int64(len(data)),
			Limit:  MaxBytes,
		}
	}

	sum := sha256.Sum256(data)
	doc := &Doc{Size: int64(len(data)), LineEnding: DetectLineEnding(data), Hash: hex.EncodeToString(sum[:])}
	if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		doc.HasBOM = true
		data = data[3:]
	}
	if !utf8.Valid(data) {
		return nil, &Failure{Code: "encoding", Detail: "暂不支持此文件编码，请转换为 UTF-8"}
	}
	if bytes.Contains(data, []byte("\r\n")) {
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
	}
	doc.Text = string(data)
	return doc, nil
}

// DetectLineEnding tells LF, CRLF and mixed files apart. The editor normalizes
// its buffer to LF; the open path and the properties dialog both use this.
func DetectLineEnding(data []byte) string {
	crlf, lf := 0, 0
	for i := 0; i < len(data); i++ {
		if data[i] != '\n' {
			continue
		}
		if i > 0 && data[i-1] == '\r' {
			crlf++
		} else {
			lf++
		}
	}
	switch {
	case crlf > 0 && lf > 0:
		return "混合"
	case crlf > 0:
		return "CRLF"
	default:
		return "LF"
	}
}
