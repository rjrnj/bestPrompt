import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  deletePromptEntry,
  deleteProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  setEntryProject,
  setEntryTitle,
} from "../api";
import type { EntryQuery } from "../bindings/EntryQuery";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import {
  AppStateProvider,
  useAppActions,
  useAppDispatch,
  useAppState,
} from "./AppState";
import { PAGE_SIZE } from "./history";
import { HistoryProvider, useHistory } from "./HistoryState";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  deleteProject: vi.fn(),
  listPromptEntries: vi.fn(),
  setEntryTitle: vi.fn(),
  setEntryProject: vi.fn(),
  deletePromptEntry: vi.fn(),
}));

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

function entries(count: number, from = 0): PromptEntry[] {
  return Array.from({ length: count }, (_, i) => entry(`e${from + i}`));
}

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

/** A promise the test resolves by hand, to order overlapping loads. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const everything: EntryQuery = {
  project: { kind: "any" },
  frameworkId: null,
  search: null,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <HistoryProvider>{children}</HistoryProvider>
    </AppStateProvider>
  );
}

/** The history hook alongside the app's, inside both providers. */
function renderHistory() {
  return renderHook(
    () => ({
      history: useHistory(),
      app: useAppState(),
      dispatch: useAppDispatch(),
      actions: useAppActions(),
    }),
    { wrapper },
  );
}

type Rendered = ReturnType<typeof renderHistory>["result"];

/** Shows the History tab and waits for its first page. */
async function openHistory(result: Rendered) {
  act(() => result.current.dispatch({ type: "viewChanged", view: "history" }));
  await waitFor(() =>
    expect(result.current.history.state.status).toBe("ready"),
  );
}

function ids(result: Rendered): string[] {
  return result.current.history.state.entries.map((e) => e.id);
}

