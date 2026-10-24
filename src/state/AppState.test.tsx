import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createFramework,
  createProject,
  deleteFramework,
  deleteProject,
  latestEntryProject,
  listFrameworks,
  listProjects,
  renameProject,
  restoreFramework,
  savePromptEntry,
  updateFramework,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { FrameworkInput } from "../bindings/FrameworkInput";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import { writeText } from "../clipboard";
import {
  AppStateProvider,
  useAppActions,
  useAppDispatch,
  useAppState,
} from "./AppState";
import { currentDraft, currentTitle, renderedPrompt } from "./reducer";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  createFramework: vi.fn(),
  updateFramework: vi.fn(),
  deleteFramework: vi.fn(),
  restoreFramework: vi.fn(),
  savePromptEntry: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  latestEntryProject: vi.fn(),
}));
vi.mock("../clipboard", () => ({ writeText: vi.fn() }));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}}",
  summaryKey: null,
  isCustom: false,
  deletedAt: null,
  sections: [{ key: "role", label: "Role", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

const api = project("p-api", "api");
const web = project("p-web", "web");

const input: FrameworkInput = {
  name: "Mine",
  description: "",
  template: "{{role}}",
  summaryKey: "role",
  sections: [{ key: "role", label: "Role", helpText: "" }],
};

/** Shows the state the hooks expose and offers the actions as buttons. */
function Probe() {
  const [result, setResult] = useState("none");
  const [frameworkResult, setFrameworkResult] = useState("none");
  const state = useAppState();
  const dispatch = useAppDispatch();
  const actions = useAppActions();
  const { loadFrameworks, copy, save } = actions;
  const frameworks = state.frameworks;
  const entry = () => ({
    frameworkId: state.selectedId ?? "",
    sectionValues: currentDraft(state),
    renderedPrompt: renderedPrompt(state),
    title: currentTitle(state).trim() === "" ? null : currentTitle(state),
    projectId: state.selectedProjectId,
  });
  const outcome = (promise: Promise<boolean>) =>
    void promise.then((ok) => setResult(String(ok)));
  const frameworkOutcome = (promise: Promise<Framework | null>) =>
    void promise.then((f) => setFrameworkResult(f?.id ?? "null"));
  return (
    <div>
      <p>status: {frameworks.status}</p>
      {frameworks.status === "error" && <p>message: {frameworks.message}</p>}
      <p>selected: {state.selectedId ?? "none"}</p>
      <p>role: {currentDraft(state).role ?? ""}</p>
      <p>saving: {String(state.saving)}</p>
      <p>project: {state.selectedProjectId ?? "none"}</p>
      <p>projects: {state.projects.status}</p>
      <p>
        names:{" "}
        {state.projects.status === "ready"
          ? state.projects.items.map((p) => p.name).join(",")
          : ""}
      </p>
      <p>result: {result}</p>
      <ul aria-label="toasts">
        {state.toasts.map((t) => (
          <li key={t.id}>
            {t.kind}: {t.message}
          </li>
        ))}
      </ul>
      <button onClick={() => void loadFrameworks()}>reload</button>
      <button onClick={() => void copy(entry())}>copy</button>
      <button onClick={() => void save(entry())}>save</button>
      <button
        onClick={() =>
          dispatch({ type: "editSection", key: "role", value: "typed" })
        }
      >
        type
      </button>
      <button onClick={() => outcome(actions.createProject("  new  "))}>
        create
      </button>
      <button
        onClick={() => outcome(actions.renameProject("p-api", "renamed"))}
      >
        rename
      </button>
      <button onClick={() => outcome(actions.deleteProject("p-api"))}>
        remove
      </button>
      <p>
        ids:{" "}
        {frameworks.status === "ready"
          ? frameworks.items
              .map((f) => f.id + (f.deletedAt === null ? "" : "!"))
              .join(",")
          : ""}
      </p>
      <p>framework result: {frameworkResult}</p>
      <button
        onClick={() => frameworkOutcome(actions.saveFramework(null, input))}
      >
        create framework
      </button>
      <button
        onClick={() => frameworkOutcome(actions.saveFramework("rtf", input))}
      >
        edit framework
      </button>
      <button onClick={() => outcome(actions.deleteFramework("rtf"))}>
        delete framework
      </button>
      <button onClick={() => frameworkOutcome(actions.restoreFramework("rtf"))}>
        restore framework
      </button>
      <button
        onClick={() => dispatch({ type: "editTitle", value: "  A title  " })}
      >
        title
      </button>
      <button onClick={() => dispatch({ type: "editTitle", value: "   " })}>
        blank title
      </button>
      <button
        onClick={() => dispatch({ type: "projectSelected", id: "p-web" })}
      >
        pick web
      </button>
      <button
        onClick={() =>
          dispatch({ type: "editSection", key: "role", value: "retyped" })
        }
      >
        retype
      </button>
      <button
        onClick={() =>
          dispatch({
            type: "entryOpened",
            entry: { ...stored("opened"), projectId: "p-api" },
          })
        }
      >
        open
      </button>
    </div>
  );
}

/** A promise the test resolves by hand, to order overlapping loads. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderProbe() {
  return render(
    <AppStateProvider>
      <Probe />
    </AppStateProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("AppStateProvider", () => {
  it("loads the frameworks on mount and selects the first", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);

    renderProbe();

    expect(screen.getByText("status: loading")).toBeInTheDocument();
    expect(await screen.findByText("status: ready")).toBeInTheDocument();
    expect(screen.getByText("selected: rtf")).toBeInTheDocument();
    expect(listFrameworks).toHaveBeenCalledTimes(1);
  });

  it("exposes the error message when loading fails", async () => {
    vi.mocked(listFrameworks).mockRejectedValue(
      new ApiError("database", "no db"),
    );

    renderProbe();

    expect(await screen.findByText("status: error")).toBeInTheDocument();
    expect(screen.getByText("message: no db")).toBeInTheDocument();
  });

  it("reloads through the actions hook, loading again meanwhile", async () => {
    const reload = deferred<Framework[]>();
    vi.mocked(listFrameworks)
      .mockRejectedValueOnce(new ApiError("database", "no db"))
      .mockReturnValueOnce(reload.promise);
    renderProbe();
    await screen.findByText("status: error");

    await userEvent.click(screen.getByRole("button", { name: "reload" }));

    expect(screen.getByText("status: loading")).toBeInTheDocument();
    reload.resolve([rtf]);
    expect(await screen.findByText("status: ready")).toBeInTheDocument();
    expect(listFrameworks).toHaveBeenCalledTimes(2);
  });

  it("ignores the result of a load that a later one superseded", async () => {
    const stale = deferred<Framework[]>();
    const latest = deferred<Framework[]>();
    vi.mocked(listFrameworks)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);
    renderProbe();
    await userEvent.click(screen.getByRole("button", { name: "reload" }));

    latest.resolve([rtf]);
    await screen.findByText("status: ready");
    stale.resolve([{ ...rtf, id: "other", name: "Other" }]);
    await screen.findByText("status: ready");

    expect(screen.getByText("selected: rtf")).toBeInTheDocument();
  });

  it("applies dispatched actions through the reducer", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    renderProbe();
    await screen.findByText("status: ready");

    await userEvent.click(screen.getByRole("button", { name: "type" }));

    expect(screen.getByText("role: typed")).toBeInTheDocument();
  });

  it("refuses each hook outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const StateOnly = () => <p>{useAppState().selectedId}</p>;
    const DispatchOnly = () => <p>{typeof useAppDispatch()}</p>;
    const ActionsOnly = () => <p>{typeof useAppActions().loadFrameworks}</p>;

    expect(() => render(<StateOnly />)).toThrow(
      /useAppState.*AppStateProvider/,
    );
    expect(() => render(<DispatchOnly />)).toThrow(
      /useAppDispatch.*AppStateProvider/,
    );
    expect(() => render(<ActionsOnly />)).toThrow(
      /useAppActions.*AppStateProvider/,
    );
  });
});

/** What the backend returns for a saved entry; the provider only awaits it. */
function stored(prompt: string): PromptEntry {
  return {
    id: "entry",
    frameworkId: "rtf",
    frameworkSnapshot: {
      name: rtf.name,
      template: rtf.template,
      summaryKey: rtf.summaryKey,
      sections: rtf.sections,
    },
    sectionValues: { role: prompt },
    renderedPrompt: prompt,
    title: null,
    projectId: null,
    createdAt: 1,
    version: 0,
  };
}

/** The provider with RTF loaded and "typed" in its only section. */
async function renderTyped() {
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  renderProbe();
  await screen.findByText("status: ready");
  await userEvent.click(screen.getByRole("button", { name: "type" }));
}

function toasts() {
  const list = screen.getByRole("list", { name: "toasts" });
  return Array.from(list.querySelectorAll("li"), (li) => li.textContent);
}

async function click(name: string) {
  await userEvent.click(screen.getByRole("button", { name }));
}

describe("AppStateProvider save flow", () => {
  it("copies the prompt, then saves it with the draft", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();

    await click("copy");

    expect(writeText).toHaveBeenCalledWith("typed");
    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "typed" },
      renderedPrompt: "typed",
      title: null,
      projectId: null,
    });
    expect(toasts()).toEqual(["info: Copied and saved"]);
  });

  it("copies an unchanged prompt again without saving it twice", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();
    await click("copy");

    await click("copy");

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Copied and saved", "info: Copied"]);
  });

  it("saves again once the prompt has changed", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();
    await click("copy");

    await click("retype");
    await click("copy");

    expect(savePromptEntry).toHaveBeenCalledTimes(2);
    expect(savePromptEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ renderedPrompt: "retyped" }),
    );
  });

  it("saves nothing when the clipboard write fails", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("no display"));
    await renderTyped();

    await click("copy");

    expect(savePromptEntry).not.toHaveBeenCalled();
    expect(toasts()).toEqual([
      "error: Couldn't copy to the clipboard: no display",
    ]);
  });

  it("reports a failed save after a successful copy", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    await renderTyped();

    await click("copy");

    expect(toasts()).toEqual(["error: Copied, but couldn't save: disk full"]);
    expect(screen.getByText("saving: false")).toBeInTheDocument();
  });

  it("saves without copying, and only once while unchanged", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();

    await click("save");
    await click("save");

    expect(writeText).not.toHaveBeenCalled();
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Saved", "info: Already saved"]);
  });

  it("keeps the draft when a save fails, and the next save tries again", async () => {
    vi.mocked(savePromptEntry)
      .mockRejectedValueOnce(new ApiError("database", "disk full"))
      .mockResolvedValueOnce(stored("typed"));
    await renderTyped();

    await click("save");

    expect(toasts()).toEqual(["error: Couldn't save: disk full"]);
    expect(screen.getByText("role: typed")).toBeInTheDocument();
    expect(screen.getByText("saving: false")).toBeInTheDocument();
    await click("save");
    expect(savePromptEntry).toHaveBeenCalledTimes(2);
    expect(toasts()).toContain("info: Saved");
  });

  it("is saving while the save is in flight", async () => {
    const pending = deferred<PromptEntry>();
    vi.mocked(savePromptEntry).mockReturnValue(pending.promise);
    await renderTyped();

    await click("save");

    expect(screen.getByText("saving: true")).toBeInTheDocument();
    await act(async () => pending.resolve(stored("typed")));
    expect(screen.getByText("saving: false")).toBeInTheDocument();
  });

  it("records the prompt that was saved, not one typed during the save", async () => {
    const pending = deferred<PromptEntry>();
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(stored("retyped"));
    await renderTyped();

    await click("save");
    await click("retype");
    await act(async () => pending.resolve(stored("typed")));
    await click("copy");

    expect(savePromptEntry).toHaveBeenCalledTimes(2);
    expect(savePromptEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ renderedPrompt: "retyped" }),
    );
    expect(toasts()).toEqual(["info: Saved", "info: Copied and saved"]);
  });

  // A double click lands both clicks before the first copy has finished.
  it("ignores a copy or save started while another is running", async () => {
    const clipboard = deferred<void>();
    vi.mocked(writeText).mockReturnValue(clipboard.promise);
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();

    await click("copy");
    await click("copy");
    await click("save");
    await act(async () => clipboard.resolve());

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Copied and saved"]);
  });
});

