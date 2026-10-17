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
};

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "filtersChanged":
      return { ...state, filters: { ...state.filters, ...action.filters } };
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
      };
    }
    case "pageFailed":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "error", error: action.message };
    case "entrySelected":
      return { ...state, selectedId: action.id };
    case "entryUpdated":
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.id === action.entry.id ? action.entry : e,
        ),
      };
    case "entryRemoved":
      return {
        ...state,
        entries: state.entries.filter((e) => e.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
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
