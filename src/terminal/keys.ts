// Which key presses the terminal handles itself rather than sending to
// Claude. Pure, so the table can be tested without a terminal.

export type Platform = "windows" | "linux";
export type KeyAction = "paste" | "copy" | "newline" | "leave" | "pass";

/** The id of the drawer's F6 hint, which describes the terminal's input. */
export const F6_HINT_ID = "claude-f6-hint";

/**
 * What to do with a key event. On Windows Ctrl+V pastes and Ctrl+C copies
 * while text is selected; on Linux only the Shift forms do, so a plain
 * Ctrl+V or Ctrl+C reaches Claude. Ctrl+C with nothing selected is always
 * Claude's interrupt. A plain F6 is left alone: the terminal neither handles
 * it nor sends it, so it reaches the window, which moves the focus out.
 */
export function keyAction(
  e: {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey?: boolean;
    type: string;
  },
  platform: Platform,
  hasSelection: boolean,
): KeyAction {
  if (e.type !== "keydown") return "pass";
  if (e.key === "F6") {
    const plain = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
    return plain ? "leave" : "pass";
  }
  if (e.altKey) return "pass";
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
