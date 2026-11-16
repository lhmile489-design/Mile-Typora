package service

import (
	"context"
	"errors"
	"time"

	"github.com/lhmile489-design/mile-typora/internal/contract"
)

// saveAllRun is one save-all pass: windows are asked one at a time so the
// save dialogs (untitled buffers, conflicts) never fight for focus.
type saveAllRun struct {
	id        int
	initiator int
	queue     []int
	results   []contract.SaveAllResult
	timer     *time.Timer
}

var errSaveAllBusy = errors.New("保存全部正在进行")

// SaveAll starts a run over every open window and asks the first one to save.
func (s *WindowService) SaveAll(ctx context.Context) (contract.SaveAllStart, error) {
	caller, ok := s.caller(ctx)
	if !ok {
		return contract.SaveAllStart{}, ErrNoCallerWindow
	}
	ids := s.windows.IDs()
	if len(ids) == 0 {
		return contract.SaveAllStart{}, ErrWindowNotOpen
	}

	s.saveAllMu.Lock()
	if s.saveAll != nil {
		s.saveAllMu.Unlock()
		return contract.SaveAllStart{}, errSaveAllBusy
	}
	run := &saveAllRun{
		id:        int(s.saveAllSeq.Add(1)),
		initiator: caller,
		queue:     ids,
	}
	run.timer = time.AfterFunc(5*time.Minute, func() { s.timeoutSaveAll(run.id) })
	s.saveAll = run
	s.saveAllMu.Unlock()

	s.advanceSaveAll()
	return contract.SaveAllStart{RequestID: run.id}, nil
}

// ReportSaveAll records one window's result and moves to the next window.
func (s *WindowService) ReportSaveAll(ctx context.Context, requestID int, name, status, message string) error {
	caller, ok := s.caller(ctx)
	if !ok {
		return ErrNoCallerWindow
	}
	if name == "" {
		name = "未命名"
	}
	switch status {
	case "clean", "saved", "failed", "unhandled":
	default:
		status = "failed"
		if message == "" {
			message = "未知结果"
		}
	}

	s.saveAllMu.Lock()
	run := s.saveAll
	if run == nil || run.id != requestID || len(run.queue) == 0 || run.queue[0] != caller {
		s.saveAllMu.Unlock()
		return errors.New("保存全部请求已失效")
	}
	run.queue = run.queue[1:]
	run.results = append(run.results, contract.SaveAllResult{
		WindowID: caller,
		Name:     name,
		Status:   status,
		Message:  message,
	})
	if len(run.queue) > 0 {
		s.saveAllMu.Unlock()
		s.advanceSaveAll()
		return nil
	}
	if run.timer != nil {
		run.timer.Stop()
	}
	summary := summarizeSaveAll(run)
	s.saveAll = nil
	s.saveAllMu.Unlock()

	if s.saveAllDone != nil {
		s.saveAllDone(run.initiator, summary)
	}
	return nil
}

// SaveAllWindowClosed drops a closed window from the current run.
func (s *WindowService) SaveAllWindowClosed(windowID int) {
	s.saveAllMu.Lock()
	run := s.saveAll
	if run == nil {
		s.saveAllMu.Unlock()
		return
	}
	current := len(run.queue) > 0 && run.queue[0] == windowID
	found := false
	next := run.queue[:0]
	for _, id := range run.queue {
		if id == windowID {
			found = true
			continue
		}
		next = append(next, id)
	}
	if !found {
		s.saveAllMu.Unlock()
		return
	}
	run.queue = next
	run.results = append(run.results, contract.SaveAllResult{
		WindowID: windowID,
		Name:     "窗口 " + itoa(windowID),
		Status:   "unhandled",
		Message:  "窗口已关闭",
	})
	if len(run.queue) > 0 {
		s.saveAllMu.Unlock()
		if current {
			s.advanceSaveAll()
		}
		return
	}
	if run.timer != nil {
		run.timer.Stop()
	}
	summary := summarizeSaveAll(run)
	s.saveAll = nil
	s.saveAllMu.Unlock()
	if s.saveAllDone != nil {
		s.saveAllDone(run.initiator, summary)
	}
}

func (s *WindowService) advanceSaveAll() {
	s.saveAllMu.Lock()
	run := s.saveAll
	if run == nil || len(run.queue) == 0 {
		s.saveAllMu.Unlock()
		return
	}
	windowID := run.queue[0]
	requestID := run.id
	s.saveAllMu.Unlock()
	delivered := s.saveAllRequest != nil && s.saveAllRequest(windowID, requestID)
	if !delivered {
		s.failSaveAllDelivery(windowID, requestID)
	}
}

func (s *WindowService) failSaveAllDelivery(windowID, requestID int) {
	s.saveAllMu.Lock()
	run := s.saveAll
	if run == nil || run.id != requestID || len(run.queue) == 0 || run.queue[0] != windowID {
		s.saveAllMu.Unlock()
		return
	}
	run.queue = run.queue[1:]
	run.results = append(run.results, contract.SaveAllResult{
		WindowID: windowID,
		Name:     "窗口 " + itoa(windowID),
		Status:   "unhandled",
		Message:  "无法送达窗口",
	})
	if len(run.queue) > 0 {
		s.saveAllMu.Unlock()
		s.advanceSaveAll()
		return
	}
	if run.timer != nil {
		run.timer.Stop()
	}
	summary := summarizeSaveAll(run)
	s.saveAll = nil
	s.saveAllMu.Unlock()
	if s.saveAllDone != nil {
		s.saveAllDone(run.initiator, summary)
	}
}

func (s *WindowService) timeoutSaveAll(requestID int) {
	s.saveAllMu.Lock()
	run := s.saveAll
	if run == nil || run.id != requestID {
		s.saveAllMu.Unlock()
		return
	}
	for _, id := range run.queue {
		run.results = append(run.results, contract.SaveAllResult{
			WindowID: id,
			Name:     "窗口 " + itoa(id),
			Status:   "unhandled",
			Message:  "窗口未响应",
		})
	}
	run.queue = nil
	summary := summarizeSaveAll(run)
	s.saveAll = nil
	s.saveAllMu.Unlock()
	if s.saveAllDone != nil {
		s.saveAllDone(run.initiator, summary)
	}
}

func summarizeSaveAll(run *saveAllRun) contract.SaveAllSummary {
	summary := contract.SaveAllSummary{RequestID: run.id, Results: run.results}
	for _, result := range run.results {
		switch result.Status {
		case "saved":
			summary.Saved++
		case "failed":
			summary.Failed++
		case "unhandled":
			summary.Unhandled++
		}
	}
	return summary
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}
