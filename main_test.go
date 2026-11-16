package main

import (
	"testing"
)

func TestIsAppURL(t *testing.T) {
	t.Setenv("MYGO_DEV", "")
	cases := map[string]bool{
		"":                                  true,
		"about:blank":                       true,
		"http://mygo.localhost/":            true,
		"http://mygo.localhost/index.html":  true,
		"https://example.com/":              false,
		"http://localhost:5273/":            false, // the dev server is not allowed outside development
		"javascript:alert(1)":               false,
		"file:///C:/Windows/System32/a.txt": false,
		"mtres://localhost/abc":             false,
	}
	for raw, want := range cases {
		if got := isAppURL(raw); got != want {
			t.Errorf("isAppURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestIsAppURLAllowsTheDevServerWhileDeveloping(t *testing.T) {
	t.Setenv("MYGO_DEV", "1")
	for _, raw := range []string{
		"http://localhost:5273/",
		"http://127.0.0.1:5273/index.html",
	} {
		if !isAppURL(raw) {
			t.Errorf("isAppURL(%q) = false during development, want true", raw)
		}
	}
	// Another port is not the app's page.
	if isAppURL("http://localhost:5173/") {
		t.Error("isAppURL allowed a different dev port")
	}
}
