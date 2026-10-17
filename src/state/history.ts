// The History tab's state: a pure reducer over the filters, the listed
// entries and the selection. No React here. The provider in HistoryState.tsx
// fetches the pages and applies the edits, dispatching these actions.

import type { EntryCursor } from "../bindings/EntryCursor";
import type { ProjectFilter } from "../bindings/ProjectFilter";
import type { PromptEntry } from "../bindings/PromptEntry";

/** How many entries one page asks for. */
export const PAGE_SIZE = 50;

export type HistoryFilters = {
  project: ProjectFilter;
  frameworkId: string | null;
  /** The search box's text as typed; the provider debounces and trims it. */
  search: string;
};

export type HistoryState = {
  filters: HistoryFilters;
  /** The pages loaded so far, newest first. */
  entries: PromptEntry[];
  status: "idle" | "loading" | "ready" | "error";
  /** Why the last page failed; the entries already listed stay. */
  error: string | null;
  /** Whether the last request came back full, so another page may follow. */
  hasMore: boolean;
  selectedId: string | null;
  /** The latest page request; a result for any other is ignored. */
  requestId: number;
  /** Whether the latest request is a Show more; after a failure, the one that failed. */
  appending: boolean;
  /**
   * Where the next page starts: after the last row the latest page returned,
   * or none before any rows. Edits and deletions leave it where it is.
   */
  cursor: EntryCursor | null;
  /**
   * Entries deleted while the latest page request was loading. That page may
   * have been read before the deletes, so they are dropped from it when it
   * arrives. Edits need no such record: of two copies of an entry, the one
   * with the higher version is kept.
   */
  deletedWhileLoading: string[];
};

export type HistoryAction =
  | { type: "filtersChanged"; filters: Partial<HistoryFilters> }
  | { type: "pageRequested"; requestId: number; append: boolean }
  | {
      type: "pageLoaded";
      requestId: number;
      entries: PromptEntry[];
      /** True for "Show more"; false replaces the list with a first page. */
      append: boolean;
      /** How many entries the request asked for. */
      limit: number;
    }
  | { type: "pageFailed"; requestId: number; message: string }
  | { type: "entrySelected"; id: string | null }
  | { type: "entryUpdated"; entry: PromptEntry }
  | { type: "entryRemoved"; id: string }
  | { type: "projectRemoved"; id: string };

export const initialHistoryState: HistoryState = {
  filters: { project: { kind: "any" }, frameworkId: null, search: "" },
  entries: [],
  status: "idle",
  error: null,
  hasMore: false,
  selectedId: null,
  requestId: 0,
  appending: false,
  cursor: null,
  deletedWhileLoading: [],
};

function sameProjectFilter(a: ProjectFilter, b: ProjectFilter): boolean {
  if (a.kind === "project" && b.kind === "project") return a.id === b.id;
  return a.kind === b.kind;
}

/** Of a listed copy of an entry and an incoming one, the higher version; incoming on a tie. */
function newer(
  listed: PromptEntry | undefined,
  incoming: PromptEntry,
): PromptEntry {
  return listed !== undefined && listed.version > incoming.version
    ? listed
    : incoming;
}

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "filtersChanged": {
      const filters = { ...state.filters, ...action.filters };
      // An equal filter keeps its object, so the query does not change and
      // nothing is fetched again.
      if (sameProjectFilter(filters.project, state.filters.project)) {
        filters.project = state.filters.project;
      }
      return { ...state, filters };
    }
    case "pageRequested":
      return {
        ...state,
        status: "loading",
        requestId: action.requestId,
        appending: action.append,
        deletedWhileLoading: [],
      };
    case "pageLoaded": {
      if (action.requestId !== state.requestId) return state;
      // The page may have been read before an edit or delete finished.
      const listed = new Map(state.entries.map((e) => [e.id, e]));
      const page = action.entries
        .filter((e) => !state.deletedWhileLoading.includes(e.id))
        .map((e) => newer(listed.get(e.id), e));
      const entries = action.append ? [...state.entries, ...page] : page;
      const last: PromptEntry | undefined =
        action.entries[action.entries.length - 1];
      const cursor =
        last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : action.append
            ? state.cursor
            : null;
      // A first page keeps the selection only while it still lists it.
      const selectedId =
        action.append || entries.some((e) => e.id === state.selectedId)
          ? state.selectedId
          : null;
      return {
        ...state,
        entries,
        status: "ready",
        error: null,
        hasMore: action.entries.length === action.limit,
        selectedId,
        cursor,
      };
    }
    case "pageFailed":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "error", error: action.message };
    case "entrySelected":
      return { ...state, selectedId: action.id };
    case "entryUpdated":
      // Results of two edits can arrive out of order; the newer one stays.
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.id === action.entry.id ? newer(e, action.entry) : e,
        ),
      };
    case "entryRemoved":
      return {
        ...state,
        entries: state.entries.filter((e) => e.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        deletedWhileLoading:
          state.status === "loading"
            ? [...state.deletedWhileLoading, action.id]
            : state.deletedWhileLoading,
      };
    case "projectRemoved": {
      const { project } = state.filters;
      if (project.kind !== "project" || project.id !== action.id) return state;
      return {
        ...state,
        filters: { ...state.filters, project: { kind: "any" } },
      };
    }
  }
}
