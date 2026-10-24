import { describe, expect, it } from "vitest";
import builtins from "../../src-tauri/builtins/frameworks.json";
import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import {
  currentDraft,
  currentTitle,
  draftTextIn,
  hasAnyDraftText,
  initialState,
  isBlank,
  listedProjects,
  liveFrameworks,
  needsSave,
  openConflicts,
  reducer,
  renderedPrompt,
  selectedFramework,
  unplacedSections,
  type Action,
  type State,
} from "./reducer";

/** A framework whose template is each key's value, one per line. */
function framework(id: string, keys: string[]): Framework {
  return {
    id,
    name: id.toUpperCase(),
    description: "",
    template: keys.map((key) => `{{${key}}}`).join("\n"),
    summaryKey: null,
    isCustom: false,
    deletedAt: null,
    sections: keys.map((key) => ({ key, label: key, helpText: "" })),
    createdAt: 1,
    updatedAt: 1,
  };
}

const ab = framework("ab", ["a", "b"]);
const xy = framework("xy", ["x", "y"]);
// Only the fields a Framework has: the JSON also carries a `source` note.
const rtfJson = builtins.find((f) => f.id === "rtf")!;
const rtf: Framework = {
  id: rtfJson.id,
  name: rtfJson.name,
  description: rtfJson.description,
  template: rtfJson.template,
  summaryKey: rtfJson.summaryKey,
  sections: rtfJson.sections,
  isCustom: false,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

function run(actions: Action[], from: State = initialState): State {
  return actions.reduce(reducer, from);
}

const loaded = run([{ type: "frameworksLoaded", frameworks: [ab, xy] }]);

describe("loading frameworks", () => {
  it("starts loading with nothing selected", () => {
    expect(initialState.frameworks).toEqual({ status: "loading" });
    expect(initialState.selectedId).toBeNull();
    expect(initialState.drafts).toEqual({});
  });

  it("selects the first framework once loaded", () => {
    expect(loaded.frameworks).toEqual({ status: "ready", items: [ab, xy] });
    expect(loaded.selectedId).toBe("ab");
    expect(selectedFramework(loaded)).toBe(ab);
  });

  it("selects nothing when no frameworks were loaded", () => {
    const state = run([{ type: "frameworksLoaded", frameworks: [] }]);

    expect(state.selectedId).toBeNull();
    expect(selectedFramework(state)).toBeNull();
  });

  it("keeps the current selection when the frameworks are reloaded", () => {
    const state = run(
      [
        { type: "selectFramework", id: "xy" },
        { type: "frameworksLoaded", frameworks: [ab, xy] },
      ],
      loaded,
    );

    expect(state.selectedId).toBe("xy");
  });

  it("records the message when loading fails", () => {
    const state = run([{ type: "frameworksFailed", message: "no db" }]);

    expect(state.frameworks).toEqual({ status: "error", message: "no db" });
    expect(selectedFramework(state)).toBeNull();
  });

  it("goes back to loading on a retry", () => {
    const state = run([
      { type: "frameworksFailed", message: "no db" },
      { type: "frameworksLoading" },
    ]);

    expect(state.frameworks).toEqual({ status: "loading" });
  });
});

describe("selecting a framework", () => {
  it("switches to a loaded framework by id", () => {
    const state = run([{ type: "selectFramework", id: "xy" }], loaded);

    expect(selectedFramework(state)).toBe(xy);
  });

  it("ignores an id that is not loaded", () => {
    const state = run([{ type: "selectFramework", id: "nope" }], loaded);

    expect(state.selectedId).toBe("ab");
  });
});

describe("editing a draft", () => {
  it("stores the text under the selected framework and section key", () => {
    const state = run([{ type: "editSection", key: "a", value: "hi" }], loaded);

    expect(state.drafts).toEqual({ ab: { a: "hi" } });
  });

  it("keeps a framework's draft while another framework is selected", () => {
    const state = run(
      [
        { type: "editSection", key: "a", value: "hi" },
        { type: "selectFramework", id: "xy" },
        { type: "editSection", key: "x", value: "yo" },
        { type: "selectFramework", id: "ab" },
      ],
      loaded,
    );

    expect(state.drafts).toEqual({ ab: { a: "hi" }, xy: { x: "yo" } });
    expect(currentDraft(state)).toEqual({ a: "hi", b: "" });
  });

  it("clears only the selected framework's draft", () => {
    const state = run(
      [
        { type: "editSection", key: "a", value: "hi" },
        { type: "selectFramework", id: "xy" },
        { type: "editSection", key: "x", value: "yo" },
        { type: "clearDraft" },
      ],
      loaded,
    );

    expect(state.drafts).toEqual({ ab: { a: "hi" }, xy: {} });
  });

  it("ignores a key that is not a section of the selected framework", () => {
    const state = run([{ type: "editSection", key: "x", value: "hi" }], loaded);

    expect(state.drafts).toEqual({});
  });

  it("reads a section whose key is an Object.prototype name", () => {
    const proto = framework("proto", ["constructor"]);
    const state = run([{ type: "frameworksLoaded", frameworks: [proto] }]);

    expect(currentDraft(state)).toEqual({ constructor: "" });
    expect(isBlank(state)).toBe(true);
  });

  it("does nothing when no framework is selected", () => {
    const state = run([
      { type: "editSection", key: "a", value: "hi" },
      { type: "clearDraft" },
    ]);

    expect(state.drafts).toEqual({});
  });

  it("reads every section of the selected framework, empty when unset", () => {
    expect(currentDraft(loaded)).toEqual({ a: "", b: "" });
    expect(currentDraft(initialState)).toEqual({});
  });
});

describe("the rendered prompt", () => {
  const filled = run([
    { type: "frameworksLoaded", frameworks: [rtf] },
    { type: "editSection", key: "role", value: "a reviewer" },
    { type: "editSection", key: "task", value: "read this" },
  ]);

  it("renders the selected framework's template with the draft", () => {
    expect(renderedPrompt(filled)).toBe(
      "# Role\na reviewer\n\n# Task\nread this",
    );
    expect(isBlank(filled)).toBe(false);
  });

  it("is empty when the template does not parse", () => {
    const broken = { ...ab, template: "{{#a}} never closed" };
    const state = run([
      { type: "frameworksLoaded", frameworks: [broken] },
      { type: "editSection", key: "a", value: "hi" },
    ]);

    expect(renderedPrompt(state)).toBe("");
    expect(needsSave(state)).toBe(false);
  });

  it("is empty without a selected framework", () => {
    expect(renderedPrompt(initialState)).toBe("");
  });

  it("is blank until a section has visible text", () => {
    const spaces = run(
      [{ type: "editSection", key: "a", value: " \n" }],
      loaded,
    );
    const text = run([{ type: "editSection", key: "a", value: "x" }], loaded);

    expect(isBlank(loaded)).toBe(true);
    expect(isBlank(spaces)).toBe(true);
    expect(isBlank(text)).toBe(false);
  });
});

describe("saving", () => {
  const edited = run([{ type: "editSection", key: "a", value: "hi" }], loaded);
  const savedHi: Action = {
    type: "saveSucceeded",
    frameworkId: "ab",
    renderedPrompt: "hi",
  };

  it("is in progress between saveStarted and saveSucceeded", () => {
    const started = run([{ type: "saveStarted" }], edited);
    expect(started.saving).toBe(true);

    const done = run([savedHi], started);
    expect(done.saving).toBe(false);
  });

  it("ends when a save fails, keeping the draft", () => {
    const state = run(
      [{ type: "saveStarted" }, { type: "saveFailed", message: "disk full" }],
      edited,
    );

    expect(state.saving).toBe(false);
    expect(state.drafts).toEqual({ ab: { a: "hi" } });
  });

  it("needs saving after an edit and not after that prompt is saved", () => {
    expect(needsSave(edited)).toBe(true);

    const saved = run([savedHi], edited);
    expect(needsSave(saved)).toBe(false);
    expect(saved.lastSaved).toEqual({ ab: "hi" });
  });

  it("needs saving again after a change, and not after reverting it", () => {
    const saved = run([savedHi], edited);
    const changed = run(
      [{ type: "editSection", key: "a", value: "hi!" }],
      saved,
    );
    const reverted = run(
      [{ type: "editSection", key: "a", value: "hi" }],
      changed,
    );

    expect(needsSave(changed)).toBe(true);
    expect(needsSave(reverted)).toBe(false);
  });

  it("tracks the last saved prompt per framework", () => {
    const state = run(
      [
        savedHi,
        { type: "selectFramework", id: "xy" },
        { type: "editSection", key: "x", value: "hi" },
      ],
      edited,
    );

    expect(needsSave(state)).toBe(true);
  });

  it("records a save that finished after switching frameworks", () => {
    const state = run(
      [
        { type: "selectFramework", id: "xy" },
        { type: "editSection", key: "x", value: "yo" },
        savedHi,
      ],
      edited,
    );

    expect(needsSave(state)).toBe(true);
    expect(needsSave(run([{ type: "selectFramework", id: "ab" }], state))).toBe(
      false,
    );
  });

  it("does not need saving while blank", () => {
    expect(needsSave(loaded)).toBe(false);
  });

  it("needs saving again once the saved entry is deleted", () => {
    const saved = run([savedHi], edited);
    const state = run(
      [{ type: "entryDeleted", frameworkId: "ab", renderedPrompt: "hi" }],
      saved,
    );

    expect(needsSave(state)).toBe(true);
    expect(state.lastSaved).toEqual({});
  });

  it("keeps the saved record when a different entry is deleted", () => {
    const saved = run([savedHi], edited);
    const state = run(
      [
        { type: "entryDeleted", frameworkId: "ab", renderedPrompt: "older" },
        { type: "entryDeleted", frameworkId: "xy", renderedPrompt: "hi" },
        { type: "entryDeleted", frameworkId: null, renderedPrompt: "hi" },
      ],
      saved,
    );

    expect(state.lastSaved).toEqual({ ab: "hi" });
    expect(needsSave(state)).toBe(false);
  });
});

describe("toasts", () => {
  it("adds toasts with increasing ids and removes them by id", () => {
    const two = run([
      { type: "toastAdded", kind: "info", message: "Copied" },
      { type: "toastAdded", kind: "error", message: "Nope" },
    ]);
    expect(two.toasts).toEqual([
      { id: 1, kind: "info", message: "Copied" },
      { id: 2, kind: "error", message: "Nope" },
    ]);

    const one = run([{ type: "toastDismissed", id: 1 }], two);
    expect(one.toasts).toEqual([{ id: 2, kind: "error", message: "Nope" }]);

    const three = run(
      [{ type: "toastAdded", kind: "info", message: "Saved" }],
      one,
    );
    expect(three.toasts.map((t) => t.id)).toEqual([2, 3]);
  });

  it("keeps only the three newest toasts", () => {
    const state = run(
      ["one", "two", "three", "four"].map((message) => ({
        type: "toastAdded" as const,
        kind: "info" as const,
        message,
      })),
    );

    expect(state.toasts.map((t) => t.message)).toEqual([
      "two",
      "three",
      "four",
    ]);
  });

  it("replaces a toast with the same message by a new one at the end", () => {
    const state = run([
      { type: "toastAdded", kind: "info", message: "Copied" },
      { type: "toastAdded", kind: "error", message: "Nope" },
      { type: "toastAdded", kind: "info", message: "Copied" },
    ]);

    expect(state.toasts).toEqual([
      { id: 2, kind: "error", message: "Nope" },
      { id: 3, kind: "info", message: "Copied" },
    ]);
  });
});

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

const api = project("p-api", "api");
const web = project("p-web", "Web");

function entry(
  frameworkId: string | null,
  values: Record<string, string>,
  extra: Partial<PromptEntry> = {},
): PromptEntry {
  const source = frameworkId === "xy" ? xy : ab;
  return {
    id: "e1",
    frameworkId,
    frameworkSnapshot: {
      name: source.name,
      template: source.template,
      summaryKey: null,
      sections: source.sections,
    },
    sectionValues: values,
    renderedPrompt: Object.values(values).join("\n"),
    title: null,
    projectId: null,
    createdAt: 1,
    version: 0,
    ...extra,
  };
}

const withProjects = run(
  [{ type: "projectsLoaded", projects: [api, web] }],
  loaded,
);

describe("titles", () => {
  it("starts on the builder with no projects, titles or selected project", () => {
    expect(initialState.view).toBe("builder");
    expect(initialState.projects).toEqual({ status: "loading" });
    expect(initialState.selectedProjectId).toBeNull();
    expect(initialState.titles).toEqual({});
  });

  it("keeps a title per framework", () => {
    const state = run(
      [
        { type: "editTitle", value: "First" },
        { type: "selectFramework", id: "xy" },
        { type: "editTitle", value: "Second" },
      ],
      loaded,
    );

    expect(currentTitle(state)).toBe("Second");
    expect(
      currentTitle(reducer(state, { type: "selectFramework", id: "ab" })),
    ).toBe("First");
  });

  it("is empty, and cannot be edited, when no framework is selected", () => {
    expect(currentTitle(initialState)).toBe("");
    expect(reducer(initialState, { type: "editTitle", value: "x" })).toBe(
      initialState,
    );
  });

  it("is emptied by clearing the draft, which keeps the project", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-api" },
        { type: "editTitle", value: "T" },
        { type: "editSection", key: "a", value: "text" },
        { type: "clearDraft" },
      ],
      withProjects,
    );

    expect(currentTitle(state)).toBe("");
    expect(currentDraft(state)).toEqual({ a: "", b: "" });
    expect(state.selectedProjectId).toBe("p-api");
  });
});