function toasts(result: Rendered): string[] {
  return result.current.app.toasts.map((t) => `${t.kind}: ${t.message}`);
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([]);
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(listPromptEntries).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("HistoryProvider", () => {
  it("refresh runs when the history tab opens", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue(entries(2));
    const { result } = renderHistory();
    await waitFor(() =>
      expect(result.current.app.projects.status).toBe("ready"),
    );
    expect(listPromptEntries).not.toHaveBeenCalled();

    await openHistory(result);

    expect(listPromptEntries).toHaveBeenCalledTimes(1);
    expect(listPromptEntries).toHaveBeenLastCalledWith(
      everything,
      PAGE_SIZE,
      0,
    );
    expect(ids(result)).toEqual(["e0", "e1"]);

    act(() =>
      result.current.dispatch({ type: "viewChanged", view: "builder" }),
    );
    await openHistory(result);

    expect(listPromptEntries).toHaveBeenCalledTimes(2);
  });

  it("refreshes on request with the current filters", async () => {
    const { result } = renderHistory();
    await openHistory(result);

    await act(() => result.current.history.refresh());

    expect(listPromptEntries).toHaveBeenCalledTimes(2);
    expect(listPromptEntries).toHaveBeenLastCalledWith(
      everything,
      PAGE_SIZE,
      0,
    );
  });

  it("show more asks for the page after the listed entries", async () => {
    vi.mocked(listPromptEntries)
      .mockResolvedValueOnce(entries(PAGE_SIZE))
      .mockResolvedValueOnce(entries(1, PAGE_SIZE));
    const { result } = renderHistory();
    await openHistory(result);

    await act(() => result.current.history.showMore());

    expect(listPromptEntries).toHaveBeenLastCalledWith(
      everything,
      PAGE_SIZE,
      PAGE_SIZE,
    );
    expect(ids(result)).toHaveLength(PAGE_SIZE + 1);
    expect(result.current.history.state.hasMore).toBe(false);
  });

  it("show more does nothing after a short page or while a page loads", async () => {
    const pending = deferred<PromptEntry[]>();
    vi.mocked(listPromptEntries)
      .mockResolvedValueOnce(entries(2))
      .mockResolvedValueOnce(entries(PAGE_SIZE))
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHistory();
    await openHistory(result);

    await act(() => result.current.history.showMore());
    expect(listPromptEntries).toHaveBeenCalledTimes(1);

    await act(() => result.current.history.refresh());
    act(() => result.current.history.setFilters({ frameworkId: "rtf" }));
    await waitFor(() => expect(listPromptEntries).toHaveBeenCalledTimes(3));
    await act(() => result.current.history.showMore());

    expect(listPromptEntries).toHaveBeenCalledTimes(3);
    await act(async () => pending.resolve([]));
  });

  it("filters change resets to the first page", async () => {
    vi.mocked(listPromptEntries)
      .mockResolvedValueOnce(entries(PAGE_SIZE))
      .mockResolvedValueOnce(entries(PAGE_SIZE, PAGE_SIZE))
      .mockResolvedValueOnce([entry("rtf-only")]);
    const { result } = renderHistory();
    await openHistory(result);
    await act(() => result.current.history.showMore());
    expect(ids(result)).toHaveLength(2 * PAGE_SIZE);

    act(() => result.current.history.setFilters({ frameworkId: "rtf" }));

    await waitFor(() => expect(ids(result)).toEqual(["rtf-only"]));
    expect(listPromptEntries).toHaveBeenLastCalledWith(
      { ...everything, frameworkId: "rtf" },
      PAGE_SIZE,
      0,
    );
    expect(result.current.history.state.filters.frameworkId).toBe("rtf");
  });

  it("applies only the latest of overlapping pages", async () => {
    const stale = deferred<PromptEntry[]>();
    const latest = deferred<PromptEntry[]>();
    vi.mocked(listPromptEntries)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);
    const { result } = renderHistory();
    act(() =>
      result.current.dispatch({ type: "viewChanged", view: "history" }),
    );
    act(() =>
      result.current.history.setFilters({ project: { kind: "unassigned" } }),
    );
    await waitFor(() => expect(listPromptEntries).toHaveBeenCalledTimes(2));

    await act(async () => latest.resolve([entry("latest")]));
    await act(async () => stale.resolve([entry("stale")]));

    expect(ids(result)).toEqual(["latest"]);
  });

  it("search is debounced", async () => {
    vi.useFakeTimers();
    const { result } = renderHistory();
    act(() =>
      result.current.dispatch({ type: "viewChanged", view: "history" }),
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(listPromptEntries).toHaveBeenCalledTimes(1);

    act(() => result.current.history.setFilters({ search: "he" }));
    await act(() => vi.advanceTimersByTimeAsync(100));
    act(() => result.current.history.setFilters({ search: "  hello " }));
    expect(result.current.history.state.filters.search).toBe("  hello ");
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(listPromptEntries).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(listPromptEntries).toHaveBeenCalledTimes(2);
    expect(listPromptEntries).toHaveBeenLastCalledWith(
      { ...everything, search: "hello" },
      PAGE_SIZE,
      0,
    );
  });

  it("a deleted project filter falls back to all", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project("p-api", "api"),
      project("p-web", "web"),
    ]);
    vi.mocked(deleteProject).mockResolvedValue();
    const { result } = renderHistory();
    await waitFor(() =>
      expect(result.current.app.projects.status).toBe("ready"),
    );
    await openHistory(result);
    act(() =>
      result.current.history.setFilters({
        project: { kind: "project", id: "p-api" },
      }),
    );
    await waitFor(() => expect(listPromptEntries).toHaveBeenCalledTimes(2));

    await act(() => result.current.actions.deleteProject("p-api"));

    expect(result.current.history.state.filters.project).toEqual({
      kind: "any",
    });
    await waitFor(() => expect(listPromptEntries).toHaveBeenCalledTimes(3));
    expect(listPromptEntries).toHaveBeenLastCalledWith(
      everything,
      PAGE_SIZE,
      0,
    );
  });

  it("keeps a filter whose project is still there", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project("p-api", "api"),
      project("p-web", "web"),
    ]);
    vi.mocked(deleteProject).mockResolvedValue();
    const { result } = renderHistory();
    await waitFor(() =>
      expect(result.current.app.projects.status).toBe("ready"),
    );
    act(() =>
      result.current.history.setFilters({
        project: { kind: "project", id: "p-web" },
      }),
    );

    await act(() => result.current.actions.deleteProject("p-api"));

    expect(result.current.history.state.filters.project).toEqual({
      kind: "project",
      id: "p-web",
    });
  });

  it("selects an entry", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue(entries(2));
    const { result } = renderHistory();
    await openHistory(result);

    act(() => result.current.history.select("e1"));

    expect(result.current.history.state.selectedId).toBe("e1");
  });

  it("sets a title and replaces the entry in place", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue(entries(3));
    vi.mocked(setEntryTitle).mockResolvedValue(entry("e1", { title: "New" }));
    const { result } = renderHistory();
    await openHistory(result);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.history.setTitle("e1", "New");
    });

    expect(ok).toBe(true);
    expect(setEntryTitle).toHaveBeenCalledWith("e1", "New");
    expect(ids(result)).toEqual(["e0", "e1", "e2"]);
    expect(result.current.history.state.entries[1].title).toBe("New");
    expect(listPromptEntries).toHaveBeenCalledTimes(1);
  });

  it("sets a project and replaces the entry in place", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue(entries(2));
    vi.mocked(setEntryProject).mockResolvedValue(
      entry("e0", { projectId: "p-web" }),
    );
    const { result } = renderHistory();
    await openHistory(result);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.history.setProject("e0", "p-web");
    });

    expect(ok).toBe(true);
    expect(setEntryProject).toHaveBeenCalledWith("e0", "p-web");
    expect(result.current.history.state.entries[0].projectId).toBe("p-web");
  });

  it("removes a deleted entry and clears its selection", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue(entries(2));
    vi.mocked(deletePromptEntry).mockResolvedValue();
    const { result } = renderHistory();
    await openHistory(result);
    act(() => result.current.history.select("e1"));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.history.remove("e1");
    });

    expect(ok).toBe(true);
    expect(deletePromptEntry).toHaveBeenCalledWith("e1");
    expect(ids(result)).toEqual(["e0"]);
    expect(result.current.history.state.selectedId).toBeNull();
  });

  it("toasts a failed edit and leaves the entries alone", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue(entries(2));
    vi.mocked(setEntryTitle).mockRejectedValue(
      new ApiError("notFound", "prompt entry not found"),
    );
    vi.mocked(setEntryProject).mockRejectedValue(
      new ApiError("notFound", "project not found"),
    );
    vi.mocked(deletePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    const { result } = renderHistory();
    await openHistory(result);
    const before = result.current.history.state.entries;

    const outcomes: boolean[] = [];
    await act(async () => {
      outcomes.push(await result.current.history.setTitle("e0", "x"));
      outcomes.push(await result.current.history.setProject("e0", "p-x"));
      outcomes.push(await result.current.history.remove("e1"));
    });

    expect(outcomes).toEqual([false, false, false]);
    expect(toasts(result)).toEqual([
      "error: Couldn't change the title: prompt entry not found",
      "error: Couldn't change the project: project not found",
      "error: Couldn't delete the prompt: disk full",
    ]);
    expect(result.current.history.state.entries).toBe(before);
  });

  it("reports a failed page in the state", async () => {
    vi.mocked(listPromptEntries).mockRejectedValue(
      new ApiError("database", "no db"),
    );
    const { result } = renderHistory();
    act(() =>
      result.current.dispatch({ type: "viewChanged", view: "history" }),
    );

    await waitFor(() =>
      expect(result.current.history.state.status).toBe("error"),
    );
    expect(result.current.history.state.error).toBe("no db");
  });

  it("refuses the hook outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useHistory())).toThrow(
      /useHistory.*HistoryProvider/,
    );
  });
});
