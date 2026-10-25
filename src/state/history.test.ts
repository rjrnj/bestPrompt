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
    version: 0,
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
    { type: "pageRequested", requestId: 1, append: false },
    {
      type: "pageLoaded",
      requestId: 1,
      entries: items,
      append: false,
      limit: PAGE_SIZE,
    },
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
      appending: false,
      cursor: null,
      deletedWhileLoading: [],
    });
  });

  it("loads while a page is requested", () => {
    const state = run([{ type: "pageRequested", requestId: 1, append: false }]);

    expect(state.status).toBe("loading");
    expect(state.requestId).toBe(1);
  });

  it("a stale page is ignored", () => {
    const state = run([
      { type: "pageRequested", requestId: 1, append: false },
      { type: "pageRequested", requestId: 2, append: false },
      {
        type: "pageLoaded",
        requestId: 2,
        entries: [entry("new")],
        append: false,
        limit: PAGE_SIZE,
      },
      {
        type: "pageLoaded",
        requestId: 1,
        entries: [entry("old")],
        append: false,
        limit: PAGE_SIZE,
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
        { type: "pageRequested", requestId: 2, append: true },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: entries(3, PAGE_SIZE),
          append: true,
          limit: PAGE_SIZE,
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
        { type: "pageRequested", requestId: 2, append: false },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: [entry("b")],
          append: false,
          limit: PAGE_SIZE,
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
        { type: "pageRequested", requestId: 2, append: false },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: entries(3),
          append: false,
          limit: PAGE_SIZE,
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
        { type: "pageRequested", requestId: 2, append: false },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: [entry("x")],
          append: false,
          limit: PAGE_SIZE,
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
        { type: "pageRequested", requestId: 2, append: true },
        {
          type: "pageLoaded",
          requestId: 2,
          entries: [entry("x")],
          append: true,
          limit: PAGE_SIZE,
        },
      ],
      loaded(entries(2)),
    );

    expect(state.selectedId).toBe("e1");
  });

  it("a first page larger than one page has more only when it came back full", () => {
    const limit = 2 * PAGE_SIZE;
    const reload = (items: PromptEntry[]) =>
      run(
        [
          { type: "entrySelected", id: `e${PAGE_SIZE + 5}` },
          { type: "pageRequested", requestId: 3, append: false },
          {
            type: "pageLoaded",
            requestId: 3,
            entries: items,
            append: false,
            limit,
          },
        ],
        loaded(entries(PAGE_SIZE)),
      );

    const full = reload(entries(limit));
    expect(full.hasMore).toBe(true);
    expect(full.cursor?.id).toBe(`e${limit - 1}`);
    expect(full.selectedId).toBe(`e${PAGE_SIZE + 5}`);

    const short = reload(entries(limit - 1));
    expect(short.hasMore).toBe(false);
    expect(short.cursor?.id).toBe(`e${limit - 2}`);
  });

  it("records whether the failed request was a show more", () => {
    const failed = (append: boolean) =>
      run(
        [
          { type: "pageRequested", requestId: 2, append },
          { type: "pageFailed", requestId: 2, message: "no db" },
        ],
        loaded(entries(PAGE_SIZE)),
      );

    expect(failed(true).appending).toBe(true);
    expect(failed(false).appending).toBe(false);
  });

  it("a failed page reports the error and keeps the entries", () => {
    const state = run(
      [
        { type: "pageRequested", requestId: 2, append: false },
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
        { type: "pageRequested", requestId: 2, append: false },
        { type: "pageFailed", requestId: 2, message: "no db" },
        { type: "pageRequested", requestId: 3, append: false },
        {
          type: "pageLoaded",
          requestId: 3,
          entries: [],
          append: false,
          limit: PAGE_SIZE,
        },
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

  it("a removed framework filter falls back to all frameworks", () => {
    const state = run([
      {
        type: "filtersChanged",
        filters: { frameworkId: "rtf", search: "x" },
      },
      { type: "frameworkRemoved", id: "rtf" },
    ]);

    expect(state.filters).toEqual({
      project: { kind: "any" },
      frameworkId: null,
      search: "x",
    });
  });

  it("keeps a filter on another framework when a framework is removed", () => {
    const filtered = run([
      { type: "filtersChanged", filters: { frameworkId: "costar" } },
    ]);

    expect(
      historyReducer(filtered, { type: "frameworkRemoved", id: "rtf" }),
    ).toBe(filtered);
  });

  it("keeps the project filter's object when the new one is equal", () => {
    const filtered = run([
      {
        type: "filtersChanged",
        filters: { project: { kind: "project", id: "p-web" } },
      },
    ]);
    const before = filtered.filters.project;

    const same = historyReducer(filtered, {
      type: "filtersChanged",
      filters: { project: { kind: "project", id: "p-web" }, search: "x" },
    });
    const other = historyReducer(filtered, {
      type: "filtersChanged",
      filters: { project: { kind: "project", id: "p-api" } },
    });

    expect(same.filters.project).toBe(before);
    expect(same.filters.search).toBe("x");
    expect(other.filters.project).toEqual({ kind: "project", id: "p-api" });
  });
});

describe("the paging cursor", () => {
  /** Request 2, a Show more that returns `items`. */
  function more(items: PromptEntry[]): HistoryAction[] {
    return [
      { type: "pageRequested", requestId: 2, append: true },
      {
        type: "pageLoaded",
        requestId: 2,
        entries: items,
        append: true,
        limit: PAGE_SIZE,
      },
    ];
  }

  it("sits after the last row of the latest page", () => {
    const first = loaded([
      entry("a", { createdAt: 3 }),
      entry("b", { createdAt: 2 }),
    ]);
    expect(first.cursor).toEqual({ createdAt: 2, id: "b" });

    const second = run(more([entry("c", { createdAt: 1 })]), first);
    expect(second.cursor).toEqual({ createdAt: 1, id: "c" });

    const reloaded = run(
      [
        { type: "pageRequested", requestId: 3, append: false },
        {
          type: "pageLoaded",
          requestId: 3,
          entries: [entry("a", { createdAt: 3 })],
          append: false,
          limit: PAGE_SIZE,
        },
      ],
      second,
    );
    expect(reloaded.cursor).toEqual({ createdAt: 3, id: "a" });
  });

  it("is none after an empty first page", () => {
    expect(loaded([]).cursor).toBeNull();
  });

  it("stays put after an empty Show more", () => {
    const state = run(more([]), loaded(entries(2)));

    expect(state.cursor?.id).toBe("e1");
  });

  it("stays on the last row when that row is removed", () => {
    const state = run([{ type: "entryRemoved", id: "e2" }], loaded(entries(3)));

    expect(state.entries.map((e) => e.id)).toEqual(["e0", "e1"]);
    expect(state.cursor?.id).toBe("e2");
  });

  it("stays put when a row is edited", () => {
    const state = run(
      [{ type: "entryUpdated", entry: entry("e2", { projectId: "p-web" }) }],
      loaded(entries(3)),
    );

    expect(state.cursor?.id).toBe("e2");
  });
});

describe("edits made while a page loads", () => {
  /** Request 2, a refresh that returns `items` as read before the edits. */
  function refresh(
    ...edits: HistoryAction[]
  ): (items: PromptEntry[]) => HistoryAction[] {
    return (items) => [
      { type: "pageRequested", requestId: 2, append: false },
      ...edits,
      {
        type: "pageLoaded",
        requestId: 2,
        entries: items,
        append: false,
        limit: PAGE_SIZE,
      },
    ];
  }

  it("keep a newer title when the page read before it arrives", () => {
    const state = run(
      refresh({
        type: "entryUpdated",
        entry: entry("e1", { title: "New", version: 1 }),
      })(entries(3)),
      loaded(entries(3)),
    );

    expect(state.entries.map((e) => e.title)).toEqual([null, "New", null]);
  });

  it("keep a deleted entry out of the page read before it", () => {
    const state = run(
      refresh({ type: "entryRemoved", id: "e1" })(entries(3)),
      loaded(entries(3)),
    );

    expect(state.entries.map((e) => e.id)).toEqual(["e0", "e2"]);
  });

  it("give way to a page with a newer copy of the entry", () => {
    const state = run(
      refresh({
        type: "entryUpdated",
        entry: entry("e1", { title: "Mine", version: 1 }),
      })([entry("e0"), entry("e1", { title: "Newer", version: 2 })]),
      loaded(entries(3)),
    );

    expect(state.entries[1].title).toBe("Newer");
  });

  it("keep the newest of edits whose results arrive out of order", () => {
    const state = run(
      [
        {
          type: "entryUpdated",
          entry: entry("e1", { title: "Second", version: 2 }),
        },
        {
          type: "entryUpdated",
          entry: entry("e1", { title: "First", version: 1 }),
        },
      ],
      loaded(entries(3)),
    );

    expect(state.entries[1].title).toBe("Second");
  });

  it("forget deletions once no page is loading", () => {
    const state = run([{ type: "entryRemoved", id: "e1" }], loaded(entries(3)));

    expect(state.entries.map((e) => e.id)).toEqual(["e0", "e2"]);
    expect(state.deletedWhileLoading).toEqual([]);
  });

  it("forget deletions from before the latest request", () => {
    const state = run(
      [
        { type: "pageRequested", requestId: 2, append: false },
        { type: "entryRemoved", id: "e1" },
        { type: "pageRequested", requestId: 3, append: false },
      ],
      loaded(entries(3)),
    );

    expect(state.deletedWhileLoading).toEqual([]);
  });
});
