// The app's colour theme: which of light and dark is showing, kept in step
// with the saved choice and, for "system", with the OS.

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeChoice } from "./bindings/ThemeChoice";

/**
 * Where the choice is cached so public/theme-init.js can apply it before the
 * first paint, ahead of the settings loading.
 */
export const THEME_CACHE_KEY = "bestprompt.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The media query list and handler of the one OS listener, if any. */
let osListener: { query: MediaQueryList; handler: () => void } | null = null;

/**
 * The window theme last set; null is the window's own default, which it
 * has until the first call. The window is only told about a change: on
 * Linux, "follow the system" resets GTK's dark preference, so asking for it
 * at startup could turn a dark desktop's window light.
 */
let lastWindowTheme: "light" | "dark" | null = null;

function stopFollowingOs() {
  osListener?.query.removeEventListener("change", osListener.handler);
  osListener = null;
}

function setResolved(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/**
 * Shows `choice`: sets `data-theme` and `color-scheme` on the root, follows
 * the OS while the choice is "system", caches the choice for the next
 * start, and asks the window to match its title bar where the platform
 * allows. The cache and the window are best effort and never throw.
 */
export function applyTheme(choice: ThemeChoice): void {
  stopFollowingOs();
  if (choice === "system") {
    const query = window.matchMedia(DARK_QUERY);
    const handler = () => setResolved(query.matches ? "dark" : "light");
    query.addEventListener("change", handler);
    osListener = { query, handler };
    handler();
  } else {
    setResolved(choice);
  }

  try {
    localStorage.setItem(THEME_CACHE_KEY, choice);
  } catch {
    // Storage can be blocked; the cache only serves the first paint.
  }

  const windowTheme = choice === "system" ? null : choice;
  if (windowTheme === lastWindowTheme) return;
  lastWindowTheme = windowTheme;
  try {
    getCurrentWindow()
      .setTheme(windowTheme)
      .catch((error: unknown) => {
        console.warn("The window theme could not be set:", error);
      });
  } catch (error) {
    console.warn("The window theme could not be set:", error);
  }
}

/** Forgets which window theme was last set. For tests. */
export function resetWindowThemeForTests(): void {
  lastWindowTheme = null;
}
