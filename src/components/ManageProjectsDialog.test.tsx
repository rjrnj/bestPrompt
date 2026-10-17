import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  deleteProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
  renameProject,
} from "../api";
import type { Project } from "../bindings/Project";
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
}));

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

const api = project("0192f000-0000-7000-8000-000000000001", "api");
const web = project("0192f000-0000-7000-8000-000000000002", "web");

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
});
