import { HistoryFilters } from "./HistoryFilters";
import { EntryDetail } from "./EntryDetail";
import { HistoryList } from "./HistoryList";

/**
 * The History tab's content: the list pane on the left, 300 px wide, then a
 * divider and the reading pane taking the rest. Each pane scrolls on its own.
 */
export function HistoryView() {
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Saved prompts"
        className="flex w-75 shrink-0 flex-col gap-4 overflow-y-auto p-4"
      >
        <HistoryFilters />
        <HistoryList />
      </section>
      <div className="w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
      <section
        aria-label="Selected prompt"
        // Focusable because it scrolls on its own: WebKitGTK does not make
        // scrollable containers keyboard-reachable the way WebView2 does.
        tabIndex={0}
        className="min-w-0 flex-1 overflow-y-auto p-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500"
      >
        <EntryDetail />
      </section>
    </div>
  );
}
