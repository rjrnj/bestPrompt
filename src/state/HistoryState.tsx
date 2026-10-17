// The History tab's provider. The reducer in history.ts is synchronous; this
// is where the async work lives: fetching pages when the tab opens or the
// filters change, and applying edits to single entries.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deletePromptEntry,
  listPromptEntries,
  setEntryProject,
  setEntryTitle,
} from "../api";
import type { EntryCursor } from "../bindings/EntryCursor";
import type { EntryQuery } from "../bindings/EntryQuery";
import type { PromptEntry } from "../bindings/PromptEntry";
import { useAppDispatch, useAppState } from "./AppState";
import {
  historyReducer,
  initialHistoryState,
  PAGE_SIZE,
  type HistoryAction,
  type HistoryFilters,
  type HistoryState,
} from "./history";

/** How long the search waits after the last keystroke before it runs. */
export const SEARCH_DELAY_MS = 250;

/** The history state and the operations components can start. */
export type History = {
  state: HistoryState;
  /** Changes some filters; the list then reloads from the first page. */
  setFilters: (changes: Partial<HistoryFilters>) => void;
  /** Whether Show more can load anything: the list is ready and has more. */
  canShowMore: boolean;
  /** Loads the next page, when `canShowMore` or to retry a failed Show more. */
  showMore: () => Promise<void>;
  select: (id: string | null) => void;
  /** Reloads the first page with the current filters. */
  refresh: () => Promise<void>;
  /** Sets an entry's title; blank clears it. False, after a toast, when it fails. */
  setTitle: (id: string, title: string | null) => Promise<boolean>;
  /** Files an entry under a project, or none. False, after a toast, when it fails. */
  setProject: (id: string, projectId: string | null) => Promise<boolean>;
  /** Deletes an entry. False, after a toast, when it fails. */
  remove: (id: string) => Promise<boolean>;
};

const HistoryContext = createContext<History | null>(null);

