import { describe, expect, it } from "vitest";
import type { PromptEntry } from "../bindings/PromptEntry";
import {
  historyReducer,
  initialHistoryState,
  PAGE_SIZE,
  type HistoryAction,
  type HistoryState,
} from "./history";

function entry(id: string, fields: Partial<PromptEntry> = {}): PromptEntry {
  return {
    id,
    frameworkId: "rtf",
    frameworkSnapshot: {
      name: "RTF",
      template: "{{role}}",
      summaryKey: null,
      sections: [{ key: "role", label: "Role", helpText: "" }],
    },
    sectionValues: { role: id },
    renderedPrompt: id,
    title: null,
    projectId: null,
    createdAt: 1,
    ...fields,
  };
}

/** `count` entries with ids starting at `from`. */
function entries(count: number, from = 0): PromptEntry[] {
  return Array.from({ length: count }, (_, i) => entry(`e${from + i}`));
}

function run(
  actions: HistoryAction[],
  from: HistoryState = initialHistoryState,
): HistoryState {
  return actions.reduce(historyReducer, from);
}

/** A first page of `items`, requested and loaded as request 1. */
function loaded(items: PromptEntry[]): HistoryState {
  return run([
    { type: "pageRequested", requestId: 1 },
    { type: "pageLoaded", requestId: 1, entries: items, append: false },
  ]);
}

describe("the history state", () => {
  it("starts idle with every filter open and nothing listed", () => {
    expect(initialHistoryState).toEqual({
      filters: { project: { kind: "any" }, frameworkId: null, search: "" },
      entries: [],
      status: "idle",
      error: null,
      hasMore: false,
      selectedId: null,
      requestId: 0,
    });
  });

  it("loads while a page is requested", () => {
    const state = run([{ type: "pageRequested", requestId: 1 }]);

    expect(state.status).toBe("loading");
    expect(state.requestId).toBe(1);
  });

  it("a stale page is ignored", () => {
    const state = run([
      { type: "pageRequested", requestId: 1 },
      { type: "pageRequested", requestId: 2 },
      {
        type: "pageLoaded",
        requestId: 2,
        entries: [entry("new")],
        append: false,
      },
      {
        type: "pageLoaded",
        requestId: 1,
        entries: [entry("old")],
        append: false,
      },
      { type: "pageFailed", requestId: 1, message: "late" },
    ]);

    expect(state.entries.map((e) => e.id)).toEqual(["new"]);
    expect(state.status).toBe("ready");
    expect(state.error).toBeNull();
  });

  it("show more appends and has more follows a full page", () => {
    const first = loaded(entries(PAGE_SIZE));
    expect(first.hasMore).toBe(true);

    const second = run(
      [
        { type: "pageRequested", requestId: 2 },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: entries(3, PAGE_SIZE),
          append: true,
        },
      ],
      first,
    );

    expect(second.entries).toHaveLength(PAGE_SIZE + 3);
    expect(second.entries[PAGE_SIZE].id).toBe(`e${PAGE_SIZE}`);
    expect(second.hasMore).toBe(false);
    expect(second.status).toBe("ready");
  });

  it("replaces the list with a first page", () => {
    const state = run(
      [
        { type: "pageRequested", requestId: 2 },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: [entry("b")],
          append: false,
        },
      ],
      loaded([entry("a")]),
    );

    expect(state.entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("filters change merges the change and keeps the other filters", () => {
    const state = run([
      { type: "filtersChanged", filters: { frameworkId: "rtf" } },
      { type: "filtersChanged", filters: { search: "hello" } },
    ]);

    expect(state.filters).toEqual({
      project: { kind: "any" },
      frameworkId: "rtf",
      search: "hello",
    });
  });

  it("selects an entry or none", () => {
    const selected = run(
      [{ type: "entrySelected", id: "e1" }],
      loaded(entries(2)),
    );
    expect(selected.selectedId).toBe("e1");

    expect(
      historyReducer(selected, { type: "entrySelected", id: null }).selectedId,
    ).toBeNull();
  });

  it("keeps the selection across a refresh that still lists it", () => {
    const state = run(
      [
        { type: "entrySelected", id: "e1" },
        { type: "pageRequested", requestId: 2 },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: entries(3),
          append: false,
        },
      ],
      loaded(entries(2)),
    );

    expect(state.selectedId).toBe("e1");
  });

  it("clears the selection when a refresh no longer lists it", () => {
    const state = run(
      [
        { type: "entrySelected", id: "e1" },
        { type: "pageRequested", requestId: 2 },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: [entry("x")],
          append: false,
        },
      ],
      loaded(entries(2)),
    );

    expect(state.selectedId).toBeNull();
  });

  it("keeps the selection when another page is appended", () => {
    const state = run(
      [
        { type: "entrySelected", id: "e1" },
        { type: "pageRequested", requestId: 2 },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: [entry("x")],
          append: true,
        },
      ],
      loaded(entries(2)),
    );

    expect(state.selectedId).toBe("e1");
  });

  it("a failed page reports the error and keeps the entries", () => {
    const state = run(
      [
        { type: "pageRequested", requestId: 2 },
        { type: "pageFailed", requestId: 2, message: "no db" },
      ],
      loaded(entries(PAGE_SIZE)),
    );

    expect(state.status).toBe("error");
    expect(state.error).toBe("no db");
    expect(state.entries).toHaveLength(PAGE_SIZE);
    expect(state.hasMore).toBe(true);
  });

  it("clears the error when the next page loads", () => {
    const state = run(
      [
        { type: "pageRequested", requestId: 2 },
        { type: "pageFailed", requestId: 2, message: "no db" },
        { type: "pageRequested", requestId: 3 },
        { type: "pageLoaded", requestId: 3, entries: [], append: false },
      ],
      loaded(entries(2)),
    );

    expect(state.status).toBe("ready");
    expect(state.error).toBeNull();
  });

  it("entry updated replaces in place", () => {
    const state = run(
      [{ type: "entryUpdated", entry: entry("e1", { title: "Renamed" }) }],
      loaded(entries(3)),
    );

    expect(state.entries.map((e) => e.id)).toEqual(["e0", "e1", "e2"]);
    expect(state.entries[1].title).toBe("Renamed");
  });

  it("entry removed clears the selection", () => {
    const state = run(
      [
        { type: "entrySelected", id: "e1" },
        { type: "entryRemoved", id: "e1" },
      ],
      loaded(entries(3)),
    );

    expect(state.entries.map((e) => e.id)).toEqual(["e0", "e2"]);
    expect(state.selectedId).toBeNull();
  });

  it("keeps the selection when another entry is removed", () => {
    const state = run(
      [
        { type: "entrySelected", id: "e1" },
        { type: "entryRemoved", id: "e2" },
      ],
      loaded(entries(3)),
    );

    expect(state.selectedId).toBe("e1");
  });

  it("a deleted project filter falls back to all", () => {
    const state = run([
      {
        type: "filtersChanged",
        filters: { project: { kind: "project", id: "p-api" }, search: "x" },
      },
      { type: "projectRemoved", id: "p-api" },
    ]);

    expect(state.filters).toEqual({
      project: { kind: "any" },
      frameworkId: null,
      search: "x",
    });
  });

  it("keeps a filter on another project when a project is removed", () => {
    const filtered = run([
      {
        type: "filtersChanged",
        filters: { project: { kind: "project", id: "p-web" } },
      },
    ]);

    expect(
      historyReducer(filtered, { type: "projectRemoved", id: "p-api" }),
    ).toBe(filtered);
  });
});
