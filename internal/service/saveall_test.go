package service

import (
	"context"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/contract"
)

func TestSaveAllAsksEachWindowAndSummarizes(t *testing.T) {
	h := newRefreshHarness(t, 70)
	h.reg.Add(71)
	current := 70
	h.service.caller = func(context.Context) (int, bool) { return current, true }
	var requested []int
	h.service.saveAllRequest = func(windowID, _ int) bool { requested = append(requested, windowID); return true }
	done := make(chan contract.SaveAllSummary, 1)
	h.service.saveAllDone = func(_ int, summary contract.SaveAllSummary) { done <- summary }

	start, err := h.service.SaveAll(context.Background())
	if err != nil {
		t.Fatalf("SaveAll: %v", err)
	}
	if len(requested) != 1 {
		t.Fatalf("requested = %v, want one window", requested)
	}
	current = requested[0]
	if err := h.service.ReportSaveAll(context.Background(), start.RequestID, "一.md", "saved", ""); err != nil {
		t.Fatalf("first report: %v", err)
	}
	if len(requested) != 2 {
		t.Fatalf("requested = %v, want the second window", requested)
	}
	current = requested[1]
	if err := h.service.ReportSaveAll(context.Background(), start.RequestID, "二.md", "failed", "磁盘忙"); err != nil {
		t.Fatalf("second report: %v", err)
	}
	summary := <-done
	if summary.Saved != 1 || summary.Failed != 1 || summary.Unhandled != 0 {
		t.Fatalf("summary = %+v", summary)
	}
	if len(summary.Results) != 2 || summary.Results[1].Message != "磁盘忙" {
		t.Fatalf("results = %+v", summary.Results)
	}
}

func TestSaveAllRejectsAnOutOfOrderReport(t *testing.T) {
	h := newRefreshHarness(t, 80)
	h.reg.Add(81)
	current := 80
	h.service.caller = func(context.Context) (int, bool) { return current, true }
	h.service.saveAllRequest = func(int, int) bool { return true }

	start, err := h.service.SaveAll(context.Background())
	if err != nil {
		t.Fatalf("SaveAll: %v", err)
	}
	current = 81
	if err := h.service.ReportSaveAll(context.Background(), start.RequestID, "二.md", "saved", ""); err == nil {
		t.Fatal("an out-of-order report was accepted")
	}
	current = 80
	if err := h.service.ReportSaveAll(context.Background(), start.RequestID, "一.md", "saved", ""); err != nil {
		t.Fatalf("ordered report: %v", err)
	}
}

func TestSaveAllWindowClosedIsUnhandled(t *testing.T) {
	h := newRefreshHarness(t, 90)
	h.reg.Add(91)
	current := 90
	h.service.caller = func(context.Context) (int, bool) { return current, true }
	var requested []int
	h.service.saveAllRequest = func(windowID, _ int) bool { requested = append(requested, windowID); return true }
	done := make(chan contract.SaveAllSummary, 1)
	h.service.saveAllDone = func(_ int, summary contract.SaveAllSummary) { done <- summary }

	start, err := h.service.SaveAll(context.Background())
	if err != nil {
		t.Fatalf("SaveAll: %v", err)
	}
	current = requested[0]
	if err := h.service.ReportSaveAll(context.Background(), start.RequestID, "一.md", "saved", ""); err != nil {
		t.Fatalf("report: %v", err)
	}
	// The second window closes before it can report.
	closed := requested[1]
	h.service.SaveAllWindowClosed(closed)
	summary := <-done
	if summary.Saved != 1 || summary.Unhandled != 1 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestSaveAllSkipsAnUndeliverableWindow(t *testing.T) {
	h := newRefreshHarness(t, 100)
	h.reg.Add(101)
	current := 100
	h.service.caller = func(context.Context) (int, bool) { return current, true }
	calls := 0
	var requested []int
	h.service.saveAllRequest = func(windowID, _ int) bool {
		calls++
		if calls == 1 {
			return false
		}
		requested = append(requested, windowID)
		return true
	}
	done := make(chan contract.SaveAllSummary, 1)
	h.service.saveAllDone = func(_ int, summary contract.SaveAllSummary) { done <- summary }

	start, err := h.service.SaveAll(context.Background())
	if err != nil {
		t.Fatalf("SaveAll: %v", err)
	}
	if len(requested) != 1 {
		t.Fatalf("requested = %v, want the second window", requested)
	}
	current = requested[0]
	if err := h.service.ReportSaveAll(context.Background(), start.RequestID, "二.md", "saved", ""); err != nil {
		t.Fatalf("report: %v", err)
	}
	summary := <-done
	if summary.Saved != 1 || summary.Unhandled != 1 {
		t.Fatalf("summary = %+v", summary)
	}
}
