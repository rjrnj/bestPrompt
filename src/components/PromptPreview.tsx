import { useId, useMemo, type ReactNode } from "react";
import { useAppState } from "../state/AppState";
import {
  draftOf,
  isBlank,
  renderPrompt,
  selectedFramework,
} from "../state/reducer";

type Props = {
  /** Buttons for the header row, beside the title (Copy, Save, Clear). */
  actions?: ReactNode;
};

/**
 * The right pane: the prompt as it will be copied, re-rendered from the
 * draft on every keystroke. Renders nothing until a framework is selected.
 */
export function PromptPreview({ actions }: Props) {
  const state = useAppState();
  const titleId = useId();
  const framework = selectedFramework(state);
  const stored = framework === null ? undefined : state.drafts[framework.id];
  // Memoized on what the prompt depends on, not on the whole state, so a
  // toast or a save flag doesn't re-render the template.
  const prompt = useMemo(
    () =>
      framework === null
        ? ""
        : renderPrompt(framework, draftOf(framework, stored)),
    [framework, stored],
  );
  if (framework === null) return null;
  const blank = isBlank(state);

  return (
    <section
      aria-labelledby={titleId}
      className="flex h-full flex-col rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <h2
          id={titleId}
          className="text-sm font-semibold text-slate-700 dark:text-slate-300"
        >
          Preview
        </h2>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {blank || prompt === "" ? (
        <p className="px-4 pb-4 text-sm text-slate-500 dark:text-slate-400">
          Fill in a section to see the prompt.
        </p>
      ) : (
        <pre
          data-testid="rendered-prompt"
          className="min-h-0 flex-1 overflow-auto px-4 pb-4 font-mono text-sm wrap-break-word whitespace-pre-wrap text-slate-900 dark:text-slate-100"
        >
          {prompt}
        </pre>
      )}
    </section>
  );
}
