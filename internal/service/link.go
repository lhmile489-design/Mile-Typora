package service

import (
	"context"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// OpenLink decides what a link in a document means and does the part only Go
// can do: a confirmation before leaving the app, the browser, another window.
// The page scrolls anchors and opens documents from the tree (PRD FR-06).
func (s *WindowService) OpenLink(ctx context.Context, href string) (contract.LinkTarget, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.LinkTarget{}, err
	}
	link := strings.TrimSpace(href)
	if link == "" {
		return blocked("链接为空"), nil
	}
	if strings.HasPrefix(link, "#") {
		return contract.LinkTarget{Kind: "anchor", Anchor: strings.TrimPrefix(link, "#")}, nil
	}
	if hasScheme(link) {
		return s.externalLink(ctx, link)
	}
	return s.documentLink(ctx, w, link)
}

// externalLink confirms and hands an http(s) link to the system browser.
func (s *WindowService) externalLink(ctx context.Context, raw string) (contract.LinkTarget, error) {
	lower := strings.ToLower(raw)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return blocked("不支持此链接类型"), nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return blocked("链接地址无效"), nil
	}
	// A document must never reach the network on its own (PRD §8.4): the
	// user opens it, and only after saying yes.
	if !s.confirm(ctx, "即将访问外部站点", "要在默认浏览器中打开这个链接吗？", raw) {
		return contract.LinkTarget{Kind: "cancelled"}, nil
	}
	if err := s.external(parsed.String()); err != nil {
		return blocked("无法打开浏览器"), nil
	}
	return contract.LinkTarget{Kind: "handled"}, nil
}

// documentLink opens a Markdown link: within the window's folder here, from
// outside it only after a confirmation, in a window of its own.
func (s *WindowService) documentLink(ctx context.Context, w *winctx.Window, raw string) (contract.LinkTarget, error) {
	unescaped, err := url.PathUnescape(raw)
	if err != nil {
		return blocked("链接地址无效"), nil
	}
	// A query or fragment is not part of the file name.
	if i := strings.IndexAny(unescaped, "?#"); i >= 0 {
		unescaped = unescaped[:i]
	}
	if unescaped == "" {
		return contract.LinkTarget{Kind: "anchor"}, nil
	}
	if strings.HasPrefix(unescaped, "/") || strings.HasPrefix(unescaped, `\`) ||
		filepath.IsAbs(unescaped) || filepath.VolumeName(unescaped) != "" {
		return blocked("只能打开文档目录内的链接"), nil
	}
	if !pathguard.MarkdownExt(unescaped) {
		return contract.LinkTarget{
			Kind:   "attachment",
			Reason: "暂不支持打开此类附件",
		}, nil
	}

	root, hasRoot := w.Root()
	if !hasRoot {
		// Single-file mode: the file's own folder is the scope.
		file, hasFile := w.OpenFile()
		if !hasFile {
			return blocked("尚未打开文档"), nil
		}
		root = filepath.Dir(file)
	}
	target := filepath.Join(root, filepath.FromSlash(unescaped))
	if within, _ := pathguard.Within(root, filepath.Clean(target)); !within {
		return blocked("只能打开文档目录内的链接"), nil
	}

	real, pathFailure := pathguard.Canon(target)
	if pathFailure != nil {
		return blocked("链接指向的文件不存在"), nil
	}
	if within, _ := pathguard.Within(root, real); !within {
		return blocked("只能打开文档目录内的链接"), nil
	}
	if componentFailure := pathguard.CheckComponents(root, real); componentFailure != nil {
		return blocked(componentFailure.Detail), nil
	}

	if hasRoot {
		rel, err := filepath.Rel(root, real)
		if err != nil {
			return blocked("只能打开文档目录内的链接"), nil
		}
		return contract.LinkTarget{Kind: "document", Rel: filepath.ToSlash(rel)}, nil
	}

	// Outside the folder the window browses: the user decides (PRD FR-06.3).
	if !s.confirm(ctx, "打开工作区外的文件", "这个链接指向当前目录之外的文件，要打开吗？", real) {
		return contract.LinkTarget{Kind: "cancelled"}, nil
	}
	if err := s.handOff(winctx.KindFile, real); err != nil {
		return blocked("无法打开新窗口"), nil
	}
	return contract.LinkTarget{Kind: "handled"}, nil
}

func blocked(reason string) contract.LinkTarget {
	return contract.LinkTarget{Kind: "blocked", Reason: reason}
}

// ConfirmNative asks the user with a native dialog. The first button is the
// safe answer: a stray Enter cancels, never opens.
func ConfirmNative(ctx context.Context, title, message, detail string) bool {
	result, err := mygo.Dialog.Message(mygo.MessageOptions{
		Parent:        mygo.CallerWindow(ctx),
		Type:          mygo.MessageQuestion,
		Title:         title,
		Message:       message,
		Detail:        detail,
		Buttons:       []string{"取消", "打开"},
		DefaultButton: 0,
		CancelButton:  0,
	})
	if err != nil {
		return false
	}
	return result.Button == 1
}
