// The xterm terminals, one per Claude Code session. They live here, outside
// React: a terminal keeps Claude's output and answers its queries whether or
// not a view is showing it, and a view only attaches the element.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ApiError,
  pasteClipboard,
  resizeSession,
  startSession,
  writeSession,
} from "../api";
import type { SessionEvent } from "../bindings/SessionEvent";
import type { StartedSession } from "../bindings/StartedSession";
import { writeText } from "../clipboard";
import { currentPlatform, keyAction } from "./keys";

type Entry = {
  terminal: Terminal;
  fit: FitAddon;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
};

const entries = new Map<string, Entry>();

// Always dark, in either app theme: Claude Code's default colours assume a
// dark background, and are hard to read on a light one. The colours are
// slate-900 and slate-100.
const terminalTheme: ITheme = {
  background: "#0f172a",
  foreground: "#f1f5f9",
  cursor: "#f1f5f9",
  cursorAccent: "#0f172a",
  selectionBackground: "#0c4a6e",
  selectionForeground: "#f1f5f9",
};

/**
 * Starts a session in `folder` and the terminal that shows it, with `prompt`
 * for Claude's input box if there is one; `prefilled` in the result says
 * whether it could be passed. The terminal is made first, because the
 * session's output can arrive before its id does.
 */
export async function startTerminalSession(
  folder: string,
  onEvent: (e: SessionEvent) => void,
  { prompt }: { prompt?: string } = {},
): Promise<StartedSession> {
  const terminal = new Terminal({
    scrollback: 5000,
    fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: terminalTheme,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  // Writes made before the session id is known wait here.
  let id: string | null = null;
  const queued: string[] = [];
  // Once the session has ended, typing and resizes have nowhere to go and
  // are dropped.
  let ended = false;
  const failed = (message: string, error: unknown) => {
    // The only way a write, paste or resize reports a session that's gone.
    if (error instanceof ApiError && error.kind === "notFound") {
      // Calls already in flight fail the same way; say so once.
      if (ended) return;
      ended = true;
    }
    console.error(message, error);
  };
  const send = (data: string) => {
    if (ended) return;
    if (id === null) {
      queued.push(data);
      return;
    }
    writeSession(id, data).catch((error: unknown) => {
      failed("Could not write to the session", error);
    });
  };
  const subscriptions = [terminal.onData(send), terminal.onBinary(send)];
  const resize = (cols: number, rows: number) => {
    if (ended || id === null) return;
    resizeSession(id, cols, rows).catch((error: unknown) => {
      failed("Could not resize the session", error);
    });
  };

  terminal.attachCustomKeyEventHandler((e) => {
    switch (keyAction(e, currentPlatform(), terminal.hasSelection())) {
      case "paste":
        e.preventDefault();
        // The backend reads the clipboard and writes it to the session; the
        // webview may not read it.
        if (id !== null && !ended) {
          pasteClipboard(id).catch((error: unknown) => {
            failed("Could not paste into the session", error);
          });
        }
        return false;
      case "copy":
        e.preventDefault();
        writeText(terminal.getSelection()).catch((error: unknown) => {
          console.error("Could not copy the selection", error);
        });
        // As in Windows Terminal: the next Ctrl+C then reaches Claude.
        terminal.clearSelection();
        return false;
      case "newline":
        e.preventDefault();
        send("\n");
        return false;
      case "pass":
        return true;
    }
  });

  // Output that arrives after the terminal is gone is dropped.
  let disposed = false;
  const dispose = () => {
    disposed = true;
    subscriptions.forEach((s) => s.dispose());
    terminal.dispose();
  };

  let started: StartedSession;
  try {
    started = await startSession(
      folder,
      { cols: terminal.cols, rows: terminal.rows },
      prompt ?? null,
      (bytes) => {
        if (disposed) return;
        terminal.write(bytes);
      },
      (event) => {
        if (event.type === "exited") ended = true;
        onEvent(event);
      },
    );
  } catch (error) {
    dispose();
    throw error;
  }
  id = started.id;
  entries.set(id, { terminal, fit, resize, dispose });
  queued.splice(0).forEach(send);
  return started;
}

export function terminalFor(sessionId: string): Terminal | undefined {
  return entries.get(sessionId)?.terminal;
}

/** The fit addon of the session's terminal. */
export function fitFor(sessionId: string): FitAddon | undefined {
  return entries.get(sessionId)?.fit;
}

/** Tells the session its terminal's new size, unless it has ended. */
export function resizeTerminalSession(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  entries.get(sessionId)?.resize(cols, rows);
}

/** Disposes the terminal. The caller closes the session. */
export function disposeTerminal(sessionId: string): void {
  entries.get(sessionId)?.dispose();
  entries.delete(sessionId);
}
