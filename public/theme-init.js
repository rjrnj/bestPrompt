// Sets the theme before the first paint, from the choice src/theme.ts cached.
// The app takes over once its settings load.
(function () {
  var choice = "system";
  try {
    var cached = localStorage.getItem("bestprompt.theme");
    if (cached === "light" || cached === "dark") choice = cached;
  } catch {
    // Storage is blocked: follow the OS.
  }
  var theme =
    choice === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : choice;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
