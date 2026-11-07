import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  deleteProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
  pickFolder,
  renameProject,
  setProjectFolder,
} from "../api";
import type { Project } from "../bindings/Project";
import { FOLDER_MAX_CHARS, shortenPath } from "../paths";
import { AppStateProvider } from "../state/AppState";
import { ProjectPicker } from "./ProjectPicker";
import { Toaster } from "./Toaster";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  pickFolder: vi.fn(),
  setProjectFolder: vi.fn(),
}));

function project(id: string, name: string): Project {
  return { id, name, folder: null, createdAt: 1, updatedAt: 1 };
}

const api = project("0192f000-0000-7000-8000-000000000001", "api");
const web = project("0192f000-0000-7000-8000-000000000002", "web");
const withFolder: Project = { ...web, folder: "/home/me/web" };

/** Renders the Builder's picker and opens Manage projects from its list. */
async function openDialog() {
  render(
    <AppStateProvider>
      <ProjectPicker />
      <Toaster />
    </AppStateProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(
    await screen.findByRole("option", { name: "Manage projects…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Manage projects",
  });
  return { user, dialog };
}

/** The project names listed, in order. */
function names(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByTestId("project-name")
    .map((name) => name.textContent);
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
  vi.mocked(listProjects).mockResolvedValue([api, web]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("ManageProjectsDialog", () => {
  it("renames and deletes after confirming", async () => {
    vi.mocked(renameProject).mockResolvedValue(project(api.id, "API v2"));
    vi.mocked(deleteProject).mockResolvedValue();
    const { user, dialog } = await openDialog();
    expect(names(dialog)).toEqual(["api", "web"]);

    await user.click(
      within(dialog).getByRole("button", { name: "Rename api" }),
    );
    const rename = await screen.findByRole("dialog", {
      name: "Rename project",
    });
    const field = within(rename).getByRole("textbox", { name: "Name" });
    expect(field).toHaveValue("api");
    await user.clear(field);
    await user.type(field, "API v2{Enter}");

    expect(renameProject).toHaveBeenCalledWith(api.id, "API v2");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename project" }),
      ).toBeNull(),
    );
    expect(names(dialog)).toEqual(["API v2", "web"]);

    await user.click(
      within(dialog).getByRole("button", { name: "Delete web" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(deleteProject).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(deleteProject).toHaveBeenCalledWith(web.id);
    await waitFor(() => expect(names(dialog)).toEqual(["API v2"]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Manage projects" }),
    ).toBeInTheDocument();
  });

  it("says prompts move to No project when deleting", async () => {
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Delete web" }),
    );

    const confirm = await screen.findByRole("alertdialog", {
      name: "Delete “web”?",
    });
    expect(confirm).toHaveAccessibleDescription(
      "Its prompts move to No project. No prompts are deleted.",
    );

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteProject).not.toHaveBeenCalled();
    expect(names(dialog)).toEqual(["api", "web"]);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Delete web" }),
      ).toHaveFocus(),
    );
  });

  it("keeps the rename dialog open on a duplicate name", async () => {
    vi.mocked(renameProject).mockRejectedValue(
      new ApiError("invalid", "A project named “web” already exists."),
    );
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Rename api" }),
    );
    const rename = await screen.findByRole("dialog", {
      name: "Rename project",
    });
    const field = within(rename).getByRole("textbox", { name: "Name" });
    await user.clear(field);
    await user.type(field, "WEB");
    await user.click(within(rename).getByRole("button", { name: "Rename" }));

    expect(
      await screen.findByText("A project named “web” already exists."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Rename project" })).toBe(rename);
    expect(field).toHaveValue("WEB");
    expect(names(dialog)).toEqual(["api", "web"]);
  });

  it("closes the rename dialog without a call when the name is unchanged", async () => {
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Rename api" }),
    );
    const rename = await screen.findByRole("dialog", {
      name: "Rename project",
    });
    await user.click(within(rename).getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename project" }),
      ).toBeNull(),
    );
    expect(renameProject).not.toHaveBeenCalled();
  });

  it("manage_shows_each_projects_folder", async () => {
    vi.mocked(listProjects).mockResolvedValue([api, withFolder]);
    const { dialog } = await openDialog();

    const rows = within(dialog).getAllByRole("listitem");
    expect(within(rows[0]).getByText("No folder")).toBeInTheDocument();
    expect(within(rows[1]).getByText("/home/me/web")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("No folder")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Clear folder of api" }),
    ).toBeNull();
  });

  it("choosing_a_folder_saves_it", async () => {
    vi.mocked(pickFolder).mockResolvedValue("/home/me/api");
    vi.mocked(setProjectFolder).mockResolvedValue({
      ...api,
      folder: "/home/me/api",
    });
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Folder… for api" }),
    );

    await waitFor(() =>
      expect(setProjectFolder).toHaveBeenCalledWith(api.id, "/home/me/api"),
    );
    expect(await within(dialog).findByText("/home/me/api")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Clear folder of api" }),
    ).toBeInTheDocument();
  });

  it("a_double_click_on_folder_picks_and_saves_once", async () => {
    let resolvePick: (path: string) => void = () => {};
    vi.mocked(pickFolder).mockReturnValue(
      new Promise((resolve) => (resolvePick = resolve)),
    );
    vi.mocked(setProjectFolder).mockResolvedValue({
      ...api,
      folder: "/home/me/api",
    });
    const { user, dialog } = await openDialog();
    const folder = within(dialog).getByRole("button", {
      name: "Folder… for api",
    });

    await user.dblClick(folder);
    expect(folder).toHaveAttribute("aria-disabled", "true");
    resolvePick("/home/me/api");

    expect(await within(dialog).findByText("/home/me/api")).toBeInTheDocument();
    expect(pickFolder).toHaveBeenCalledTimes(1);
    expect(setProjectFolder).toHaveBeenCalledTimes(1);
    expect(folder).toHaveAttribute("aria-disabled", "false");
  });

  it("clearing_a_folder_saves_null", async () => {
    vi.mocked(listProjects).mockResolvedValue([api, withFolder]);
    vi.mocked(setProjectFolder).mockResolvedValue(web);
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Clear folder of web" }),
    );

    expect(setProjectFolder).toHaveBeenCalledWith(web.id, null);
    await waitFor(() =>
      expect(within(dialog).queryByText("/home/me/web")).toBeNull(),
    );
    expect(
      within(dialog).queryByRole("button", { name: "Clear folder of web" }),
    ).toBeNull();
  });

  it("a_cancelled_chooser_changes_nothing", async () => {
    vi.mocked(pickFolder).mockResolvedValue(null);
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Folder… for api" }),
    );

    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    expect(setProjectFolder).not.toHaveBeenCalled();
    expect(within(dialog).getAllByText("No folder")).toHaveLength(2);
  });

  it("a_refused_folder_is_toasted", async () => {
    vi.mocked(listProjects).mockResolvedValue([api, withFolder]);
    vi.mocked(pickFolder).mockResolvedValue("/gone");
    vi.mocked(setProjectFolder).mockRejectedValue(
      new ApiError("invalid", "That folder no longer exists."),
    );
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Folder… for web" }),
    );

    expect(
      await screen.findByText("That folder no longer exists."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("/home/me/web")).toBeInTheDocument();
    expect(within(dialog).queryByText("/gone")).toBeNull();
  });

  it("says when there are no projects yet", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    const { dialog } = await openDialog();

    expect(dialog).toHaveTextContent("No projects yet.");
    expect(within(dialog).queryByRole("list")).toBeNull();
  });

  it("closes on Done and returns focus to the picker", async () => {
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Project" })).toHaveFocus(),
    );
  });

  it("gives_screen_readers_the_full_path_of_a_long_folder", async () => {
    const long = "/home/me/projects/clients/acme/services/billing/api";
    vi.mocked(listProjects).mockResolvedValue([api, { ...web, folder: long }]);
    const { dialog } = await openDialog();

    const full = within(dialog).getByText(long);
    expect(full).toHaveClass("sr-only");
    expect(
      within(dialog).getByText(shortenPath(long, FOLDER_MAX_CHARS)),
    ).toHaveAttribute("aria-hidden", "true");
    expect(within(dialog).getAllByText(long)).toHaveLength(1);
  });

  it("shows_a_short_folder_once", async () => {
    vi.mocked(listProjects).mockResolvedValue([api, withFolder]);
    const { dialog } = await openDialog();

    expect(within(dialog).getAllByText("/home/me/web")).toHaveLength(1);
    expect(dialog.querySelector(".sr-only")).toBeNull();
  });

  it("clear_folder_moves_focus_to_that_rows_folder_button", async () => {
    vi.mocked(listProjects).mockResolvedValue([api, withFolder]);
    vi.mocked(setProjectFolder).mockResolvedValue(web);
    const { user, dialog } = await openDialog();

    await user.click(
      within(dialog).getByRole("button", { name: "Clear folder of web" }),
    );

    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Folder… for web" }),
      ).toHaveFocus(),
    );
  });

  it("a_failed_chooser_is_toasted_and_can_be_retried", async () => {
    vi.mocked(pickFolder).mockRejectedValueOnce(
      new ApiError("failed", "chooser unavailable"),
    );
    vi.mocked(pickFolder).mockResolvedValue(null);
    const { user, dialog } = await openDialog();
    const folder = within(dialog).getByRole("button", {
      name: "Folder… for api",
    });

    await user.click(folder);

    expect(await screen.findByText("chooser unavailable")).toBeInTheDocument();
    await waitFor(() =>
      expect(folder).toHaveAttribute("aria-disabled", "false"),
    );
    await user.click(folder);
    await waitFor(() => expect(pickFolder).toHaveBeenCalledTimes(2));
  });
});
