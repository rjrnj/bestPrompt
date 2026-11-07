import { useId, useState } from "react";
import { hasOwn } from "../hasOwn";
import { useAppActions, useAppDispatch, useAppState } from "../state/AppState";
import { currentTitle, NO_PROJECT_KEY } from "../state/reducer";
import { useCurrentPrompt } from "../state/useCurrentPrompt";
// Pure: xterm stays out of the main chunk.
import { currentPlatform, pasteKeys } from "../terminal/keys";
import { fieldHelp, primaryButton, secondaryButton } from "./styles";

/** The Show Claude Code button's id, so Hide can hand it the focus. */
export const SHOW_DRAWER_ID = "show-claude-code";

/**
 * Copy, Save and Clear for the selected framework's draft. Copy and Save
 * are offered only when the preview shows a prompt, and not while a save or
 * a send is running; Clear whenever the draft or the title has any text,
 * whitespace included. Send to Claude Code shows once Claude Code is found,
 * and is offered as Copy is, except while the project's session is running.
 * Show Claude Code brings back the hidden drawer.
 * Renders nothing until a framework is selected.
 */
export function PromptActions() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { copy, save, send } = useAppActions();
  const current = useCurrentPrompt();
  const [sending, setSending] = useState(false);
  const hintId = useId();
  if (current === null) return null;
  const { framework, draft, prompt, hasPrompt } = current;

  // Copy and Save wait for a send too, which saves as it starts.
  const canSave = hasPrompt && !state.saving && !sending;
  const key = state.selectedProjectId ?? NO_PROJECT_KEY;
  const running =
    hasOwn(state.sessions, key) && state.sessions[key].state === "running";
  const canSend = canSave && !running;
  const title = currentTitle(state);
  const canClear =
    title !== "" || Object.values(draft).some((value) => value !== "");
  // The rendered prompt goes in verbatim: the duplicate check compares it
  // with the one last saved as an exact string.
  const entry = {
    frameworkId: framework.id,
    sectionValues: draft,
    renderedPrompt: prompt,
    title: title.trim() === "" ? null : title,
    projectId: state.selectedProjectId,
  };

  return (
    <>
      <button
        type="button"
        className={primaryButton}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void copy(entry);
        }}
      >
        Copy
      </button>
      <button
        type="button"
        className={secondaryButton}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void save(entry);
        }}
      >
        Save
      </button>
      {state.claude.status === "found" && (
        <>
          <button
            type="button"
            className={secondaryButton}
            aria-disabled={!canSend}
            aria-describedby={running ? hintId : undefined}
            onClick={() => {
              if (!canSend) return;
              setSending(true);
              void send(entry).finally(() => setSending(false));
            }}
          >
            Send to Claude Code
          </button>
          {running && (
            <span id={hintId} className={fieldHelp}>
              Claude Code is already running. Paste into it with{" "}
              {pasteKeys(currentPlatform())}.
            </span>
          )}
        </>
      )}
      {!state.drawer.open && (
        <button
          type="button"
          id={SHOW_DRAWER_ID}
          className={secondaryButton}
          onClick={() => dispatch({ type: "drawerToggled", open: true })}
        >
          Show Claude Code
        </button>
      )}
      <button
        type="button"
        className={secondaryButton}
        aria-disabled={!canClear}
        onClick={() => {
          if (canClear) dispatch({ type: "clearDraft" });
        }}
      >
        Clear
      </button>
    </>
  );
}
