import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { Project } from "../../bindings/Project";
import type { PromptEntry } from "../../bindings/PromptEntry";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../state/AppState";
import { PAGE_SIZE } from "../../state/history";
import { HistoryProvider } from "../../state/HistoryState";
import { HistoryView } from "./HistoryView";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
}));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{task}}",
  summaryKey: "task",
  isCustom: false,
  deletedAt: null,
  sections: [{ key: "task", label: "Task", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};
const risen: Framework = { ...rtf, id: "risen", name: "RISEN" };

const api: Project = {
  id: "0192f000-0000-7000-8000-000000000001",
  name: "api",
  createdAt: 1,
  updatedAt: 1,
};

function entry(id: string, fields: Partial<PromptEntry> = {}): PromptEntry {
  return {
    id,
    frameworkId: "rtf",
    frameworkSnapshot: {
      name: "RTF",
      template: "{{task}}",
      summaryKey: "task",
      sections: [{ key: "task", label: "Task", helpText: "" }],
    },
    sectionValues: { task: `task ${id}` },
    renderedPrompt: id,
    title: null,
    projectId: null,
    createdAt: Date.now(),
    version: 0,
    ...fields,
  };
}

function page(count: number, from = 0): PromptEntry[] {
  return Array.from({ length: count }, (_, i) => entry(`e${from + i}`));
}

/** Shows the History tab, the way the header's tab does. */
function ShowHistory() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: "viewChanged", view: "history" });
  }, [dispatch]);
  return null;
}

function CurrentView() {
  return <p>view: {useAppState().view}</p>;
}

function renderView(extra?: ReactNode) {
  render(
    <AppStateProvider>
      <HistoryProvider>
        <ShowHistory />
        <HistoryView />
        {extra}
      </HistoryProvider>
    </AppStateProvider>,
  );
}

