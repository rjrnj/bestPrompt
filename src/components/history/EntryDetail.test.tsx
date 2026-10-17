import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  deletePromptEntry,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  setEntryProject,
  setEntryTitle,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { Project } from "../../bindings/Project";
import type { PromptEntry } from "../../bindings/PromptEntry";
import { writeText } from "../../clipboard";
import { AppStateProvider, useAppDispatch } from "../../state/AppState";
import { HistoryProvider } from "../../state/HistoryState";
import { Toaster } from "../Toaster";
import { HistoryView } from "./HistoryView";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
  setEntryTitle: vi.fn(),
  setEntryProject: vi.fn(),
  deletePromptEntry: vi.fn(),
  savePromptEntry: vi.fn(),
}));
vi.mock("../../clipboard", () => ({ writeText: vi.fn() }));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}} {{task}} {{format}}",
  summaryKey: "task",
  isCustom: false,
  sections: [
    { key: "role", label: "Role", helpText: "" },
    { key: "task", label: "Task", helpText: "" },
    { key: "format", label: "Format", helpText: "" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const api: Project = {
  id: "0192f000-0000-7000-8000-000000000001",
  name: "api",
  createdAt: 1,
  updatedAt: 1,
};

const createdAt = new Date(2020, 0, 5, 9, 30).getTime();

const saved: PromptEntry = {
  id: "e1",
  frameworkId: "rtf",
  frameworkSnapshot: {
    name: "RTF",
    template: rtf.template,
    summaryKey: "task",
    sections: rtf.sections,
  },
  sectionValues: {
    role: "Reviewer",
    task: "Fix the login bug\nsoon",
    format: "  ",
  },
  renderedPrompt: "Reviewer\n\n  Fix the login bug\nsoon  \n",
  title: null,
  projectId: null,
  createdAt,
};

function ShowHistory() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: "viewChanged", view: "history" });
  }, [dispatch]);
  return null;
}

async function renderDetail(entry: PromptEntry = saved, select = true) {
  vi.mocked(listPromptEntries).mockResolvedValue([entry]);
  render(
    <AppStateProvider>
      <HistoryProvider>
        <ShowHistory />
        <HistoryView />
        <Toaster />
      </HistoryProvider>
    </AppStateProvider>,
  );
  const row = await screen.findByRole("button", {
    name: /Fix the login bug|Mine/,
  });
  const user = userEvent.setup();
  if (select) await user.click(row);
  return user;
}

