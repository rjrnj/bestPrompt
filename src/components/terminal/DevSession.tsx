// Temporary: a control for trying a real Claude Code session by hand. It is
// shown only in `npm run dev` and goes when the terminal drawer lands.

import { useState } from "react";
import { closeSession, pickFolder } from "../../api";
import {
  disposeTerminal,
  startTerminalSession,
} from "../../terminal/terminals";
import { primaryButton, secondaryButton } from "../styles";
import { TerminalView } from "./TerminalView";

// Lines that check how Claude reads its argument: quotes, a path ending in
// a backslash before `\"`, cmd.exe's special characters, a leading dash,
// non-ASCII and emoji, and a tab.
const SPECIAL_LINES: Record<number, string> = {
  2: `2. Repeat "double quotes" and 'single' exactly.`,
  3: String.raw`3. The folder C:\Program Files\x\ and then \"escaped\" quotes.`,
  4: "4. Keep %PATH%, ^, &, |, < and > as they are.",
  5: "--version is line 5, which starts with a dash.",
  6: "6. naïve ✓ 🚀",
  7: "7.\tThis line has a tab after its number.",
};

// 40 lines, with a few blank ones and no trailing newline.
const PROMPT = [
  "1. Read the README and summarise it.",
  ...Array.from({ length: 39 }, (_, i) => {
    const n = i + 2;
    if (n % 10 === 0) return "";
    return SPECIAL_LINES[n] ?? `${n}. Line number ${n} of the test prompt.`;
  }),
].join("\n");

const TRACE_BYTES = 8192;

/** Control bytes made visible: ESC as `\e`, the rest as `\xNN`. */
function escaped(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte === 0x1b) text += "\\e";
    else if (byte < 0x20 || byte === 0x7f) {
      text += `\\x${byte.toString(16).padStart(2, "0")}`;
    } else text += String.fromCharCode(byte);
  }
  return text;
}

export function DevSession() {
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState("no session");
  const [prefill, setPrefill] = useState("");

  async function open(prompt?: string) {
    const folder = await pickFolder();
    if (folder === null) return;
    const started = performance.now();
    let traced = 0;
    try {
      const session = await startTerminalSession(
        folder,
        (e) => setStatus(`exited with code ${e.code ?? "none"}`),
        {
          prompt,
          onTrace: (bytes) => {
            if (traced >= TRACE_BYTES) return;
            traced += bytes.length;
            console.debug(
              "[claude-trace]",
              Math.round(performance.now() - started),
              escaped(bytes),
            );
          },
        },
      );
      setId(session.id);
      setStatus("running");
      if (prompt === undefined) setPrefill("");
      else setPrefill(session.prefilled ? "prefilled" : "not prefilled");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function close() {
    if (id === null) return;
    try {
      await closeSession(id);
    } catch (error) {
      console.error("Could not close the session", error);
    }
    disposeTerminal(id);
    setId(null);
    setStatus("no session");
    setPrefill("");
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <button type="button" className={primaryButton} onClick={() => open()}>
          Open test session
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => open(PROMPT)}
        >
          Open with test prompt
        </button>
        <button type="button" className={secondaryButton} onClick={close}>
          Close
        </button>
        <span>{status}</span>
        <span>{prefill}</span>
      </div>
      {id !== null && (
        <div className="h-80">
          <TerminalView sessionId={id} />
        </div>
      )}
    </div>
  );
}
