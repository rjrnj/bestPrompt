import { useAppActions, useAppDispatch, useAppState } from "../state/AppState";
import { currentTitle } from "../state/reducer";
import { useCurrentPrompt } from "../state/useCurrentPrompt";
import { primaryButton, secondaryButton } from "./styles";

/**
 * Copy, Save and Clear for the selected framework's draft. Copy and Save
 * are offered only when the preview shows a prompt, and not while a save is
 * running; Clear whenever the draft has any text, whitespace included.
 * Renders nothing until a framework is selected.
 */
export function PromptActions() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { copy, save } = useAppActions();
  const current = useCurrentPrompt();
  if (current === null) return null;
  const { framework, draft, prompt, hasPrompt } = current;

  const canSave = hasPrompt && !state.saving;
  const canClear = Object.values(draft).some((value) => value !== "");
  // The rendered prompt goes in verbatim: the duplicate check compares it
  // with the one last saved as an exact string.
  const title = currentTitle(state);
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