const pane = () => screen.getByRole("region", { name: "Selected prompt" });

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  vi.mocked(listProjects).mockResolvedValue([api]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(writeText).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("EntryDetail", () => {
  it("shows_label_meta_and_sections_from_the_snapshot", async () => {
    await renderDetail({ ...saved, projectId: api.id });

    const when = new Date(createdAt).toLocaleString(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    });
    expect(
      within(pane()).getByRole("heading", { name: "Fix the login bug" }),
    ).toBeInTheDocument();
    expect(within(pane()).getByText(`RTF · api · ${when}`)).toBeInTheDocument();

    const headings = within(pane())
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Role", "Task"]);
    const task = within(pane()).getByText("Task").nextElementSibling;
    expect(task?.textContent).toBe("Fix the login bug\nsoon");
  });

  it("reads_only_the_entry's_own_section_values", async () => {
    await renderDetail({
      ...saved,
      frameworkSnapshot: {
        ...saved.frameworkSnapshot,
        sections: [
          { key: "constructor", label: "Builder", helpText: "" },
          { key: "toString", label: "Text", helpText: "" },
          ...rtf.sections,
        ],
      },
      sectionValues: { constructor: "Mine", task: "Fix the login bug" },
    });

    const headings = within(pane())
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Builder", "Task"]);
    const builder = within(pane()).getByText("Builder").nextElementSibling;
    expect(builder?.textContent).toBe("Mine");
  });

  it("sections_drop_their_leading_and_trailing_blank_lines", async () => {
    await renderDetail({
      ...saved,
      sectionValues: {
        ...saved.sectionValues,
        role: "\n  \r\n    Reviewer of\n\n  the login code \n \t\n\n",
      },
    });

    const role = within(pane()).getByText("Role").nextElementSibling;
    expect(role?.textContent).toBe("    Reviewer of\n\n  the login code ");
  });

  it("prompt_toggle_shows_the_saved_text_exactly", async () => {
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("radio", { name: "Prompt" }));

    expect(screen.getByTestId("saved-prompt").textContent).toBe(
      saved.renderedPrompt,
    );

    await user.click(within(pane()).getByRole("radio", { name: "Sections" }));
    expect(screen.queryByTestId("saved-prompt")).not.toBeInTheDocument();
  });

  it("copy_writes_the_saved_prompt_and_does_not_save", async () => {
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(saved.renderedPrompt);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    const api_ = await import("../../api");
    expect(api_.savePromptEntry).not.toHaveBeenCalled();
  });

  it("changing_the_project_updates_the_entry", async () => {
    vi.mocked(setEntryProject).mockResolvedValue({
      ...saved,
      projectId: api.id,
    });
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("combobox", { name: "Project" }));
    await user.click(await screen.findByRole("option", { name: "api" }));

    expect(setEntryProject).toHaveBeenCalledWith("e1", api.id);
    expect(await within(pane()).findByText(/RTF · api · /)).toBeInTheDocument();
  });

  it("renaming_sets_and_clearing_removes_the_title", async () => {
    vi.mocked(setEntryTitle).mockResolvedValueOnce({
      ...saved,
      title: "Login fix",
    });
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename prompt" });
    await user.type(within(dialog).getByLabelText("Title"), "Login fix");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(setEntryTitle).toHaveBeenLastCalledWith("e1", "Login fix");
    expect(
      await within(pane()).findByRole("heading", { name: "Login fix" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    vi.mocked(setEntryTitle).mockResolvedValueOnce({ ...saved, title: null });
    await user.click(within(pane()).getByRole("button", { name: "Rename" }));
    const again = await screen.findByRole("dialog", { name: "Rename prompt" });
    const field = within(again).getByLabelText("Title");
    expect(field).toHaveValue("Login fix");
    await user.clear(field);
    await user.click(within(again).getByRole("button", { name: "Save" }));

    expect(setEntryTitle).toHaveBeenLastCalledWith("e1", null);
    expect(
      await within(pane()).findByRole("heading", { name: "Fix the login bug" }),
    ).toBeInTheDocument();
  });

  it("delete_asks_then_removes_the_entry", async () => {
    vi.mocked(deletePromptEntry).mockResolvedValue(undefined);
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete this prompt?");
    expect(dialog).toHaveTextContent("This can't be undone.");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deletePromptEntry).not.toHaveBeenCalled();

    await user.click(within(pane()).getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    expect(deletePromptEntry).toHaveBeenCalledWith("e1");
    expect(
      await screen.findByText("Select a prompt to read it."),
    ).toBeInTheDocument();
  });

  it("deleting_moves_focus_to_the_hint", async () => {
    vi.mocked(deletePromptEntry).mockResolvedValue(undefined);
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    const hint = await screen.findByText("Select a prompt to read it.");
    await waitFor(() => expect(hint).toHaveFocus());
  });

  it("a_second_delete_waits_for_the_first", async () => {
    let finish: () => void = () => {};
    vi.mocked(deletePromptEntry).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = await renderDetail();
    for (let i = 0; i < 2; i++) {
      await user.click(within(pane()).getByRole("button", { name: "Delete" }));
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Delete",
        }),
      );
    }
    expect(deletePromptEntry).toHaveBeenCalledTimes(1);
    finish();
    expect(
      await screen.findByText("Select a prompt to read it."),
    ).toBeInTheDocument();
  });

  it("choosing_no_project_clears_the_entrys_project", async () => {
    vi.mocked(setEntryProject).mockResolvedValue({ ...saved, projectId: null });
    const user = await renderDetail({ ...saved, projectId: api.id });
    await user.click(within(pane()).getByRole("combobox", { name: "Project" }));
    await user.click(await screen.findByRole("option", { name: "No project" }));

    expect(setEntryProject).toHaveBeenCalledWith("e1", null);
    expect(
      await within(pane()).findByText(/RTF · no project · /),
    ).toBeInTheDocument();
  });

  it("a_failed_copy_toasts_the_error", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("no clipboard"));
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("button", { name: "Copy" }));

    expect(
      await screen.findByText("Couldn't copy to the clipboard: no clipboard"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("a_failed_edit_toasts_and_keeps_the_entry", async () => {
    vi.mocked(setEntryProject).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    const user = await renderDetail();
    await user.click(within(pane()).getByRole("combobox", { name: "Project" }));
    await user.click(await screen.findByRole("option", { name: "api" }));

    expect(
      await screen.findByText(/Couldn't change the project: disk full/),
    ).toBeInTheDocument();
    expect(within(pane()).getByText(/RTF · no project · /)).toBeInTheDocument();

    vi.mocked(setEntryTitle).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    await user.click(within(pane()).getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename prompt" });
    await user.type(within(dialog).getByLabelText("Title"), "X");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText(/Couldn't change the title/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Fix the login bug", { selector: "h2" }),
    ).toBeInTheDocument();
  });

  it("nothing_selected_shows_a_hint", async () => {
    await renderDetail(saved, false);
    expect(
      within(pane()).getByText("Select a prompt to read it."),
    ).toBeInTheDocument();
  });
});
