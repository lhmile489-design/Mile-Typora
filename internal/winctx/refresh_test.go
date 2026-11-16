package winctx

import "testing"

func TestNextRefreshNumbersAndDetectsStale(t *testing.T) {
	reg := NewRegistry()
	w := reg.Add(1)

	first := w.NextRefresh()
	second := w.NextRefresh()
	if second <= first {
		t.Fatalf("seqs %d then %d, want an increase", first, second)
	}
	if w.IsLatestRefresh(first) {
		t.Fatal("an overtaken reload passed as the latest")
	}
	if !w.IsLatestRefresh(second) {
		t.Fatal("the newest reload did not pass")
	}
}
