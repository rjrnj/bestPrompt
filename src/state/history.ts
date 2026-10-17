// The History tab's state: a pure reducer over the filters, the listed
// entries and the selection. No React here. The provider in HistoryState.tsx
// fetches the pages and applies the edits, dispatching these actions.

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
  /** Whether the last page came back full, so another may follow. */
  hasMore: boolean;
  selectedId: string | null;
  /** The latest page request; a result for any other is ignored. */
  requestId: number;
  /**
   * How many of the backend's matching entries the loaded pages cover, where
   * the next page starts. It moves back when a listed entry is deleted or
   * moved out of the project filter, since the backend no longer counts it;
   * a moved entry stays listed until the next refresh, so this can be less
   * than `entries.length`.
   */
  offset: number;
};

export type HistoryAction =
  | { type: "filtersChanged"; filters: Partial<HistoryFilters> }
  | { type: "pageRequested"; requestId: number }
  | {
      type: "pageLoaded";
      requestId: number;
      entries: PromptEntry[];
      /** True for "Show more"; false replaces the list with a first page. */
      append: boolean;
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
  offset: 0,
};

/** Whether an entry filed under `projectId` is one `filter` lists. */
function matchesProject(filter: ProjectFilter, projectId: string | null) {
  switch (filter.kind) {
    case "any":
      return true;
    case "unassigned":
      return projectId === null;
    case "project":
      return projectId === filter.id;
  }
}

function sameProjectFilter(a: ProjectFilter, b: ProjectFilter): boolean {
  if (a.kind === "project" && b.kind === "project") return a.id === b.id;
  return a.kind === b.kind;
}

/**
 * How far the offset moves when a listed entry's project changes: back one
 * when it leaves the project filter, forward one when it comes back. A new
 * title that stops matching the search can't be seen here, so the backend's
 * set may still have shrunk by that entry.
 */
function offsetShift(
  filter: ProjectFilter,
  before: PromptEntry | undefined,
  after: PromptEntry,
): number {
  if (before === undefined) return 0;
  return (
    Number(matchesProject(filter, after.projectId)) -
    Number(matchesProject(filter, before.projectId))
  );
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
      return { ...state, status: "loading", requestId: action.requestId };
    case "pageLoaded": {
      if (action.requestId !== state.requestId) return state;
      const entries = action.append
        ? [...state.entries, ...action.entries]
        : action.entries;
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
        hasMore: action.entries.length === PAGE_SIZE,
        selectedId,
        offset: (action.append ? state.offset : 0) + action.entries.length,
      };
    }
    case "pageFailed":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "error", error: action.message };
    case "entrySelected":
      return { ...state, selectedId: action.id };
    case "entryUpdated": {
      const before = state.entries.find((e) => e.id === action.entry.id);
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.id === action.entry.id ? action.entry : e,
        ),
        offset:
          state.offset +
          offsetShift(state.filters.project, before, action.entry),
      };
    }
    case "entryRemoved": {
      const removed = state.entries.find((e) => e.id === action.id);
      // An entry that already left the project filter was counted out then.
      const counted =
        removed !== undefined &&
        matchesProject(state.filters.project, removed.projectId);
      return {
        ...state,
        entries: state.entries.filter((e) => e.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        offset: counted ? state.offset - 1 : state.offset,
      };
    }
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
