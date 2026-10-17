import { describe, expect, it } from "vitest";
import builtins from "../../src-tauri/builtins/frameworks.json";
import type { Framework } from "../bindings/Framework";
import {
  currentDraft,
  initialState,
  isBlank,
  needsSave,
  reducer,
  renderedPrompt,
  selectedFramework,
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
