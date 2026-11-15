// Finding and focusing the session's terminal through the page, so nothing
// here pulls xterm in: the terminal's code loads only when a session starts.
// Only the selected session's terminal is in the page.

/** The terminal's own wrapper, which xterm gives its class. */
const XTERM = ".xterm";
/** The input xterm keeps the keyboard focus in. */
const INPUT = "textarea.xterm-helper-textarea";

/** Whether the focus is in the terminal inside `drawer`. */
export function focusIsInTerminal(drawer: Element | null): boolean {
  const terminal = document.activeElement?.closest(XTERM);
  return terminal != null && drawer !== null && drawer.contains(terminal);
}

/** The terminal's input inside `drawer`, once it has opened. */
export function terminalInput(drawer: Element | null): HTMLElement | null {
  return drawer?.querySelector<HTMLElement>(INPUT) ?? null;
}
