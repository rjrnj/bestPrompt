import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
} from "../api";
import type { Project } from "../bindings/Project";
import { AppStateProvider, useAppState } from "../state/AppState";
import { ProjectPicker } from "./ProjectPicker";
import { Toaster } from "./Toaster";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  createProject: vi.fn(),
}));

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
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

    expect(createProject).toHaveBeenCalledWith(" Docs ");
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
});
