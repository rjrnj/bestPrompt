import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  latestEntryProject,
  listFrameworks,
  listProjects,
} from "../api";
import type { Project } from "../bindings/Project";
import { AppStateProvider, useAppState } from "../state/AppState";
import { ProjectPicker } from "./ProjectPicker";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
}));

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

const api = project("0192f000-0000-7000-8000-000000000001", "api");
const web = project("0192f000-0000-7000-8000-000000000002", "web");

function Selected() {
  return <p>selected: {useAppState().selectedProjectId ?? "none"}</p>;
}

function renderPicker() {
  render(
    <AppStateProvider>
      <ProjectPicker />
      <Selected />
    </AppStateProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("ProjectPicker", () => {
  it("selects a project and no project", async () => {
    vi.mocked(listProjects).mockResolvedValue([web, api]);
    renderPicker();
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger).toHaveTextContent("No project");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "web" }));

    expect(screen.getByText(`selected: ${web.id}`)).toBeInTheDocument();
    expect(trigger).toHaveTextContent("web");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "No project" }));

    expect(screen.getByText("selected: none")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("No project");
  });

  it("offers New project and Manage projects after the projects", async () => {
    vi.mocked(listProjects).mockResolvedValue([web, api]);
    renderPicker();
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Project" }));

    // The projects arrive unsorted and are listed by name.
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "api",
      "web",
      "No project",
      "New project…",
      "Manage projects…",
    ]);
  });

  it("selects with the keyboard", async () => {
    vi.mocked(listProjects).mockResolvedValue([api]);
    renderPicker();
    const user = userEvent.setup();
    await screen.findByText("selected: none");

    await user.tab();
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("option", { name: "api" });
    await user.keyboard("{ArrowUp}{Enter}");

    expect(screen.getByText(`selected: ${api.id}`)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveFocus();
  });

  it("offers No project when the projects fail to load", async () => {
    vi.mocked(listProjects).mockRejectedValue(
      new ApiError("database", "no db"),
    );
    renderPicker();
    const user = userEvent.setup();

    const trigger = screen.getByRole("combobox", { name: "Project" });
    await user.click(trigger);

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "No project",
      "New project…",
      "Manage projects…",
    ]);
  });
});