// api.ts rejects with an ApiError, so the fallback only matters if that
// contract breaks; it keeps the failure path from ever throwing itself.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The search as the backend takes it: trimmed, and none when blank. */
function searchQuery(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, initialHistoryState);
  const { view, projects } = useAppState();
  const appDispatch = useAppDispatch();
  const { project, frameworkId, search } = state.filters;

  // The search the list uses catches up with the typed text once typing
  // pauses, so a burst of keystrokes costs one fetch.
  const [settledSearch, setSettledSearch] = useState(() => searchQuery(search));
  useEffect(() => {
    const timer = setTimeout(
      () => setSettledSearch(searchQuery(search)),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo<EntryQuery>(
    () => ({ project, frameworkId, search: settledSearch }),
    [project, frameworkId, settledSearch],
  );

  // Each page request takes a number, and the reducer applies a result only
  // for the latest one, so a slow page can't overwrite a newer list.
  const requestCount = useRef(0);

  const load = useCallback(
    async (after: EntryCursor | null, append: boolean, limit = PAGE_SIZE) => {
      const requestId = ++requestCount.current;
      dispatch({ type: "pageRequested", requestId, append });
      let entries: PromptEntry[];
      try {
        entries = await listPromptEntries(query, limit, after);
      } catch (error) {
        dispatch({ type: "pageFailed", requestId, message: messageOf(error) });
        return;
      }
      dispatch({ type: "pageLoaded", requestId, entries, append, limit });
    },
    [query],
  );

  const refresh = useCallback(() => load(null, false), [load]);

  // Only from a settled, full list: while a first page loads, the listed
  // entries may belong to the previous filters, and appending to them would
  // mix two queries.
  const { cursor } = state;
  const canShowMore = state.status === "ready" && state.hasMore;
  // A failed Show more left the list as it was, so it can be run again.
  const canRetryMore =
    state.status === "error" && state.appending && state.hasMore;
  const showMore = useCallback(async () => {
    if (canShowMore || canRetryMore) await load(cursor, true);
  }, [load, cursor, canShowMore, canRetryMore]);

  // How many rows are listed, read when the tab is shown again.
  const listed = useRef(0);
  useEffect(() => {
    listed.current = state.entries.length;
  });

  // The query the shown tab last loaded; null while the tab is hidden.
  const shownQuery = useRef<EntryQuery | null>(null);

  // The list reloads whenever the tab is shown and, while it shows, whenever
  // the query changes. Showing the tab again reloads as many whole pages as
  // were listed, so the rows read before and a selection among them
  // survive; a query change starts over at one page.
  useEffect(() => {
    if (view !== "history") {
      shownQuery.current = null;
      return;
    }
    // Strict Mode runs the effect twice for one change.
    if (shownQuery.current === query) return;
    const shown = shownQuery.current === null;
    shownQuery.current = query;
    const pages = Math.max(1, Math.ceil(listed.current / PAGE_SIZE));
    void load(null, false, shown ? pages * PAGE_SIZE : PAGE_SIZE);
  }, [view, query, load]);

  // A project deleted elsewhere (the Builder's Manage dialog) can't stay the
  // filter; the reducer falls back to all projects, which reloads the list.
  useEffect(() => {
    if (projects.status !== "ready" || project.kind !== "project") return;
    if (!projects.items.some((p) => p.id === project.id)) {
      dispatch({ type: "projectRemoved", id: project.id });
    }
  }, [projects, project]);

  /** Runs an entry command; on failure toasts its message and returns false. */
  const edit = useCallback(
    async (
      failure: string,
      run: () => Promise<HistoryAction>,
    ): Promise<boolean> => {
      let action: HistoryAction;
      try {
        action = await run();
      } catch (error) {
        appDispatch({
          type: "toastAdded",
          kind: "error",
          message: `${failure}: ${messageOf(error)}`,
        });
        return false;
      }
      dispatch(action);
      return true;
    },
    [appDispatch],
  );

  const setTitle = useCallback(
    (id: string, title: string | null) =>
      edit("Couldn't change the title", async () => ({
        type: "entryUpdated",
        entry: await setEntryTitle(id, title),
      })),
    [edit],
  );

  const setProject = useCallback(
    (id: string, projectId: string | null) =>
      edit("Couldn't change the project", async () => ({
        type: "entryUpdated",
        entry: await setEntryProject(id, projectId),
      })),
    [edit],
  );

  const { entries } = state;
  const remove = useCallback(
    async (id: string) => {
      const removed = entries.find((e) => e.id === id);
      const ok = await edit("Couldn't delete the prompt", async () => {
        await deletePromptEntry(id);
        return { type: "entryRemoved", id };
      });
      if (ok && removed !== undefined) {
        appDispatch({
          type: "entryDeleted",
          frameworkId: removed.frameworkId,
          renderedPrompt: removed.renderedPrompt,
        });
      }
      return ok;
    },
    [edit, entries, appDispatch],
  );

  const setFilters = useCallback(
    (changes: Partial<HistoryFilters>) =>
      dispatch({ type: "filtersChanged", filters: changes }),
    [],
  );

  const select = useCallback(
    (id: string | null) => dispatch({ type: "entrySelected", id }),
    [],
  );

  const history = useMemo<History>(
    () => ({
      state,
      setFilters,
      canShowMore,
      showMore,
      select,
      refresh,
      setTitle,
      setProject,
      remove,
    }),
    [
      state,
      setFilters,
      canShowMore,
      showMore,
      select,
      refresh,
      setTitle,
      setProject,
      remove,
    ],
  );

  return <HistoryContext value={history}>{children}</HistoryContext>;
}

export function useHistory(): History {
  const history = useContext(HistoryContext);
  if (history === null) {
    throw new Error("useHistory must be used inside a HistoryProvider");
  }
  return history;
}
