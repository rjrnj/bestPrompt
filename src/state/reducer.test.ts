import { describe, expect, it } from "vitest";
import builtins from "../../src-tauri/builtins/frameworks.json";
import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import {
  currentDraft,
  currentTitle,
  hasAnyDraftText,
  initialState,
  isBlank,
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