describe("projects", () => {
  it("loads, and records a failure", () => {
    expect(withProjects.projects).toEqual({
      status: "ready",
      items: [api, web],
    });
    expect(
      reducer(initialState, { type: "projectsFailed", message: "no" }).projects,
    ).toEqual({ status: "error", message: "no" });
  });

  it("selects a project or none", () => {
    const state = reducer(withProjects, {
      type: "projectSelected",
      id: "p-web",
    });

    expect(state.selectedProjectId).toBe("p-web");
    expect(
      reducer(state, { type: "projectSelected", id: null }).selectedProjectId,
    ).toBeNull();
  });

  it("adds a created project in name order and selects it", () => {
    const mid = project("p-m", "Mid");
    const state = reducer(withProjects, {
      type: "projectCreated",
      project: mid,
    });

    expect(state.projects).toEqual({
      status: "ready",
      items: [api, mid, web],
    });
    expect(state.selectedProjectId).toBe("p-m");
  });

  it("replaces a renamed project and keeps the list sorted", () => {
    const renamed = { ...api, name: "zzz" };
    const state = reducer(withProjects, {
      type: "projectRenamed",
      project: renamed,
    });

    expect(state.projects).toEqual({ status: "ready", items: [web, renamed] });
  });

  it("clears the selection when the selected project is deleted", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-api" },
        { type: "projectDeleted", id: "p-api" },
      ],
      withProjects,
    );

    expect(state.projects).toEqual({ status: "ready", items: [web] });
    expect(state.selectedProjectId).toBeNull();
  });

  it("keeps the selection when another project is deleted", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-web" },
        { type: "projectDeleted", id: "p-api" },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBe("p-web");
  });

  it("leaves a project list that has not loaded alone on rename and delete", () => {
    const renamed = reducer(initialState, {
      type: "projectRenamed",
      project: api,
    });
    const deleted = reducer(initialState, {
      type: "projectDeleted",
      id: "p-api",
    });

    expect(renamed.projects).toEqual({ status: "loading" });
    expect(deleted.projects).toEqual({ status: "loading" });
  });

  it("still clears a matching selection when delete arrives before the list loads", () => {
    const state = run([
      { type: "projectSelected", id: "p-api" },
      { type: "projectDeleted", id: "p-api" },
    ]);

    expect(state.projects).toEqual({ status: "loading" });
    expect(state.selectedProjectId).toBeNull();
  });

  it("selects a created project without touching a list that has not loaded", () => {
    const state = reducer(initialState, {
      type: "projectCreated",
      project: api,
    });

    expect(state.projects).toEqual({ status: "loading" });
    expect(state.selectedProjectId).toBe("p-api");
  });

  it("drops a selection that no longer exists when projects are reloaded", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-api" },
        { type: "projectsLoaded", projects: [web] },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBeNull();
  });

  it("keeps a project created while the list loads, and its selection", () => {
    const mid = project("p-m", "Mid");
    const state = run([
      { type: "projectCreated", project: mid },
      { type: "projectsLoaded", projects: [api, web] },
    ]);

    expect(state.projects).toEqual({ status: "ready", items: [api, mid, web] });
    expect(state.selectedProjectId).toBe("p-m");
  });

  it("lists a project created while loading once when the list already has it", () => {
    const state = run([
      { type: "projectCreated", project: api },
      { type: "projectsLoaded", projects: [api, web] },
    ]);

    expect(state.projects).toEqual({ status: "ready", items: [api, web] });
  });

  it("renames or deletes a project created while the list loads", () => {
    const mid = project("p-m", "Mid");
    const renamed = run([
      { type: "projectCreated", project: mid },
      { type: "projectRenamed", project: { ...mid, name: "zzz" } },
      { type: "projectsLoaded", projects: [api, web] },
    ]);
    const deleted = run([
      { type: "projectCreated", project: mid },
      { type: "projectDeleted", id: "p-m" },
      { type: "projectsLoaded", projects: [api, web] },
    ]);

    expect(renamed.projects).toEqual({
      status: "ready",
      items: [api, web, { ...mid, name: "zzz" }],
    });
    expect(renamed.createdProjects).toEqual([]);
    expect(deleted.projects).toEqual({ status: "ready", items: [api, web] });
    expect(deleted.selectedProjectId).toBeNull();
  });

  it("leaves out a project deleted while the list loads when the list has it", () => {
    const mid = project("p-m", "Mid");
    const state = run([
      { type: "projectCreated", project: mid },
      { type: "projectDeleted", id: "p-m" },
      // The list was read after the create and before the delete.
      { type: "projectsLoaded", projects: [api, mid, web] },
    ]);

    expect(state.projects).toEqual({ status: "ready", items: [api, web] });
    expect(state.selectedProjectId).toBeNull();
  });

  it("lists the projects created before the list loads, in name order", () => {
    const state = run([
      { type: "projectCreated", project: web },
      { type: "projectCreated", project: api },
    ]);

    expect(listedProjects(state)).toEqual([api, web]);
    expect(listedProjects(withProjects)).toEqual([api, web]);
  });

  it("keeps created projects and their selection when the list fails", () => {
    const state = run([
      { type: "projectCreated", project: api },
      { type: "projectsFailed", message: "no db" },
    ]);

    expect(listedProjects(state)).toEqual([api]);
    expect(state.selectedProjectId).toBe("p-api");
  });

  it("lists a project created after the list failed", () => {
    const state = run([
      { type: "projectsFailed", message: "no db" },
      { type: "projectCreated", project: api },
    ]);

    expect(listedProjects(state)).toEqual([api]);
    expect(state.selectedProjectId).toBe("p-api");
  });

  it("drops a selection the failed list can't confirm", () => {
    const state = run(
      [
        {
          type: "entryOpened",
          entry: entry("ab", { a: "one" }, { projectId: "p-api" }),
        },
        { type: "projectsFailed", message: "no db" },
      ],
      loaded,
    );

    expect(state.selectedProjectId).toBeNull();
  });

  it("keeps a selection that is still there when projects are reloaded", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-web" },
        { type: "projectsLoaded", projects: [web] },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBe("p-web");
  });
});