describe("AppStateProvider projects", () => {
  it("selects the newest entry's project on startup", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    vi.mocked(latestEntryProject).mockResolvedValue("p-web");

    renderProbe();

    expect(await screen.findByText("project: p-web")).toBeInTheDocument();
    expect(screen.getByText("names: api,web")).toBeInTheDocument();
    expect(toasts()).toEqual([]);
  });

  it("looks up the starting project alongside the project list", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockReturnValue(new Promise(() => {}));

    renderProbe();

    await waitFor(() => expect(latestEntryProject).toHaveBeenCalledTimes(1));
    expect(screen.getByText("projects: loading")).toBeInTheDocument();
  });

  it("saves a prompt opened while the projects load under its project", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockReturnValue(new Promise(() => {}));
    vi.mocked(savePromptEntry).mockResolvedValue(stored("opened"));
    renderProbe();
    await screen.findByText("status: ready");

    await click("open");
    await click("type");
    await click("save");

    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ projectId: "p-api" }),
    );
  });

  it("keeps a project picked before the startup lookup returns", async () => {
    const lookup = deferred<string | null>();
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    vi.mocked(latestEntryProject).mockReturnValue(lookup.promise);
    renderProbe();
    await screen.findByText("projects: ready");

    await click("pick web");
    await act(async () => lookup.resolve("p-api"));

    expect(screen.getByText("project: p-web")).toBeInTheDocument();
  });

  it("keeps a project created while the projects load", async () => {
    const listing = deferred<Project[]>();
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockReturnValue(listing.promise);
    vi.mocked(createProject).mockResolvedValue(project("p-new", "new"));
    renderProbe();
    await screen.findByText("status: ready");

    await click("create");
    await screen.findByText("result: true");
    // The list was read before the project was created.
    await act(async () => listing.resolve([api]));

    expect(screen.getByText("names: api,new")).toBeInTheDocument();
    expect(screen.getByText("project: p-new")).toBeInTheDocument();
  });

  it("starts with no project when history is empty", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api]);

    renderProbe();

    await screen.findByText("projects: ready");
    await waitFor(() => expect(latestEntryProject).toHaveBeenCalled());
    expect(screen.getByText("project: none")).toBeInTheDocument();
  });

  it("starts with no project when the newest project is not in the list", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api]);
    vi.mocked(latestEntryProject).mockResolvedValue("gone");

    renderProbe();

    await screen.findByText("projects: ready");
    await waitFor(() => expect(latestEntryProject).toHaveBeenCalled());
    expect(screen.getByText("project: none")).toBeInTheDocument();
  });

  it("starts with no project, and no toast, when the lookup fails", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api]);
    vi.mocked(latestEntryProject).mockRejectedValue(
      new ApiError("database", "no db"),
    );

    renderProbe();

    await screen.findByText("projects: ready");
    await waitFor(() => expect(latestEntryProject).toHaveBeenCalled());
    expect(screen.getByText("project: none")).toBeInTheDocument();
    expect(screen.getByText("status: ready")).toBeInTheDocument();
    expect(toasts()).toEqual([]);
  });

  it("keeps the Builder working, with no toast, when the projects fail to load", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockRejectedValue(
      new ApiError("database", "no db"),
    );

    renderProbe();

    expect(await screen.findByText("projects: error")).toBeInTheDocument();
    expect(screen.getByText("status: ready")).toBeInTheDocument();
    expect(screen.getByText("project: none")).toBeInTheDocument();
    expect(toasts()).toEqual([]);
  });

  it("creates a project, selects it and returns true", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(createProject).mockResolvedValue(project("p-new", "new"));
    renderProbe();
    await screen.findByText("projects: ready");

    await click("create");

    expect(createProject).toHaveBeenCalledExactlyOnceWith("  new  ");
    expect(await screen.findByText("result: true")).toBeInTheDocument();
    expect(screen.getByText("project: p-new")).toBeInTheDocument();
    expect(screen.getByText("names: new")).toBeInTheDocument();
  });

  it("toasts the message of a duplicate name and returns false", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(createProject).mockRejectedValue(
      new ApiError("invalid", "A project named new already exists"),
    );
    renderProbe();
    await screen.findByText("projects: ready");

    await click("create");

    expect(await screen.findByText("result: false")).toBeInTheDocument();
    expect(toasts()).toEqual(["error: A project named new already exists"]);
    expect(screen.getByText("project: none")).toBeInTheDocument();
  });

  it("renames a project and returns true, or toasts and returns false", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    vi.mocked(renameProject)
      .mockResolvedValueOnce({ ...api, name: "renamed" })
      .mockRejectedValueOnce(new ApiError("notFound", "No such project"));
    renderProbe();
    await screen.findByText("names: api,web");

    await click("rename");
    expect(await screen.findByText("names: renamed,web")).toBeInTheDocument();
    expect(screen.getByText("result: true")).toBeInTheDocument();

    await click("rename");
    expect(
      await screen.findByText("error: No such project"),
    ).toBeInTheDocument();
    expect(screen.getByText("result: false")).toBeInTheDocument();
  });

  it("falls back to no project when the selected one is deleted", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    vi.mocked(latestEntryProject).mockResolvedValue("p-api");
    vi.mocked(deleteProject).mockResolvedValue();
    renderProbe();
    await screen.findByText("project: p-api");

    await click("remove");

    expect(deleteProject).toHaveBeenCalledExactlyOnceWith("p-api");
    expect(await screen.findByText("project: none")).toBeInTheDocument();
    expect(screen.getByText("names: web")).toBeInTheDocument();
    expect(screen.getByText("result: true")).toBeInTheDocument();
  });

  it("keeps the project and toasts when a delete fails", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    vi.mocked(latestEntryProject).mockResolvedValue("p-api");
    vi.mocked(deleteProject).mockRejectedValue(
      new ApiError("database", "locked"),
    );
    renderProbe();
    await screen.findByText("project: p-api");

    await click("remove");

    expect(await screen.findByText("result: false")).toBeInTheDocument();
    expect(screen.getByText("project: p-api")).toBeInTheDocument();
    expect(toasts()).toEqual(["error: locked"]);
  });
});

