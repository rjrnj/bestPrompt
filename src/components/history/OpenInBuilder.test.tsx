import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  restoreFramework,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { Project } from "../../bindings/Project";
import type { PromptEntry } from "../../bindings/PromptEntry";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../state/AppState";
import { HistoryProvider } from "../../state/HistoryState";
import type { Action } from "../../state/reducer";
import { Toaster } from "../Toaster";
import { TitleField } from "../TitleField";
import { HistoryView } from "./HistoryView";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
  restoreFramework: vi.fn(),
}));
vi.mock("../../clipboard", () => ({ writeText: vi.fn() }));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}} {{task}}",
  summaryKey: "task",
  isCustom: false,
  deletedAt: null,
  sections: [
    { key: "role", label: "Role", helpText: "" },
    { key: "task", label: "Task", helpText: "" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const api: Project = { id: "p-api", name: "api", createdAt: 1, updatedAt: 1 };

const saved: PromptEntry = {
  id: "e1",
  frameworkId: "rtf",
  frameworkSnapshot: {
    name: "RTF",
    template: rtf.template,
    summaryKey: "task",
    sections: [
      ...rtf.sections,
      { key: "format", label: "Format", helpText: "" },
    ],
  },
  sectionValues: { role: "Reviewer", task: "Fix the login bug", format: "" },
  renderedPrompt: "Reviewer Fix the login bug",
  title: "Login fix",
  projectId: null,
  createdAt: new Date(2020, 0, 5).getTime(),
  version: 0,
};

/**
 * Dispatches `actions` once the frameworks are loaded, and the projects too
 * unless `projectsLoading`.
 */
function Seed({
  actions,
  projectsLoading = false,
}: {
  actions: Action[];
  projectsLoading?: boolean;
}) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const ready =
    state.frameworks.status === "ready" &&
    (projectsLoading || state.projects.status === "ready");
  useEffect(() => {
    if (ready) actions.forEach(dispatch);
    // Seeding happens once, when loading finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return null;
}

function Probe() {
  const state = useAppState();
  return (
    <output data-testid="probe">
      {JSON.stringify({
        view: state.view,
        drafts: state.drafts,
        titles: state.titles,
        project: state.selectedProjectId,
      })}
    </output>
  );
}

/** History is only mounted on its own tab, as in the app. */
function HistoryTab() {
  return useAppState().view === "history" ? <HistoryView /> : null;
}

const probe = () =>
  JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as {
    view: string;
    drafts: Record<string, Record<string, string>>;
    titles: Record<string, string>;
    project: string | null;
  };

async function renderOpen(
  entry: PromptEntry,
  seed: Action[] = [],
  { projectsLoading = false } = {},
) {
  vi.mocked(listPromptEntries).mockResolvedValue([entry]);
  render(
    <AppStateProvider>
      <HistoryProvider>
        <Seed
          actions={[...seed, { type: "viewChanged", view: "history" }]}
          projectsLoading={projectsLoading}
        />
        <HistoryTab />
        <Probe />
        <TitleField />
        <Toaster />
      </HistoryProvider>
    </AppStateProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Login fix/ }));
  return user;
}

const pane = () => screen.getByRole("region", { name: "Selected prompt" });
const openButton = () =>
  within(pane()).getByRole("button", { name: "Open in Builder" });

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  vi.mocked(listProjects).mockResolvedValue([api]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("OpenInBuilder", () => {
  it("opens_straight_away_into_an_empty_builder", async () => {
    const user = await renderOpen(saved);
    await user.click(openButton());

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(probe().view).toBe("builder"));
    expect(probe().drafts.rtf).toEqual({
      role: "Reviewer",
      task: "Fix the login bug",
    });
    expect(probe().titles.rtf).toBe("Login fix");
  });

  it("asks_before_replacing_the_draft", async () => {
    const user = await renderOpen(saved, [
      { type: "editSection", key: "role", value: "Mine" },
    ]);
    await user.click(openButton());

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Your current RTF draft will be replaced."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/filed under/)).not.toBeInTheDocument();
    expect(probe().view).toBe("history");

    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(probe().view).toBe("builder"));
    expect(probe().drafts.rtf.role).toBe("Reviewer");
  });

  it("asks_before_changing_the_project_while_any_draft_has_text", async () => {
    // Text sits in another framework's draft, and the selected project
    // differs from the entry's (none).
    const other: Framework = {
      ...rtf,
      id: "other",
      name: "Other",
      sections: [{ key: "a", label: "A", helpText: "" }],
    };
    vi.mocked(listFrameworks).mockResolvedValue([rtf, other]);
    const user = await renderOpen(saved, [
      { type: "selectFramework", id: "other" },
      { type: "editSection", key: "a", value: "work in progress" },
      { type: "projectSelected", id: api.id },
    ]);
    await user.click(openButton());

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Your unsaved drafts will be filed under No project.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/will be replaced/)).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(probe().view).toBe("builder"));
    expect(probe().project).toBeNull();
  });

  it("asks_before_moving_drafts_to_its_project_while_the_projects_load", async () => {
    // The entry keeps its project until the list can confirm it, so the
    // other framework's draft would move to it.
    const other: Framework = {
      ...rtf,
      id: "other",
      name: "Other",
      sections: [{ key: "a", label: "A", helpText: "" }],
    };
    vi.mocked(listFrameworks).mockResolvedValue([rtf, other]);
    vi.mocked(listProjects).mockReturnValue(new Promise(() => {}));
    const user = await renderOpen(
      { ...saved, projectId: api.id },
      [
        { type: "selectFramework", id: "other" },
        { type: "editSection", key: "a", value: "work in progress" },
      ],
      { projectsLoading: true },
    );
    await user.click(openButton());

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Your unsaved drafts will be filed under this prompt's project.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(probe().view).toBe("builder"));
    expect(probe().project).toBe(api.id);
  });

  it("cancel_leaves_the_builder_untouched", async () => {
    const user = await renderOpen(saved, [
      { type: "editSection", key: "role", value: "Mine" },
    ]);
    await user.click(openButton());
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(probe().view).toBe("history");
    expect(probe().drafts.rtf).toEqual({ role: "Mine" });
  });

  it("names_sections_that_could_not_be_placed", async () => {
    const withExtra: PromptEntry = {
      ...saved,
      sectionValues: { ...saved.sectionValues, format: "As a list" },
    };
    const user = await renderOpen(withExtra);
    await user.click(openButton());

    expect(
      await screen.findByText(
        "Opened. Not placed: Format; they are still in History.",
      ),
    ).toBeInTheDocument();
    expect(probe().drafts.rtf).not.toHaveProperty("format");
  });

  describe("a deleted framework", () => {
    const gone: Framework = { ...rtf, deletedAt: 5 };

    beforeEach(() => {
      vi.mocked(listFrameworks).mockResolvedValue([gone]);
    });

    async function openDialog(entry: PromptEntry, seed: Action[] = []) {
      const user = await renderOpen(entry, seed);
      await user.click(openButton());
      const dialog = await screen.findByRole("alertdialog");
      return { user, dialog };
    }

    it("open_in_builder_offers_to_bring_back_a_deleted_framework", async () => {
      const { dialog } = await openDialog(saved);

      expect(within(dialog).getByText("Bring back RTF?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "RTF was deleted. Bring it back and open this prompt?",
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Bring back and open" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText(/will be replaced/)).toBeNull();
      expect(within(dialog).queryByText(/filed under/)).toBeNull();
      expect(probe().view).toBe("history");
    });

    it("bringing_back_restores_then_opens_the_entry", async () => {
      vi.mocked(restoreFramework).mockResolvedValue(rtf);
      const { user, dialog } = await openDialog(saved);
      await user.click(
        within(dialog).getByRole("button", { name: "Bring back and open" }),
      );

      await waitFor(() => expect(probe().view).toBe("builder"));
      expect(restoreFramework).toHaveBeenCalledExactlyOnceWith("rtf");
      expect(probe().drafts.rtf).toEqual({
        role: "Reviewer",
        task: "Fix the login bug",
      });
      expect(probe().titles.rtf).toBe("Login fix");
      const title = screen.getByRole("textbox", { name: "Title" });
      expect(title).toHaveValue("Login fix");
      expect(title).toHaveFocus();
    });

    it("bringing_back_a_renamed_framework_says_its_new_name", async () => {
      vi.mocked(restoreFramework).mockResolvedValue({
        ...rtf,
        name: "RTF (2)",
      });
      const { user, dialog } = await openDialog(saved);
      await user.click(
        within(dialog).getByRole("button", { name: "Bring back and open" }),
      );

      expect(
        await screen.findByText("Brought back as RTF (2)."),
      ).toBeInTheDocument();
      await waitFor(() => expect(probe().view).toBe("builder"));
    });

    it("a_failed_restore_opens_nothing", async () => {
      vi.mocked(restoreFramework).mockRejectedValue(
        new ApiError("database", "disk is full"),
      );
      const { user, dialog } = await openDialog(saved);
      await user.click(
        within(dialog).getByRole("button", { name: "Bring back and open" }),
      );

      expect(await screen.findByText(/disk is full/)).toBeInTheDocument();
      expect(probe().view).toBe("history");
      expect(probe().drafts).toEqual({});
      await waitFor(() =>
        expect(openButton()).not.toHaveAttribute("aria-disabled"),
      );
    });

    it("the_button_is_unavailable_while_bringing_back", async () => {
      vi.mocked(restoreFramework).mockReturnValue(new Promise(() => {}));
      const { user, dialog } = await openDialog(saved);
      await user.click(
        within(dialog).getByRole("button", { name: "Bring back and open" }),
      );

      await waitFor(() =>
        expect(openButton()).toHaveAttribute("aria-disabled", "true"),
      );
      await user.click(openButton());
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(restoreFramework).toHaveBeenCalledTimes(1);
    });

    it("cancelling_brings_nothing_back", async () => {
      const { user, dialog } = await openDialog(saved);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(restoreFramework).not.toHaveBeenCalled();
      expect(probe().view).toBe("history");
    });

    it("the_dialog_also_names_a_project_change", async () => {
      const other: Framework = {
        ...rtf,
        id: "other",
        name: "Other",
        sections: [{ key: "a", label: "A", helpText: "" }],
      };
      vi.mocked(listFrameworks).mockResolvedValue([gone, other]);
      vi.mocked(restoreFramework).mockResolvedValue(rtf);
      const { user, dialog } = await openDialog(saved, [
        { type: "selectFramework", id: "other" },
        { type: "editSection", key: "a", value: "work in progress" },
        { type: "projectSelected", id: api.id },
      ]);

      expect(within(dialog).getByText("Bring back RTF?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "Your unsaved drafts will be filed under No project.",
        ),
      ).toBeInTheDocument();

      await user.click(
        within(dialog).getByRole("button", { name: "Bring back and open" }),
      );
      await waitFor(() => expect(probe().view).toBe("builder"));
      expect(probe().project).toBeNull();
    });
  });

  it("an_entry_without_a_framework_stays_unavailable", async () => {
    const user = await renderOpen({ ...saved, frameworkId: null });
    const button = openButton();

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      within(pane()).getByText(
        "This prompt's framework is no longer available.",
      ),
    ).toBeInTheDocument();
    await user.click(button);
    expect(probe().view).toBe("history");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("is_unavailable_when_the_framework_is_gone", async () => {
    const user = await renderOpen({ ...saved, frameworkId: "gone" });
    const button = openButton();

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      within(pane()).getByText(
        "This prompt's framework is no longer available.",
      ),
    ).toBeInTheDocument();
    await user.click(button);
    expect(probe().view).toBe("history");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