describe("the starting project", () => {
  it("is selected when the user has not chosen one", () => {
    const state = reducer(withProjects, {
      type: "startingProjectFound",
      id: "p-web",
    });

    expect(state.selectedProjectId).toBe("p-web");
  });

  it("is ignored when it is not in the list", () => {
    const state = reducer(withProjects, {
      type: "startingProjectFound",
      id: "gone",
    });

    expect(state.selectedProjectId).toBeNull();
  });

  it("does not replace a project the user picked, even none", () => {
    const picked = run(
      [
        { type: "projectSelected", id: "p-api" },
        { type: "startingProjectFound", id: "p-web" },
      ],
      withProjects,
    );
    const none = run(
      [
        { type: "projectSelected", id: null },
        { type: "startingProjectFound", id: "p-web" },
      ],
      withProjects,
    );

    expect(picked.selectedProjectId).toBe("p-api");
    expect(none.selectedProjectId).toBeNull();
  });

  it("does not replace no project once the user opened the list", () => {
    const state = run(
      [
        { type: "projectListOpened" },
        { type: "startingProjectFound", id: "p-web" },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBeNull();
  });

  it("does not replace a project the user created", () => {
    const state = run(
      [
        { type: "projectCreated", project: project("p-m", "Mid") },
        { type: "startingProjectFound", id: "p-web" },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBe("p-m");
  });

  it("does not replace the project of an opened entry", () => {
    const state = run(
      [
        {
          type: "entryOpened",
          entry: entry("ab", { a: "one" }, { projectId: "p-api" }),
        },
        { type: "startingProjectFound", id: "p-web" },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBe("p-api");
  });
});

describe("opening an entry while the projects load", () => {
  const opened = reducer(loaded, {
    type: "entryOpened",
    entry: entry("ab", { a: "one" }, { projectId: "p-api" }),
  });

  it("keeps the entry's project once the list has it", () => {
    const state = reducer(opened, {
      type: "projectsLoaded",
      projects: [api, web],
    });

    expect(state.selectedProjectId).toBe("p-api");
  });

  it("drops the entry's project when the list does not have it", () => {
    const state = reducer(opened, { type: "projectsLoaded", projects: [web] });

    expect(state.selectedProjectId).toBeNull();
  });
});

describe("changing the view", () => {
  it("switches between builder and history", () => {
    const state = reducer(loaded, { type: "viewChanged", view: "history" });

    expect(state.view).toBe("history");
  });
});

describe("opening a saved entry", () => {
  it("loads values, title and project and switches to the builder", () => {
    const from = run(
      [
        { type: "viewChanged", view: "history" },
        { type: "selectFramework", id: "xy" },
      ],
      withProjects,
    );
    const state = reducer(from, {
      type: "entryOpened",
      entry: entry(
        "ab",
        { a: "one", b: "two" },
        { title: "Hi", projectId: "p-web" },
      ),
    });

    expect(state.view).toBe("builder");
    expect(state.selectedId).toBe("ab");
    expect(currentDraft(state)).toEqual({ a: "one", b: "two" });
    expect(currentTitle(state)).toBe("Hi");
    expect(state.selectedProjectId).toBe("p-web");
  });

  it("uses an empty title when the entry has none", () => {
    const state = run(
      [
        { type: "editTitle", value: "old" },
        { type: "entryOpened", entry: entry("ab", { a: "one" }) },
      ],
      loaded,
    );

    expect(currentTitle(state)).toBe("");
  });

  it("loads only the sections the framework still has", () => {
    const state = reducer(loaded, {
      type: "entryOpened",
      entry: entry("ab", { a: "one", gone: "lost", constructor: "x" }),
    });

    expect(state.drafts.ab).toEqual({ a: "one" });
    expect(currentDraft(state)).toEqual({ a: "one", b: "" });
  });

  it("replaces the draft the framework already had", () => {
    const state = run(
      [
        { type: "editSection", key: "b", value: "mine" },
        { type: "entryOpened", entry: entry("ab", { a: "one" }) },
      ],
      loaded,
    );

    expect(currentDraft(state)).toEqual({ a: "one", b: "" });
  });

  it("selects no project when the entry's project was deleted", () => {
    const state = reducer(withProjects, {
      type: "entryOpened",
      entry: entry("ab", { a: "one" }, { projectId: "p-gone" }),
    });

    expect(state.selectedProjectId).toBeNull();
  });

  it("selects no project when the entry has none", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-api" },
        { type: "entryOpened", entry: entry("ab", { a: "one" }) },
      ],
      withProjects,
    );

    expect(state.selectedProjectId).toBeNull();
  });

  it("marks the prompt as already saved until it is edited", () => {
    const opened = reducer(loaded, {
      type: "entryOpened",
      entry: entry("ab", { a: "one", b: "two" }),
    });

    expect(needsSave(opened)).toBe(false);
    expect(
      needsSave(reducer(opened, { type: "editSection", key: "a", value: "x" })),
    ).toBe(true);
  });

  it("changes nothing for an unknown or deleted framework", () => {
    expect(
      reducer(loaded, {
        type: "entryOpened",
        entry: entry("nope", { a: "1" }),
      }),
    ).toBe(loaded);
    expect(
      reducer(loaded, { type: "entryOpened", entry: entry(null, { a: "1" }) }),
    ).toBe(loaded);
    expect(
      reducer(initialState, { type: "entryOpened", entry: entry("ab", {}) }),
    ).toBe(initialState);
  });
});

describe("hasAnyDraftText", () => {
  it("is false for blank drafts and titles", () => {
    expect(hasAnyDraftText(loaded)).toBe(false);
    expect(
      hasAnyDraftText(
        run(
          [
            { type: "editSection", key: "a", value: "  " },
            { type: "editTitle", value: "" },
          ],
          loaded,
        ),
      ),
    ).toBe(false);
  });

  it("sees text in any framework's section", () => {
    const state = run(
      [
        { type: "selectFramework", id: "xy" },
        { type: "editSection", key: "y", value: "t" },
        { type: "selectFramework", id: "ab" },
      ],
      loaded,
    );

    expect(hasAnyDraftText(state)).toBe(true);
  });

  it("sees a title on its own", () => {
    expect(
      hasAnyDraftText(reducer(loaded, { type: "editTitle", value: "T" })),
    ).toBe(true);
  });
});

describe("openConflicts", () => {
  const none = { replacesDraft: false, changesProject: false };

  it("reports neither for an empty builder", () => {
    expect(
      openConflicts(
        withProjects,
        entry("ab", { a: "x" }, { projectId: "p-web" }),
      ),
    ).toEqual(none);
  });

  it("reports a replaced draft for the same framework with text", () => {
    const state = reducer(withProjects, {
      type: "editSection",
      key: "a",
      value: "mine",
    });

    expect(openConflicts(state, entry("ab", { a: "x" }))).toEqual({
      replacesDraft: true,
      changesProject: false,
    });
  });

  it("reports a replaced draft for a title alone", () => {
    const state = reducer(withProjects, { type: "editTitle", value: "T" });

    expect(openConflicts(state, entry("ab", {})).replacesDraft).toBe(true);
  });

  it("reports a changed project when another framework has text", () => {
    const state = run(
      [
        { type: "selectFramework", id: "xy" },
        { type: "editSection", key: "x", value: "mine" },
        { type: "selectFramework", id: "ab" },
      ],
      withProjects,
    );

    expect(
      openConflicts(state, entry("ab", { a: "x" }, { projectId: "p-web" })),
    ).toEqual({ replacesDraft: false, changesProject: true });
  });

  it("reports no changed project when it is the same", () => {
    const state = run(
      [
        { type: "projectSelected", id: "p-web" },
        { type: "editSection", key: "b", value: "mine" },
      ],
      withProjects,
    );

    expect(
      openConflicts(state, entry("xy", { x: "x" }, { projectId: "p-web" })),
    ).toEqual(none);
  });

  it("reports a changed project for an entry opened while the projects load", () => {
    // The entry keeps its project until the list arrives, so the drafts
    // move to it.
    const state = run([{ type: "editSection", key: "a", value: "t" }], loaded);

    expect(
      openConflicts(state, entry("xy", {}, { projectId: "p-web" }))
        .changesProject,
    ).toBe(true);
    expect(
      openConflicts(
        reducer(state, {
          type: "entryOpened",
          entry: entry("xy", {}, { projectId: "p-web" }),
        }),
        entry("ab", {}, { projectId: "p-web" }),
      ).changesProject,
    ).toBe(false);
  });

  it("counts a project created after the projects failed to load", () => {
    const state = run(
      [
        { type: "projectsFailed", message: "no" },
        { type: "projectCreated", project: project("p-c", "C") },
        { type: "editSection", key: "a", value: "t" },
        { type: "projectSelected", id: null },
      ],
      loaded,
    );

    expect(
      openConflicts(state, entry("xy", {}, { projectId: "p-c" }))
        .changesProject,
    ).toBe(true);
  });

  it("treats a deleted project as no project", () => {
    const state = run(
      [{ type: "editSection", key: "a", value: "t" }],
      withProjects,
    );

    expect(
      openConflicts(state, entry("xy", {}, { projectId: "p-gone" }))
        .changesProject,
    ).toBe(false);
  });
});

describe("unplacedSections", () => {
  const snapshot = entry("ab", { a: "one", b: "two", c: "three", d: "  " });
  snapshot.frameworkSnapshot.sections = [
    { key: "a", label: "A", helpText: "" },
    { key: "b", label: "B", helpText: "" },
    { key: "c", label: "C label", helpText: "" },
    { key: "d", label: "D", helpText: "" },
    { key: "e", label: "E", helpText: "" },
  ];

  it("names only missing keys that have text", () => {
    expect(unplacedSections(snapshot, ab)).toEqual(["C label"]);
  });

  it("names every section with text when there is no framework", () => {
    expect(unplacedSections(snapshot, null)).toEqual(["A", "B", "C label"]);
  });
});

describe("framework changes", () => {
  const custom = (id: string, name: string, keys: string[]): Framework => ({
    ...framework(id, keys),
    name,
    isCustom: true,
  });
  const deleted = (f: Framework): Framework => ({ ...f, deletedAt: 5 });
  const names = (state: State) =>
    state.frameworks.status === "ready"
      ? state.frameworks.items.map((f) => f.id)
      : [];

  it("frameworkSaved_adds_a_new_framework_in_list_order", () => {
    const state = run([
      {
        type: "frameworksLoaded",
        frameworks: [ab, xy, custom("c1", "alpha", ["a"])],
      },
      { type: "frameworkSaved", framework: custom("c0", "Zeta", ["a"]) },
      { type: "frameworkSaved", framework: custom("c2", "ALPHA", ["a"]) },
    ]);

    expect(names(state)).toEqual(["ab", "xy", "c1", "c2", "c0"]);
  });

  it("frameworkSaved_replaces_in_place_without_changing_the_selection", () => {
    const start = run([
      { type: "frameworksLoaded", frameworks: [ab, xy] },
      { type: "selectFramework", id: "xy" },
    ]);
    const renamed = { ...ab, name: "Renamed" };

    const state = run([{ type: "frameworkSaved", framework: renamed }], start);

    expect(names(state)).toEqual(["ab", "xy"]);
    expect(state.selectedId).toBe("xy");
    expect(state.frameworks).toEqual({
      status: "ready",
      items: [renamed, xy],
    });
  });

  it("frameworkSaved_keeps_draft_text_of_kept_sections_and_drops_removed_ones", () => {
    const start = run([
      { type: "frameworksLoaded", frameworks: [ab, xy] },
      { type: "editSection", key: "a", value: "keep" },
      { type: "editSection", key: "b", value: "drop" },
      { type: "editTitle", value: "ab title" },
      { type: "saveSucceeded", frameworkId: "ab", renderedPrompt: "keep" },
      { type: "selectFramework", id: "xy" },
      { type: "editSection", key: "x", value: "other" },
      { type: "editTitle", value: "title" },
    ]);
    const edited = framework("ab", ["a", "c"]);

    const state = run([{ type: "frameworkSaved", framework: edited }], start);

    expect(state.drafts).toEqual({ ab: { a: "keep" }, xy: { x: "other" } });
    expect(state.titles).toEqual({ ab: "ab title", xy: "title" });
    expect(state.lastSaved).toEqual({ ab: "keep" });
  });

  it("frameworkSaved_keeps_the_selection_and_text_when_the_selected_framework_loses_sections", () => {
    const start = run(
      [
        { type: "editSection", key: "a", value: "keep" },
        { type: "editSection", key: "b", value: "drop" },
      ],
      loaded,
    );
    expect(start.selectedId).toBe("ab");
    const edited = framework("ab", ["a"]);

    const state = run([{ type: "frameworkSaved", framework: edited }], start);

    expect(state.selectedId).toBe("ab");
    expect(state.drafts).toEqual({ ab: { a: "keep" } });
    expect(currentDraft(state)).toEqual({ a: "keep" });
  });

  it("frameworkDeleted_selects_the_first_live_framework_when_it_was_selected", () => {
    const start = run([{ type: "frameworksLoaded", frameworks: [ab, xy] }]);

    const state = run(
      [{ type: "frameworkDeleted", framework: deleted(ab) }],
      start,
    );

    expect(state.selectedId).toBe("xy");
    expect(state.frameworks).toEqual({
      status: "ready",
      items: [deleted(ab), xy],
    });
  });

  it("frameworkDeleted_leaves_the_selection_when_another_was_deleted", () => {
    const state = run(
      [{ type: "frameworkDeleted", framework: deleted(xy) }],
      loaded,
    );

    expect(state.selectedId).toBe("ab");
  });

  it("frameworkDeleted_selects_nothing_when_no_live_framework_remains", () => {
    const state = run(
      [{ type: "frameworkDeleted", framework: deleted(ab) }],
      run([{ type: "frameworksLoaded", frameworks: [ab] }]),
    );

    expect(state.selectedId).toBeNull();
  });

  it("frameworkDeleted_drops_its_drafts_so_they_no_longer_count_as_draft_text", () => {
    const start = run(
      [
        { type: "editSection", key: "a", value: "text" },
        { type: "editTitle", value: "title" },
        { type: "saveSucceeded", frameworkId: "ab", renderedPrompt: "text" },
      ],
      loaded,
    );
    expect(hasAnyDraftText(start)).toBe(true);

    const state = run(
      [{ type: "frameworkDeleted", framework: deleted(ab) }],
      start,
    );

    expect(hasAnyDraftText(state)).toBe(false);
    expect(state.drafts).toEqual({});
    expect(state.titles).toEqual({});
    expect(state.lastSaved).toEqual({});
  });

  it("frameworkRestored_makes_it_selectable_again", () => {
    const start = run([
      { type: "frameworksLoaded", frameworks: [ab, xy] },
      { type: "frameworkDeleted", framework: deleted(xy) },
      { type: "selectFramework", id: "xy" },
    ]);
    expect(start.selectedId).toBe("ab");

    const state = run(
      [
        { type: "frameworkRestored", framework: xy },
        { type: "selectFramework", id: "xy" },
      ],
      start,
    );

    expect(state.selectedId).toBe("xy");
    expect(liveFrameworks(state)).toEqual([ab, xy]);
  });

  it("selectFramework_ignores_a_deleted_framework", () => {
    const start = run(
      [{ type: "frameworkDeleted", framework: deleted(xy) }],
      loaded,
    );

    const state = run([{ type: "selectFramework", id: "xy" }], start);

    expect(state.selectedId).toBe("ab");
  });

  it("frameworksLoaded_falls_back_to_a_live_framework", () => {
    const state = run([
      { type: "frameworksLoaded", frameworks: [deleted(ab), xy] },
    ]);

    expect(state.selectedId).toBe("xy");
  });

  it("liveFrameworks_leaves_out_deleted_ones", () => {
    const state = run([
      { type: "frameworksLoaded", frameworks: [ab, deleted(xy)] },
    ]);

    expect(liveFrameworks(state)).toEqual([ab]);
    expect(liveFrameworks(initialState)).toEqual([]);
  });

  it("draftTextIn_lists_only_keys_with_text", () => {
    const state = run(
      [
        { type: "editSection", key: "a", value: "text" },
        { type: "editSection", key: "b", value: "   " },
      ],
      loaded,
    );

    expect(draftTextIn(state, "ab", ["a", "b", "c"])).toEqual(["a"]);
    expect(draftTextIn(state, "xy", ["x"])).toEqual([]);
    expect(draftTextIn(state, "ab", ["constructor"])).toEqual([]);
  });

  it("editingChanged_stores_the_value", () => {
    const editing = { dirty: true, name: "Mine" };

    const state = run([{ type: "editingChanged", editing }]);

    expect(state.editingFramework).toEqual(editing);
    expect(initialState.editingFramework).toBeNull();
  });
});