describe("AppStateProvider saving a title and project", () => {
  it("copies and saves the title and the selected project", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    vi.mocked(latestEntryProject).mockResolvedValue("p-api");
    await renderTyped();
    await screen.findByText("project: p-api");
    await click("title");

    await click("copy");

    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "typed" },
      renderedPrompt: "typed",
      title: "  A title  ",
      projectId: "p-api",
    });
  });

  it("saves a blank title as none", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();
    await click("blank title");

    await click("save");

    expect(savePromptEntry).toHaveBeenCalledWith(
      expect.objectContaining({ title: null, projectId: null }),
    );
  });

  it("does not save again when only the title or project changed", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    vi.mocked(listProjects).mockResolvedValue([api, web]);
    await renderTyped();
    await click("save");

    await click("title");
    await click("pick web");
    await click("save");

    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Saved", "info: Already saved"]);
  });
});

describe("AppStateProvider framework actions", () => {
  const mine: Framework = { ...rtf, id: "c-1", name: "Mine", isCustom: true };

  it("saveFramework_dispatches_frameworkSaved_and_returns_it", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(createFramework).mockResolvedValue(mine);
    vi.mocked(updateFramework).mockResolvedValue({ ...rtf, name: "Edited" });
    renderProbe();
    await screen.findByText("ids: rtf");

    await click("create framework");
    expect(await screen.findByText("ids: rtf,c-1")).toBeInTheDocument();
    expect(createFramework).toHaveBeenCalledExactlyOnceWith(input);
    expect(screen.getByText("framework result: c-1")).toBeInTheDocument();
    expect(screen.getByText("selected: rtf")).toBeInTheDocument();
    expect(listFrameworks).toHaveBeenCalledTimes(1);

    await click("edit framework");
    expect(
      await screen.findByText("framework result: rtf"),
    ).toBeInTheDocument();
    expect(updateFramework).toHaveBeenCalledExactlyOnceWith("rtf", input);
  });

  it("saveFramework_toasts_the_error_message_and_returns_null", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(createFramework).mockRejectedValue(
      new ApiError("invalid", "Name is taken"),
    );
    vi.mocked(updateFramework).mockRejectedValue(
      new ApiError("notFound", "framework rtf not found"),
    );
    renderProbe();
    await screen.findByText("ids: rtf");

    await click("create framework");
    expect(
      await screen.findByText("framework result: null"),
    ).toBeInTheDocument();
    expect(toasts()).toEqual(["error: Name is taken"]);

    await click("edit framework");
    await waitFor(() =>
      expect(toasts()).toContain("error: That framework no longer exists."),
    );
    expect(screen.getByText("ids: rtf")).toBeInTheDocument();
  });

  it("deleteFramework_dispatches_frameworkDeleted_and_returns_true", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf, mine]);
    vi.mocked(deleteFramework).mockResolvedValue({ ...rtf, deletedAt: 9 });
    renderProbe();
    await screen.findByText("ids: rtf,c-1");

    await click("delete framework");

    expect(deleteFramework).toHaveBeenCalledExactlyOnceWith("rtf");
    expect(await screen.findByText("ids: rtf!,c-1")).toBeInTheDocument();
    expect(screen.getByText("selected: c-1")).toBeInTheDocument();
    expect(screen.getByText("result: true")).toBeInTheDocument();
  });

  it("deleteFramework_toasts_the_error_message_and_returns_false", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(deleteFramework).mockRejectedValue(
      new ApiError("database", "locked"),
    );
    renderProbe();
    await screen.findByText("ids: rtf");

    await click("delete framework");

    expect(await screen.findByText("result: false")).toBeInTheDocument();
    expect(toasts()).toEqual(["error: locked"]);
    expect(screen.getByText("ids: rtf")).toBeInTheDocument();
  });

  it("restoreFramework_dispatches_frameworkRestored_and_returns_it", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([{ ...rtf, deletedAt: 9 }]);
    vi.mocked(restoreFramework).mockResolvedValue(rtf);
    renderProbe();
    await screen.findByText("ids: rtf!");
    expect(screen.getByText("selected: none")).toBeInTheDocument();

    await click("restore framework");

    expect(restoreFramework).toHaveBeenCalledExactlyOnceWith("rtf");
    expect(await screen.findByText("ids: rtf")).toBeInTheDocument();
    expect(screen.getByText("framework result: rtf")).toBeInTheDocument();
    expect(screen.getByText("selected: rtf")).toBeInTheDocument();
  });

  it("restoreFramework_toasts_the_error_message_and_returns_null", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([{ ...rtf, deletedAt: 9 }]);
    vi.mocked(restoreFramework).mockRejectedValue(
      new ApiError("database", "locked"),
    );
    renderProbe();
    await screen.findByText("ids: rtf!");

    await click("restore framework");

    expect(
      await screen.findByText("framework result: null"),
    ).toBeInTheDocument();
    expect(toasts()).toEqual(["error: locked"]);
  });

  it("a_saved_framework_does_not_remount_the_builder_form", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(createFramework).mockResolvedValue(mine);
    function Form() {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const { saveFramework } = useAppActions();
      if (state.frameworks.status !== "ready") return null;
      return (
        <>
          <p>count: {state.frameworks.items.length}</p>
          <input
            aria-label="role"
            value={currentDraft(state).role ?? ""}
            onChange={(e) =>
              dispatch({
                type: "editSection",
                key: "role",
                value: e.target.value,
              })
            }
          />
          <button onClick={() => void saveFramework(null, input)}>other</button>
        </>
      );
    }
    render(
      <AppStateProvider>
        <Form />
      </AppStateProvider>,
    );
    const user = userEvent.setup();
    const field = await screen.findByRole("textbox", { name: "role" });
    await user.type(field, "hello");

    // A programmatic click leaves the focus on the field, as a save started
    // from elsewhere in the window would.
    await act(async () => {
      screen.getByRole("button", { name: "other" }).click();
    });
    // The new framework is in the list, so the save has been processed.
    expect(await screen.findByText("count: 2")).toBeInTheDocument();

    const after = screen.getByRole("textbox", { name: "role" });
    expect(after).toBe(field);
    expect(after).toHaveFocus();
    expect(after).toHaveValue("hello");
  });
});
