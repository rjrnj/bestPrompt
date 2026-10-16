import { useAppActions, useAppDispatch, useAppState } from "../state/AppState";
import { useCurrentPrompt } from "../state/useCurrentPrompt";

// Unavailable buttons are marked with aria-disabled, not disabled, and
// ignore clicks: a disabled button drops keyboard focus to the page, and
// Clear disables itself on every use, as Copy and Save do while saving.
const base =
  "rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
// sky-700 and darker keep white text above 4.5:1 at rest and on hover.
const primary = `${base} bg-sky-700 text-white not-aria-disabled:hover:bg-sky-800`;
const secondary = `${base} border border-slate-400 bg-white text-slate-900 not-aria-disabled:hover:bg-slate-100 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:not-aria-disabled:hover:bg-slate-700`;

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
  const entry = {
    frameworkId: framework.id,
    sectionValues: draft,
    renderedPrompt: prompt,
  };

  return (
    <>
      <button
        type="button"
        className={primary}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void copy(entry);
        }}
      >
        Copy
      </button>
      <button
        type="button"
        className={secondary}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void save(entry);
        }}
      >
        Save
      </button>
      <button
        type="button"
        className={secondary}
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
