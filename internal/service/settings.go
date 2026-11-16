package service

import (
	"context"
	"log"
	"path/filepath"
	"strings"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
	"github.com/lhmile489-design/mile-typora/internal/contract"
)

// GetSettings hands the page the settings and the recent list. A damaged file
// is reported rather than hidden (PRD FR-10.11).
func (s *WindowService) GetSettings(ctx context.Context) (contract.SettingsResult, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.SettingsResult{}, err
	}
	if s.state == nil {
		return contract.SettingsResult{
			Settings: contract.SettingsView{Startup: appstate.StartupBlank, Appearance: appstate.AppearanceSystem},
			Failure: &contract.Failure{
				Code:   "settings_unavailable",
				Detail: "设置无法读取，本次按默认设置启动",
			},
		}, nil
	}
	stored := s.state.Get()
	_, corrupt := s.state.Corrupt()
	result := contract.SettingsResult{
		Settings: contract.SettingsView{
			Startup:    stored.Startup,
			Appearance: stored.Appearance,
			Recent:     recentView(stored.Recent),
		},
		Corrupt: corrupt,
	}
	if corrupt {
		result.Failure = &contract.Failure{
			Code:   "settings_corrupt",
			Detail: "设置文件损坏，已按默认设置启动，原文件已保留",
		}
	}
	return result, nil
}

// SaveSettings writes the settings the page edited. A failed write keeps the
// previous settings (PRD FR-10.2).
func (s *WindowService) SaveSettings(ctx context.Context, view contract.SettingsView) (contract.SaveOutcome, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.SaveOutcome{}, err
	}
	if s.state == nil {
		return contract.SaveOutcome{Failure: &contract.Failure{
			Code:   "settings_write_failed",
			Detail: "本次设置未保存",
		}}, nil
	}
	current := s.state.Get()
	next := appstate.Settings{
		Startup:    view.Startup,
		Appearance: view.Appearance,
		Recent:     current.Recent, // the page never replaces the list
	}
	if err := s.state.Save(next); err != nil {
		log.Printf("settings: cannot save: %v", err)
		return contract.SaveOutcome{Failure: &contract.Failure{
			Code:   "settings_write_failed",
			Detail: "本次设置未保存",
		}}, nil
	}
	return contract.SaveOutcome{}, nil
}

// ClearRecent empties the recent list (PRD FR-10.10). The resume target goes
// with it once M3-2 keeps one.
func (s *WindowService) ClearRecent(ctx context.Context) (contract.SaveOutcome, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.SaveOutcome{}, err
	}
	if s.state == nil {
		return contract.SaveOutcome{Failure: &contract.Failure{
			Code:   "settings_write_failed",
			Detail: "本次操作未保存",
		}}, nil
	}
	if err := s.state.ClearRecent(); err != nil {
		log.Printf("settings: cannot clear the recent list: %v", err)
		return contract.SaveOutcome{Failure: &contract.Failure{
			Code:   "settings_write_failed",
			Detail: "本次操作未保存",
		}}, nil
	}
	return contract.SaveOutcome{}, nil
}

// OpenRecent opens an entry of the recent list. The path must be one the app
// recorded itself, so the page cannot ask for an arbitrary file (PRD FR-08).
func (s *WindowService) OpenRecent(ctx context.Context, path string) (contract.OpenRequestResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.OpenRequestResult{}, err
	}
	if s.state == nil {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code:   "not_found",
			Detail: "最近记录不可用",
		}}, nil
	}
	var entry appstate.Recent
	found := false
	for _, candidate := range s.state.Get().Recent {
		if strings.EqualFold(candidate.Path, path) {
			entry, found = candidate, true
			break
		}
	}
	if !found {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code:   "not_found",
			Detail: "这条最近记录已失效",
		}}, nil
	}
	if entry.IsDir {
		return s.openFolderPath(w, entry.Path)
	}
	return s.openKind(ctx, w, winctxKindFile, entry.Path)
}

// recordRecent remembers what the window opened, without failing the open when
// the settings cannot be written (PRD FR-10.2: a failed save never blocks
// reading).
func (s *WindowService) recordRecent(path string, isDir bool) {
	if s.state == nil {
		return
	}
	if err := s.state.AddRecent(path, isDir); err != nil {
		log.Printf("settings: cannot remember the last opened target: %v", err)
	}
}

// recentView turns stored entries into what the page draws.
func recentView(entries []appstate.Recent) []contract.RecentEntry {
	if len(entries) == 0 {
		return nil
	}
	out := make([]contract.RecentEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, contract.RecentEntry{
			Path:  entry.Path,
			Name:  filepath.Base(entry.Path),
			IsDir: entry.IsDir,
		})
	}
	return out
}