function lastQuery() {
  return vi.mocked(listPromptEntries).mock.lastCall?.[0];
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([rtf, risen]);
  vi.mocked(listProjects).mockResolvedValue([api]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(listPromptEntries).mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("HistoryView list pane", () => {
  it("lists_entries_grouped_by_day_with_labels_and_meta", async () => {
    const old = new Date(2020, 0, 5, 9, 30).getTime();
    vi.mocked(listPromptEntries).mockResolvedValue([
      entry("a", { title: "Fix the login bug", projectId: api.id }),
      entry("b", { projectId: "gone" }),
      entry("c", { createdAt: old }),
    ]);
    renderView();

    expect(
      await screen.findByRole("heading", { name: "Today" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /2020/ })).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /Fix the login bug/ }),
    ).toHaveTextContent(/RTF · api · /);
    expect(screen.getByRole("button", { name: /task b/ })).toHaveTextContent(
      /RTF · no project · /,
    );
    expect(screen.getByRole("button", { name: /task c/ })).toHaveTextContent(
      /RTF · no project · /,
    );
  });

  it("typing_in_search_filters_after_the_debounce", async () => {
    renderView();
    const user = userEvent.setup();
    const box = await screen.findByRole("searchbox", {
      name: "Search prompts",
    });
    await waitFor(() => expect(listPromptEntries).toHaveBeenCalled());
    vi.mocked(listPromptEntries).mockClear();

    await user.type(box, "login");

    expect(listPromptEntries).not.toHaveBeenCalled();
    await waitFor(() => expect(lastQuery()?.search).toBe("login"));
    expect(listPromptEntries).toHaveBeenCalledTimes(1);
  });

  it("project_and_framework_filters_query_the_backend", async () => {
    renderView();
    const user = userEvent.setup();

    const project = await screen.findByRole("combobox", { name: "Project" });
    expect(project).toHaveTextContent("All projects");
    await user.click(project);
    await user.click(await screen.findByRole("option", { name: "api" }));
    await waitFor(() =>
      expect(lastQuery()?.project).toEqual({ kind: "project", id: api.id }),
    );

    await user.click(project);
    await user.click(await screen.findByRole("option", { name: "No project" }));
    await waitFor(() =>
      expect(lastQuery()?.project).toEqual({ kind: "unassigned" }),
    );

    const framework = screen.getByRole("combobox", { name: "Framework" });
    expect(framework).toHaveTextContent("All frameworks");
    await user.click(framework);
    await user.click(await screen.findByRole("option", { name: "RISEN" }));
    await waitFor(() => expect(lastQuery()?.frameworkId).toBe("risen"));
  });

  it("show_more_loads_the_next_page", async () => {
    vi.mocked(listPromptEntries)
      .mockResolvedValueOnce(page(PAGE_SIZE))
      .mockResolvedValueOnce(page(2, PAGE_SIZE));
    renderView();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show more" }));

    expect(await screen.findByText("task e51")).toBeInTheDocument();
    expect(screen.getByText("task e0")).toBeInTheDocument();
    expect(vi.mocked(listPromptEntries).mock.lastCall?.[2]?.id).toBe(
      `e${PAGE_SIZE - 1}`,
    );
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });

  it("a_failed_show_more_offers_to_retry_it", async () => {
    vi.mocked(listPromptEntries)
      .mockResolvedValueOnce(page(PAGE_SIZE))
      .mockRejectedValueOnce(new ApiError("database", "disk busy"))
      .mockResolvedValueOnce(page(2, PAGE_SIZE));
    renderView();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load more: disk busy",
    );
    expect(screen.getByText("task e0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("task e51")).toBeInTheDocument();
    expect(screen.getByText("task e0")).toBeInTheDocument();
    const [, limit, after] = vi.mocked(listPromptEntries).mock.lastCall ?? [];
    expect(limit).toBe(PAGE_SIZE);
    expect(after?.id).toBe(`e${PAGE_SIZE - 1}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a_failed_reload_hides_the_old_rows_and_retries_the_first_page", async () => {
    vi.mocked(listPromptEntries)
      .mockResolvedValueOnce([entry("a")])
      .mockRejectedValueOnce(new ApiError("database", "disk busy"))
      .mockResolvedValueOnce([entry("b")]);
    renderView();
    const user = userEvent.setup();
    const box = await screen.findByRole("searchbox", {
      name: "Search prompts",
    });
    expect(
      await screen.findByRole("button", { name: /task a/ }),
    ).toBeInTheDocument();

    await user.type(box, "zzz");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the saved prompts.",
    );
    expect(screen.queryByText("task a")).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load more/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("task b")).toBeInTheDocument();
    expect(vi.mocked(listPromptEntries).mock.lastCall).toEqual([
      { project: { kind: "any" }, frameworkId: null, search: "zzz" },
      PAGE_SIZE,
      null,
    ]);
  });

  it("empty_history_points_to_the_builder", async () => {
    renderView(<CurrentView />);
    const user = userEvent.setup();

    expect(
      await screen.findByText(
        "No saved prompts yet. Prompts you copy or save in the Builder appear here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear search and filters" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("view: history")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to the Builder" }));

    expect(screen.getByText("view: builder")).toBeInTheDocument();
  });

  it("no_results_offers_to_clear_filters", async () => {
    vi.mocked(listPromptEntries).mockImplementation((query) =>
      Promise.resolve(query.search === null ? [entry("a")] : []),
    );
    renderView();
    const user = userEvent.setup();
    const box = await screen.findByRole("searchbox", {
      name: "Search prompts",
    });
    expect(
      await screen.findByRole("button", { name: /task a/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No prompts match.")).not.toBeInTheDocument();
    await user.type(box, "zzz");

    expect(await screen.findByText("No prompts match.")).toBeInTheDocument();
    await waitFor(() => expect(lastQuery()?.search).toBe("zzz"));
    await user.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );

    expect(box).toHaveValue("");
    await waitFor(() => expect(lastQuery()?.search).toBeNull());
  });

  it("rows_are_reachable_and_selectable_by_keyboard", async () => {
    vi.mocked(listPromptEntries).mockResolvedValue([entry("a"), entry("b")]);
    renderView();
    const user = userEvent.setup();
    const first = await screen.findByRole("button", { name: /task a/ });
    const second = screen.getByRole("button", { name: /task b/ });

    // Search box, project filter, framework filter, then the rows.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    await user.tab();
    await user.keyboard(" ");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
  });
});
