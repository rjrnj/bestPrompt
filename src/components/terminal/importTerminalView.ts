/**
 * Loads the terminal view, and xterm.js with it, which come with the first
 * session shown rather than with the app. On its own so tests can make the
 * load fail.
 */
export function importTerminalView() {
  return import("./TerminalView");
}
