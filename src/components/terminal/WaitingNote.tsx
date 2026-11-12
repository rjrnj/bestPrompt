import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { hasOwn } from "../../hasOwn";
import {
  useAppActions,
  useAppDispatch,
  useAppState,
} from "../../state/AppState";
import { NO_PROJECT_KEY } from "../../state/reducer";
import { Cross } from "../icons";
import { linkButton, noteBar, noteCloseButton } from "../styles";

const NOTE_TEXT =
  "Your prompt is waiting. Answer Claude's questions below and it will appear in Claude's input box. Then press Enter to run it.";

/**
 * Under the drawer's header: tells the user that the prompt they sent is
 * waiting in Claude, behind any setup questions, until they close the note
 * or the session ends. It never takes the focus; `NoteAnnouncer` says it
 * aloud.
 */
export function WaitingNote() {
  const { sessions, selectedProjectId } = useAppState();
  const key = selectedProjectId ?? NO_PROJECT_KEY;
  const session = hasOwn(sessions, key) ? sessions[key] : null;
  if (session === null || !session.note) return null;
  // Keyed by session, so each starts with its explanation folded.
  return <NoteBar key={session.id} sessionKey={key} sessionId={session.id} />;
}

/**
 * Closing the note by its button removes the focused element, which
 * leaves the focus on the page: it goes to the session's terminal, or to
 * the drawer's first button when there is none. Left alone if the user
 * has moved it since.
 */
async function focusAfterNote(sessionId: string, drawer: Element | null) {
  const { terminalFor } = await import("../../terminal/terminals");
  const focused = document.activeElement;
  if (focused !== null && focused !== document.body) return;
  const terminal = terminalFor(sessionId);
  if (terminal !== undefined) terminal.focus();
  else drawer?.querySelector<HTMLElement>("button")?.focus();
}

function NoteBar({
  sessionKey,
  sessionId,
}: {
  sessionKey: string;
  sessionId: string;
}) {
  const { settings } = useAppState();
  const dispatch = useAppDispatch();
  const { saveSetting } = useAppActions();
  const [open, setOpen] = useState(false);
  const whyId = useId();
  const bar = useRef<HTMLDivElement>(null);
  // Known when the note appears, so closing it counts the explanation as
  // seen only if it was on offer.
  const [offered] = useState(settings?.sendHintSeen !== true);

  return (
    <div ref={bar} className={noteBar}>
      <div className="min-w-0 flex-1">
        <p>
          {NOTE_TEXT}
          {offered && (
            <>
              {" "}
              <button
                type="button"
                className={linkButton}
                aria-expanded={open}
                aria-controls={whyId}
                onClick={() => setOpen(!open)}
              >
                Why?
              </button>
            </>
          )}
        </p>
        {offered && (
          <p id={whyId} hidden={!open} className="text-xs">
            On its first run, and when it opens a folder it hasn&apos;t seen,
            Claude asks a few setup questions before it shows your prompt.
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Close note"
        className={noteCloseButton}
        onClick={() => {
          const drawer = bar.current?.closest("section") ?? null;
          if (offered) void saveSetting({ sendHintSeen: true });
          flushSync(() =>
            dispatch({
              type: "waitingNoteClosed",
              key: sessionKey,
              id: sessionId,
            }),
          );
          void focusAfterNote(sessionId, drawer);
        }}
      >
        <Cross />
      </button>
    </div>
  );
}

/**
 * A visually hidden live region, mounted for the life of the app and empty
 * until a note shows: a screen reader reliably announces text that is put
 * into a region it already knows, but not one that arrives with its text,
 * as the drawer does when a send opens it. The text goes in on the render
 * after the note appears, and goes when the note does, silently.
 */
export function NoteAnnouncer() {
  const { sessions, selectedProjectId } = useAppState();
  const key = selectedProjectId ?? NO_PROJECT_KEY;
  const showing = hasOwn(sessions, key) && sessions[key].note;
  const [text, setText] = useState("");
  useEffect(() => {
    // Set from an effect on purpose: the region must be empty when the
    // note appears, and hold the text only on a later render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(showing ? NOTE_TEXT : "");
  }, [showing]);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {text}
    </div>
  );
}
