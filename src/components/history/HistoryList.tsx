import { useMemo } from "react";
import type { PromptEntry } from "../../bindings/PromptEntry";
import { groupByDay } from "../../history/groupByDay";
import { entryLabel } from "../../history/label";
import type { HistoryFilters } from "../../state/history";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { useHistory } from "../../state/HistoryState";
import { primaryButton, secondaryButton } from "../styles";

const message = "text-sm text-slate-600 dark:text-slate-400";
const NO_MATCH = "No prompts match.";

const row =
  "group flex w-full min-w-0 flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-500 aria-pressed:bg-sky-100 dark:hover:bg-slate-800 dark:aria-pressed:bg-sky-900";

function timeOf(entry: PromptEntry): string {
  return new Date(entry.createdAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isFiltered(filters: HistoryFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.project.kind !== "any" ||
    filters.frameworkId !== null
  );
}

/**
 * Tells a screen reader when a search or filter finds nothing. Mounted with
 * the pane and empty until then: a screen reader reliably reads text put
 * into a region it already knows. It is also the line the list shows, so
 * it is said once. Empty, it takes no room of its own.
 */
export function NoMatchStatus() {
  const { state } = useHistory();
  const noMatch =
    state.status === "ready" &&
    state.entries.length === 0 &&
    isFiltered(state.filters);
  return (
    <p role="status" className={`${message} empty:-mb-4`}>
      {noMatch ? NO_MATCH : ""}
    </p>
  );
}

function LoadError({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sm text-red-700 dark:text-red-400">{text}</p>
      <button type="button" className={secondaryButton} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/** The saved prompts, by day, with Show more and the empty states. */
export function HistoryList() {
  const { frameworks, projects } = useAppState();
  const dispatch = useAppDispatch();
  const { state, setFilters, select, refresh, showMore, canShowMore } =
    useHistory();
  const { entries, status, error, appending, filters, selectedId } = state;

  const frameworkItems = frameworks.status === "ready" ? frameworks.items : [];
  const projectItems = projects.status === "ready" ? projects.items : [];
  const groups = useMemo(() => groupByDay(entries, new Date()), [entries]);

  const filtered = isFiltered(filters);

  // A failed first page leaves the rows of the previous query or visit,
  // which may not match the filters now shown, so they are not listed.
  if (status === "error" && !appending) {
    return (
      <LoadError
        text="Couldn't load the saved prompts."
        onRetry={() => void refresh()}
      />
    );
  }

  if (entries.length === 0) {
    if (status !== "ready") return <p className={message}>Loading…</p>;
    if (!filtered) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className={message}>
            No saved prompts yet. Prompts you copy or save in the Builder appear
            here.
          </p>
          <button
            type="button"
            className={primaryButton}
            onClick={() => dispatch({ type: "viewChanged", view: "builder" })}
          >
            Go to the Builder
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          className={secondaryButton}
          onClick={() =>
            setFilters({
              search: "",
              project: { kind: "any" },
              frameworkId: null,
            })
          }
        >
          Clear search and filters
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.heading}>
          <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
            {group.heading}
          </h2>
          <ul className="flex flex-col">
            {group.entries.map((entry) => {
              const project = projectItems.find(
                (p) => p.id === entry.projectId,
              );
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-pressed={entry.id === selectedId}
                    onClick={() => select(entry.id)}
                    className={row}
                  >
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {entryLabel(entry, frameworkItems)}
                    </span>
                    <span className="truncate text-xs text-slate-600 dark:text-slate-400 dark:group-aria-pressed:text-slate-300">
                      {entry.frameworkSnapshot.name} ·{" "}
                      {project?.name ?? "no project"} · {timeOf(entry)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {status === "error" && (
        <LoadError
          text={`Couldn't load more: ${error}`}
          onRetry={() => void showMore()}
        />
      )}
      {canShowMore && (
        <button
          type="button"
          className={secondaryButton}
          onClick={() => void showMore()}
        >
          Show more
        </button>
      )}
    </div>
  );
}
