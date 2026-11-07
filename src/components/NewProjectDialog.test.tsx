import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
  pickFolder,
} from "../api";
import type { Project } from "../bindings/Project";
import { AppStateProvider, useAppState } from "../state/AppState";
import { FOLDER_MAX_CHARS, shortenPath } from "../paths";
import { ProjectPicker } from "./ProjectPicker";
import { Toaster } from "./Toaster";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  createProject: vi.fn(),
  pickFolder: vi.fn(),
}));

function project(id: string, name: string): Project {
  return { id, name, folder: null, createdAt: 1, updatedAt: 1 };
}

const api = project("0192f000-0000-7000-8000-000000000001", "api");
const docs = project("0192f000-0000-7000-8000-000000000003", "Docs");

function Selected() {
  return <p>selected: {useAppState().selectedProjectId ?? "none"}</p>;
}

/** Renders the Builder's picker and opens New project from its list. */
async function openDialog() {
  render(
    <AppStateProvider>
      <ProjectPicker />
      <Selected />
      <Toaster />
    </AppStateProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("option", { name: "New project…" }));
  const dialog = await screen.findByRole("dialog", { name: "New project" });
  return { user, dialog };
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
  vi.mocked(listProjects).mockResolvedValue([api]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("NewProjectDialog", () => {
  it("creates the project and selects it", async () => {
    vi.mocked(createProject).mockResolvedValue(docs);
    const { user, dialog } = await openDialog();

    const name = within(dialog).getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    await user.type(name, " Docs {Enter}");

    expect(createProject).toHaveBeenCalledWith(" Docs ", null);
    expect(await screen.findByText(`selected: ${docs.id}`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger).toHaveTextContent("Docs");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("stays open on a duplicate name", async () => {
    vi.mocked(createProject).mockRejectedValue(
      new ApiError("invalid", "A project named “api” already exists."),
    );
    const { user, dialog } = await openDialog();

    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await user.type(name, "API");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("A project named “api” already exists."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New project" })).toBe(dialog);
    expect(name).toHaveValue("API");
    expect(screen.getByText("selected: none")).toBeInTheDocument();
  });

  it("offers Create only once a name is typed", async () => {
    const { user, dialog } = await openDialog();
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(create).toHaveAttribute("aria-disabled", "true");

    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), " ");
    await user.click(create);
    await user.keyboard("{Enter}");

    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(createProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("new_project_can_be_created_with_a_folder", async () => {
    vi.mocked(createProject).mockResolvedValue(docs);
    vi.mocked(pickFolder).mockResolvedValue("C:\\work\\docs");
    const { user, dialog } = await openDialog();

    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Docs",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );

    expect(
      await within(dialog).findByText("C:\\work\\docs"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("No folder")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(createProject).toHaveBeenCalledWith("Docs", "C:\\work\\docs");
  });

  it("new_project_without_a_folder_still_works", async () => {
    vi.mocked(createProject).mockResolvedValue(docs);
    const { user, dialog } = await openDialog();

    expect(within(dialog).getByText("No folder")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Clear folder" }),
    ).toBeNull();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Docs",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(createProject).toHaveBeenCalledWith("Docs", null);
  });

  it("clearing_the_new_projects_folder_creates_it_without_one", async () => {
    vi.mocked(createProject).mockResolvedValue(docs);
    vi.mocked(pickFolder).mockResolvedValue("/home/me/docs");
    const { user, dialog } = await openDialog();

    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Docs",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: "Clear folder" }),
    );

    expect(within(dialog).getByText("No folder")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Clear folder" }),
    ).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(createProject).toHaveBeenCalledWith("Docs", null);
  });

  it("a_cancelled_chooser_changes_nothing", async () => {
    vi.mocked(pickFolder).mockResolvedValue(null);
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );

    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    expect(within(dialog).getByText("No folder")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Clear folder" }),
    ).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("choose_folder_opens_one_chooser_at_a_time", async () => {
    let resolvePick: (path: string) => void = () => {};
    vi.mocked(pickFolder).mockReturnValue(
      new Promise((resolve) => (resolvePick = resolve)),
    );
    const { user, dialog } = await openDialog();
    const choose = within(dialog).getByRole("button", {
      name: "Choose folder…",
    });

    await user.dblClick(choose);
    expect(choose).toHaveAttribute("aria-disabled", "true");
    resolvePick("/home/me/docs");

    expect(
      await within(dialog).findByText("/home/me/docs"),
    ).toBeInTheDocument();
    expect(pickFolder).toHaveBeenCalledTimes(1);
    expect(choose).toHaveAttribute("aria-disabled", "false");
  });

  it("a_pick_after_the_dialog_closed_is_dropped", async () => {
    let resolvePick: (path: string) => void = () => {};
    vi.mocked(pickFolder).mockReturnValue(
      new Promise((resolve) => (resolvePick = resolve)),
    );
    const { user, dialog } = await openDialog();
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await act(async () => resolvePick("/home/me/late"));
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "New project…" }),
    );
    const again = await screen.findByRole("dialog", { name: "New project" });

    expect(within(again).getByText("No folder")).toBeInTheDocument();
    expect(within(again).queryByText("/home/me/late")).toBeNull();
    expect(
      within(again).getByRole("button", { name: "Choose folder…" }),
    ).toHaveAttribute("aria-disabled", "false");
  });

  it("starts from No folder after a successful Create", async () => {
    vi.mocked(createProject).mockResolvedValue(docs);
    vi.mocked(pickFolder).mockResolvedValue("/home/me/docs");
    const { user, dialog } = await openDialog();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Docs",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await within(dialog).findByText("/home/me/docs");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "New project…" }),
    );
    const again = await screen.findByRole("dialog", { name: "New project" });
    expect(within(again).getByText("No folder")).toBeInTheDocument();
  });

  it("starts from No folder each time it opens", async () => {
    vi.mocked(pickFolder).mockResolvedValue("/home/me/docs");
    const { user, dialog } = await openDialog();
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await within(dialog).findByText("/home/me/docs");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "New project…" }),
    );
    const again = await screen.findByRole("dialog", { name: "New project" });
    expect(within(again).getByText("No folder")).toBeInTheDocument();
  });

  it("closes on Cancel without creating, and starts empty next time", async () => {
    const { user, dialog } = await openDialog();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "draft",
    );

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Project" })).toHaveFocus(),
    );

    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "New project…" }),
    );
    const again = await screen.findByRole("dialog", { name: "New project" });
    expect(within(again).getByRole("textbox", { name: "Name" })).toHaveValue(
      "",
    );
  });

  it("gives_screen_readers_the_full_path_of_a_long_folder", async () => {
    const long = "/home/me/projects/clients/acme/services/billing/api";
    vi.mocked(pickFolder).mockResolvedValue(long);
    const { user, dialog } = await openDialog();
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );

    const full = await within(dialog).findByText(long);
    expect(full).toHaveClass("sr-only");
    const short = shortenPath(long, FOLDER_MAX_CHARS);
    expect(within(dialog).getByText(short)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(dialog).getAllByText(long)).toHaveLength(1);
  });

  it("shows_a_short_folder_once", async () => {
    vi.mocked(pickFolder).mockResolvedValue("/home/me/docs");
    const { user, dialog } = await openDialog();
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );

    await within(dialog).findByText("/home/me/docs");
    expect(within(dialog).getAllByText("/home/me/docs")).toHaveLength(1);
    expect(dialog.querySelector(".sr-only")).toBeNull();
  });

  it("clear_folder_moves_focus_to_choose_folder", async () => {
    vi.mocked(pickFolder).mockResolvedValue("/home/me/docs");
    const { user, dialog } = await openDialog();
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: "Clear folder" }),
    );

    expect(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    ).toHaveFocus();
  });

  it("labels_the_folder_controls_as_a_group", async () => {
    const { dialog } = await openDialog();

    const group = within(dialog).getByRole("group", { name: "Folder" });
    expect(
      within(group).getByRole("button", { name: "Choose folder…" }),
    ).toBeInTheDocument();
  });

  it("a_failed_chooser_is_toasted_and_can_be_retried", async () => {
    vi.mocked(pickFolder).mockRejectedValueOnce(
      new ApiError("failed", "chooser unavailable"),
    );
    vi.mocked(pickFolder).mockResolvedValue("/home/me/docs");
    const { user, dialog } = await openDialog();
    const choose = within(dialog).getByRole("button", {
      name: "Choose folder…",
    });

    await user.click(choose);

    expect(await screen.findByText("chooser unavailable")).toBeInTheDocument();
    await waitFor(() =>
      expect(choose).toHaveAttribute("aria-disabled", "false"),
    );
    await user.click(choose);
    expect(
      await within(dialog).findByText("/home/me/docs"),
    ).toBeInTheDocument();
  });
});
