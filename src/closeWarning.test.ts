import { describe, expect, it } from "vitest";
import type { Framework } from "./bindings/Framework";
import { closeWarning } from "./closeWarning";
import { initialState, type Session, type State } from "./state/reducer";

function framework(id: string, template = "{{a}}"): Framework {
  return {
    id,
    name: id,
    description: "",
    template,
    summaryKey: null,
    isCustom: false,
    deletedAt: null,
    sections: [{ key: "a", label: "a", helpText: "" }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function session(state: Session["state"]): Session {
  return { id: "s", folder: "/f", state, code: null, sent: null, note: false };
}

const ready = (...items: Framework[]): State["frameworks"] => ({
  status: "ready",
  items,
});
const none = new Set<string>();

function make(changes: Partial<State>): State {
  return { ...initialState, frameworks: ready(framework("f")), ...changes };
}

describe("closeWarning", () => {
  it("is null when there is nothing to lose", () => {
    expect(closeWarning(make({}), none)).toBeNull();
  });

  it("counts a running session", () => {
    expect(
      closeWarning(make({ sessions: { p: session("running") } }), none),
    ).toEqual({ sessions: 1, drafts: false, frameworkEdits: null });
  });

  it("counts a start under way with no session", () => {
    expect(closeWarning(make({}), new Set(["p"]))).toEqual({
      sessions: 1,
      drafts: false,
      frameworkEdits: null,
    });
  });

  it("counts an unsaved draft", () => {
    expect(closeWarning(make({ drafts: { f: { a: "hi" } } }), none)).toEqual({
      sessions: 0,
      drafts: true,
      frameworkEdits: null,
    });
  });

  it("names the framework with unsaved edits", () => {
    const editingFramework = { dirty: true, name: "Mine", busy: false };
    expect(closeWarning(make({ editingFramework }), none)).toEqual({
      sessions: 0,
      drafts: false,
      frameworkEdits: { name: "Mine" },
    });
  });

  it("ignores an editor with no changes", () => {
    const editingFramework = { dirty: false, name: "Mine", busy: false };
    expect(closeWarning(make({ editingFramework }), none)).toBeNull();
  });

  it("reports all three together", () => {
    const state = make({
      sessions: { p: session("running") },
      drafts: { f: { a: "hi" } },
      editingFramework: { dirty: true, name: "Mine", busy: false },
    });
    expect(closeWarning(state, none)).toEqual({
      sessions: 1,
      drafts: true,
      frameworkEdits: { name: "Mine" },
    });
  });

  it("does not count an exited session", () => {
    expect(
      closeWarning(make({ sessions: { p: session("exited") } }), none),
    ).toBeNull();
  });

  it("counts a restart once", () => {
    const state = make({ sessions: { p: session("running") } });
    expect(closeWarning(state, new Set(["p"]))?.sessions).toBe(1);
  });

  it("counts each project's session", () => {
    const state = make({
      sessions: { p: session("running"), q: session("running") },
    });
    expect(closeWarning(state, none)?.sessions).toBe(2);
  });

  it("does not count a draft that is saved", () => {
    const state = make({
      drafts: { f: { a: "hi" } },
      lastSaved: { f: "hi" },
    });
    expect(closeWarning(state, none)).toBeNull();
  });

  it("counts a draft changed since it was saved", () => {
    const state = make({
      drafts: { f: { a: "hi!" } },
      lastSaved: { f: "hi" },
    });
    expect(closeWarning(state, none)?.drafts).toBe(true);
  });

  it.each([
    ["empty", {}],
    ["blank", { a: "" }],
    ["whitespace-only", { a: "  \n\t" }],
  ])("does not count an %s draft, even with static text", (_, draft) => {
    const state = make({
      frameworks: ready(framework("f", "Intro {{a}}")),
      drafts: { f: draft },
    });
    expect(closeWarning(state, none)).toBeNull();
  });

  it("does not count a draft for a framework no longer listed", () => {
    expect(
      closeWarning(make({ drafts: { gone: { a: "hi" } } }), none),
    ).toBeNull();
  });

  it("does not count drafts while the frameworks load", () => {
    const state = make({
      frameworks: { status: "loading" },
      drafts: { f: { a: "hi" } },
    });
    expect(closeWarning(state, none)).toBeNull();
  });
});
