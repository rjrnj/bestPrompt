// Which key presses the terminal handles itself rather than sending to
// Claude. Pure, so the table can be tested without a terminal.

export type Platform = "windows" | "linux";
export type KeyAction = "paste" | "copy" | "newline" | "pass";

/**
 * What to do with a key event. On Windows Ctrl+V pastes and Ctrl+C copies
 * while text is selected; on Linux only the Shift forms do, so a plain
 * Ctrl+V or Ctrl+C reaches Claude. Ctrl+C with nothing selected is always
 * Claude's interrupt.
 */
export function keyAction(
  e: {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    type: string;
  },
  platform: Platform,
  hasSelection: boolean,
): KeyAction {
  if (e.type !== "keydown" || e.altKey) return "pass";
  const key = e.key.toLowerCase();
  if (key === "enter") {
    return e.shiftKey && !e.ctrlKey ? "newline" : "pass";
  }
  if (!e.ctrlKey) return "pass";
  if (key === "v") {
    return e.shiftKey || platform === "windows" ? "paste" : "pass";
  }
  if (key === "c" && hasSelection) {
    return e.shiftKey || platform === "windows" ? "copy" : "pass";
  }
  return "pass";
}

/** The keys that paste into the terminal, as the user is told them. */
export function pasteKeys(platform: Platform): string {
  return platform === "windows" ? "Ctrl+V" : "Ctrl+Shift+V";
}

export function currentPlatform(): Platform {
  return navigator.userAgent.includes("Windows") ? "windows" : "linux";
}
