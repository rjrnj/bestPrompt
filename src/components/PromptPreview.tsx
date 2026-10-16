import { useId, type ReactNode } from "react";
import { useCurrentPrompt } from "../state/useCurrentPrompt";

type Props = {
  /** Buttons for the header row, beside the title (Copy, Save, Clear). */
  actions?: ReactNode;
};

/**
 * The right pane: the prompt as it will be copied, re-rendered from the
 * draft on every keystroke. Renders nothing until a framework is selected.
 */
export function PromptPreview({ actions }: Props) {
  const titleId = useId();
  const current = useCurrentPrompt();
  if (current === null) return null;
  const { prompt, hasPrompt } = current;

  // The <pre> is focusable because it scrolls on its own: WebKitGTK does not
  // make scrollable containers keyboard-reachable the way WebView2 does.
  return (
    <section
      aria-labelledby={titleId}
      className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
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
      {!hasPrompt ? (
        <p className="px-4 pb-4 text-sm text-slate-500 dark:text-slate-400">
          Fill in a section to see the prompt.
        </p>
      ) : (
        <pre
          data-testid="rendered-prompt"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto px-4 pb-4 font-mono text-sm wrap-break-word whitespace-pre-wrap text-slate-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-100"
        >
          {prompt}
        </pre>
      )}
    </section>
  );
}
