package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// imageDocument is the canonical path of the window's saved document, after
// checking that a workspace root still authorizes writes beside it.
func (s *WindowService) imageDocument(w *winctx.Window) (string, *contract.Failure) {
	doc, ok := w.OpenFile()
	if !ok {
		return "", failFile("no_file", "当前文档尚未保存")
	}
	docReal, pathFailure := pathguard.Canon(doc)
	if pathFailure != nil {
		return "", contractFailure(pathFailure)
	}
	if root, hasRoot := w.Root(); hasRoot {
		if within, _ := pathguard.Within(root, docReal); !within {
			return "", failFile("out_of_scope", "文档不在当前工作区内")
		}
		if componentFailure := pathguard.CheckComponents(root, docReal); componentFailure != nil {
			return "", contractFailure(componentFailure)
		}
	}
	return docReal, nil
}

// PickImage asks for a local image and prepares a copy in the document's
// assets folder. Nothing is written until CopyImage confirms (M5-4 FORMAT-09).
func (s *WindowService) PickImage(ctx context.Context) (contract.ImagePickResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ImagePickResult{}, err
	}
	docReal, failure := s.imageDocument(w)
	if failure != nil {
		return contract.ImagePickResult{Failure: failure}, nil
	}
	picker := s.pickImage
	if picker == nil {
		picker = PickImageFile
	}
	chosen, err := picker(ctx)
	if err != nil {
		return contract.ImagePickResult{Failure: failFile("image_failed", "无法打开选择图片的对话框")}, nil
	}
	if chosen == "" {
		return contract.ImagePickResult{}, nil
	}
	source, pathFailure := pathguard.Canon(chosen)
	if pathFailure != nil {
		return contract.ImagePickResult{Failure: contractFailure(pathFailure)}, nil
	}
	if reason := resource.Check(source); reason != "" {
		return contract.ImagePickResult{Failure: imageFailure(reason)}, nil
	}
	info, statErr := os.Stat(source)
	if statErr != nil {
		return contract.ImagePickResult{Failure: failFile("not_found", "图片不存在或不可读")}, nil
	}
	target, failure := uniqueImageTarget(filepath.Join(filepath.Dir(docReal), "assets"), filepath.Base(source), source)
	if failure != nil {
		return contract.ImagePickResult{Failure: failure}, nil
	}
	token, tokenErr := imageToken()
	if tokenErr != nil {
		return contract.ImagePickResult{Failure: failFile("image_failed", "无法准备图片")}, nil
	}
	w.SetPendingImage(winctx.PendingImage{Token: token, Doc: docReal, Source: source, Target: target})
	return contract.ImagePickResult{
		Token:  token,
		Name:   filepath.Base(source),
		Target: target,
		Size:   info.Size(),
	}, nil
}

// CopyImage copies the confirmed image into assets and returns the Markdown
// path to insert. The pending token is one-use.
func (s *WindowService) CopyImage(ctx context.Context, token string) (contract.ImageCopyResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ImageCopyResult{}, err
	}
	pending, ok := w.TakePendingImage(token)
	if !ok {
		return contract.ImageCopyResult{Failure: failFile("not_found", "没有待确认的图片")}, nil
	}
	if len(pending.Data) == 0 {
		if reason := resource.Check(pending.Source); reason != "" {
			return contract.ImageCopyResult{Failure: imageFailure(reason)}, nil
		}
	}
	// The workspace may have changed while the confirmation was open: the
	// document must still be inside it, and no link may appear on the way to
	// the assets directory (M5-4 §6.2).
	assetsDir := filepath.Dir(pending.Target)
	if root, hasRoot := w.Root(); hasRoot {
		if pending.Doc == "" {
			return contract.ImageCopyResult{Failure: failFile("out_of_scope", "文档不在当前工作区内")}, nil
		}
		if within, _ := pathguard.Within(root, pending.Doc); !within {
			return contract.ImageCopyResult{Failure: failFile("out_of_scope", "文档不在当前工作区内")}, nil
		}
		if componentFailure := pathguard.CheckComponents(root, pending.Doc); componentFailure != nil {
			return contract.ImageCopyResult{Failure: contractFailure(componentFailure)}, nil
		}
		if componentFailure := pathguard.CheckComponents(root, filepath.Dir(assetsDir)); componentFailure != nil {
			return contract.ImageCopyResult{Failure: contractFailure(componentFailure)}, nil
		}
	}
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		return contract.ImageCopyResult{Failure: failFile("permission", "无法创建 assets 目录")}, nil
	}
	if root, hasRoot := w.Root(); hasRoot {
		if componentFailure := pathguard.CheckComponents(root, assetsDir); componentFailure != nil {
			return contract.ImageCopyResult{Failure: contractFailure(componentFailure)}, nil
		}
	}
	if _, err := os.Lstat(pending.Target); err == nil {
		// The target shown in the confirmation is now taken; never overwrite.
		return contract.ImageCopyResult{Failure: failFile("image_failed", "目标文件已存在，请重新选择图片")}, nil
	} else if !os.IsNotExist(err) {
		return contract.ImageCopyResult{Failure: failFile("permission", "无法检查目标位置")}, nil
	}
	var writeErr error
	if len(pending.Data) > 0 {
		writeErr = writeNewBytes(pending.Data, pending.Target)
	} else {
		writeErr = copyNewFile(pending.Source, pending.Target)
	}
	if writeErr != nil {
		return contract.ImageCopyResult{Failure: failFile("image_failed", "无法复制图片，原文件未改变")}, nil
	}
	name := filepath.Base(pending.Target)
	return contract.ImageCopyResult{
		Path:     pending.Target,
		Markdown: "assets/" + url.PathEscape(name),
		Name:     name,
	}, nil
}

// CancelImage forgets a pick the page chose not to copy.
func (s *WindowService) CancelImage(ctx context.Context, token string) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	w.ClearPendingImage(token)
	return nil
}

// PickImageFile is the production image picker.
func PickImageFile(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: mygo.CallerWindow(ctx),
		Title:  "插入图片",
		Filters: []mygo.FileFilter{
			{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "gif", "webp"}},
		},
	})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	return paths[0], nil
}

func imageFailure(reason string) *contract.Failure {
	code := "unsupported_type"
	switch {
	case strings.Contains(reason, "20 MiB"), strings.Contains(reason, "像素"):
		code = "too_large"
	case strings.Contains(reason, "不存在"):
		code = "not_found"
	}
	return failFile(code, reason)
}

func imageToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func uniqueImageTarget(dir, name, source string) (string, *contract.Failure) {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 0; i < 1000; i++ {
		candidate := filepath.Join(dir, name)
		if i > 0 {
			candidate = filepath.Join(dir, base+"-"+strconv.Itoa(i)+ext)
		}
		if source != "" && sameFilePath(candidate, source) {
			continue
		}
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		}
	}
	return "", failFile("image_failed", "同名图片过多，请先整理 assets 目录")
}

func copyNewFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	// O_EXCL is the no-overwrite guarantee: two windows copying the same name
	// cannot replace each other, even when they race past the earlier check.
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		out.Close()
		if !keep {
			os.Remove(target)
		}
	}()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	keep = true
	return nil
}

// writeNewBytes writes clipboard image bytes with the same exclusive-create
// guarantee as a file copy.
func writeNewBytes(data []byte, target string) error {
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		out.Close()
		if !keep {
			os.Remove(target)
		}
	}()
	if _, err := out.Write(data); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	keep = true
	return nil
}
