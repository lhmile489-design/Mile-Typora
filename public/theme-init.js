// Sets data-theme before React mounts, so the first frame has the right
// colors (DESIGN.md §1). A separate file because the production CSP forbids
// inline scripts. M3-3 resolves the saved preference; until then the theme
// follows Windows.
(function () {
  var root = document.documentElement;
  // The window's preload script already set an explicit preference; only the
  // system mode is left to decide here (DESIGN.md §1).
  if (root.getAttribute("data-theme")) return;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    root.setAttribute("data-theme", media.matches ? "dark" : "light");
  }
  apply();
  media.addEventListener("change", function () {
    // A choice made in the app wins over the desktop.
    if (!root.getAttribute("data-theme-pinned")) apply();
  });
})();
