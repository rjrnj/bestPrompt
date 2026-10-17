import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/AppState";
import { ProjectPicker } from "./ProjectPicker";

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
const web = project("0192f000-0000-7000-8000-000000000002", "web");

function Selected() {
  return <p>selected: {useAppState().selectedProjectId ?? "none"}</p>;
}

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}}",
  summaryKey: null,
  isCustom: false,
  sections: [{ key: "role", label: "Role", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};

/** A saved prompt filed under the api project. */
const savedUnderApi: PromptEntry = {
  id: "e1",
  frameworkId: "rtf",
  frameworkSnapshot: {
    name: rtf.name,
    template: rtf.template,
    summaryKey: null,
    sections: rtf.sections,
  },
  sectionValues: { role: "x" },
  renderedPrompt: "x",
  title: null,
  projectId: api.id,
  createdAt: 1,
  version: 0,
};

/** Opens `savedUnderApi` in the Builder, as History's Open in Builder does. */
function Opener() {
  const dispatch = useAppDispatch();
  return (
    <button
      onClick={() => dispatch({ type: "entryOpened", entry: savedUnderApi })}
    >
      open
    </button>
  );
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderPicker() {
  render(
    <AppStateProvider>
      <ProjectPicker />
      <Selected />
      <Opener />
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

  it("lists and shows a project created while the projects load", async () => {
    vi.mocked(listProjects).mockReturnValue(new Promise(() => {}));
    vi.mocked(createProject).mockResolvedValue(web);
    renderPicker();
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Project" });

    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", { name: "New project…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "web",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByText(`selected: ${web.id}`)).toBeInTheDocument();
    expect(trigger).toHaveTextContent("web");
    await user.click(trigger);
    expect(
      await screen.findByRole("option", { name: "web" }),
    ).toBeInTheDocument();
  });

  it("labels an opened prompt's project until the projects load, then names it", async () => {
    const listing = deferred<Project[]>();
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockReturnValue(listing.promise);
    renderPicker();
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Project" });

    await user.click(screen.getByRole("button", { name: "open" }));

    expect(await screen.findByText(`selected: ${api.id}`)).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Loading projects…");

    await act(async () => listing.resolve([api, web]));

    expect(trigger).toHaveTextContent("api");
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
