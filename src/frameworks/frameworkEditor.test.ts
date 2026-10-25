import { describe, expect, it } from "vitest";
import builtins from "../../src-tauri/builtins/frameworks.json";
import type { Framework } from "../bindings/Framework";
import { autoTemplate } from "./autoTemplate";
import {
  blankEditor,
  copyOf,
  editorFor,
  editorReducer,
  hasErrors,
  isDirty,
  markSaved,
  toInput,
  unusedRows,
  validate,
  type EditorAction,
  type EditorState,
} from "./frameworkEditor";

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

/** Types `label` into the last row of `base` and commits it. */
function withLabel(label: string, base = blankEditor()): EditorState {
  const row = base.sections[base.sections.length - 1].id;
  return run(
    base,
    { type: "labelChanged", row, value: label },
    { type: "labelCommitted", row },
  );
}

/** Adds a row to `state`, types `label` into it and commits it. */
function addSection(state: EditorState, label: string): EditorState {
  return withLabel(label, run(state, { type: "sectionAdded" }));
}

function custom(overrides: Partial<Framework> = {}): Framework {
  const sections = [
    { key: "a", label: "A", helpText: "" },
    { key: "b", label: "B", helpText: "" },
  ];
  return {
    id: "0190b0b0-0000-7000-8000-000000000000",
    name: "Mine",
    description: "",
    template: autoTemplate(sections),
    summaryKey: "a",
    isCustom: true,
    sections,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

function risen(): Framework {
  const b = builtins.find((f) => f.id === "risen")!;
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    template: b.template,
    summaryKey: b.summaryKey,
    isCustom: false,
    sections: b.sections,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

describe("blankEditor", () => {
  it("a_blank_editor_has_one_uncommitted_section", () => {
    const s = blankEditor();
    expect(s.name).toBe("");
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0].committed).toBe(false);
    expect(s.sourceId).toBeNull();
    expect(s.readOnly).toBe(false);
  });
});

describe("labels and keys", () => {
  it("committing_a_label_assigns_a_key_once", () => {
    const s = withLabel("Steps to reproduce");
    const row = s.sections[0];
    expect(row.committed).toBe(true);
    expect(row.key).toBe("steps_to_reproduce");
    const renamed = run(
      s,
      { type: "labelChanged", row: row.id, value: "Something else" },
      { type: "labelCommitted", row: row.id },
    );
    expect(renamed.sections[0].key).toBe("steps_to_reproduce");
    expect(renamed.sections[0].label).toBe("Something else");
  });

  it("committing_a_blank_label_assigns_nothing", () => {
    const s = run(
      blankEditor(),
      { type: "labelChanged", row: 0, value: "   " },
      { type: "labelCommitted", row: 0 },
    );
    expect(s.sections[0].committed).toBe(false);
    expect(s.sections[0].key).toBe("");
    expect(s.summaryKey).toBeNull();
  });

  it("gives_a_clashing_label_a_different_key", () => {
    const s = addSection(withLabel("Goal"), "goal");
    expect(s.sections.map((r) => r.key)).toEqual(["goal", "goal_2"]);
  });

  it("allows_a_removed_key_to_be_reused", () => {
    let s = addSection(withLabel("Goal"), "Other");
    s = run(s, { type: "sectionRemoved", row: s.sections[0].id });
    s = addSection(s, "Goal");
    expect(s.sections.map((r) => r.key)).toEqual(["other", "goal"]);
  });

  it("new_framework_summary_is_the_first_committed_section", () => {
    const s = addSection(withLabel("First"), "Second");
    expect(s.summaryKey).toBe("first");
  });
});

describe("automatic template", () => {
  it("automatic_template_follows_adds_renames_moves_and_removals", () => {
    let s = addSection(withLabel("One"), "Two");
    expect(s.template).toBe(autoTemplate(toInput(s).sections));
    const [one, two] = s.sections;

    s = run(s, { type: "labelChanged", row: one.id, value: "Uno" });
    expect(s.template).toContain("# Uno");

    s = run(s, { type: "sectionMoved", row: two.id, to: 0 });
    expect(s.template.indexOf("{{two}}")).toBeLessThan(
      s.template.indexOf("{{one}}"),
    );

    s = run(s, { type: "sectionRemoved", row: two.id });
    expect(s.template).toBe(autoTemplate(toInput(s).sections));
    expect(s.template).not.toContain("two");
    expect(s.automatic).toBe(true);
    expect(s.notes).toEqual([]);
  });

  it("leaves_uncommitted_rows_out_of_the_template", () => {
    const s = run(withLabel("One"), { type: "sectionAdded" });
    expect(s.template).toBe(autoTemplate([toInput(s).sections[0]]));
  });

  it("switching_to_automatic_replaces_the_template", () => {
    let s = addSection(withLabel("One"), "Two");
    s = run(
      s,
      { type: "modeChanged", automatic: false },
      { type: "templateEdited", value: "hand written {{one}}" },
    );
    s = addSection(s, "Three");
    expect(s.notes).toHaveLength(1);
    s = run(s, { type: "modeChanged", automatic: true });
    expect(s.template).toBe(autoTemplate(toInput(s).sections));
    expect(s.automatic).toBe(true);
    expect(s.notes).toEqual([]);
    expect(s.spots).toEqual([]);
  });

  it("editing_the_template_back_to_the_generated_one_stays_by_hand", () => {
    let s = run(withLabel("One"), { type: "modeChanged", automatic: false });
    expect(s.automatic).toBe(false);
    s = run(s, { type: "templateEdited", value: "changed" });
    expect(s.automatic).toBe(false);
    s = run(s, {
      type: "templateEdited",
      value: autoTemplate(toInput(s).sections),
    });
    expect(s.automatic).toBe(false);
    // Saving works the mode out afresh.
    expect(markSaved(s, custom({ ...toInput(s) })).automatic).toBe(true);
  });
});

describe("by hand", () => {
  function byHand(): EditorState {
    return run(addSection(withLabel("One"), "Two"), {
      type: "modeChanged",
      automatic: false,
    });
  }

  it("by_hand_commit_appends_the_block_and_a_note_naming_the_label", () => {
    const before = byHand();
    const s = addSection(before, "  Examples ");
    expect(s.template).toBe(
      `${before.template}\n\n{{#examples}}# Examples\n{{examples}}{{/examples}}`,
    );
    expect(s.notes).toEqual([
      "Examples was added to the end of the template. Move or reword it as you like.",
    ]);
    expect(s.automatic).toBe(false);
  });

  it("renaming_a_section_by_hand_leaves_the_template_alone", () => {
    const s = byHand();
    const renamed = run(s, {
      type: "labelChanged",
      row: s.sections[0].id,
      value: "Renamed",
    });
    expect(renamed.template).toBe(s.template);
  });

  it("by_hand_removal_returns_spots_for_placeholders_in_hand_written_text", () => {
    let s = byHand();
    s = run(s, {
      type: "templateEdited",
      value: "Use {{one}} carefully.\n\n{{#two}}# Two\n{{two}}{{/two}}",
    });
    s = run(s, { type: "sectionRemoved", row: s.sections[0].id });
    expect(s.template).toBe(
      "Use  carefully.\n\n{{#two}}# Two\n{{two}}{{/two}}",
    );
    expect(s.spots).toEqual([4]);
  });

  it("clears_spots_when_the_template_is_edited", () => {
    let s = byHand();
    s = run(s, { type: "templateEdited", value: "{{one}} {{two}}" });
    s = run(s, { type: "sectionRemoved", row: s.sections[0].id });
    expect(s.spots).toHaveLength(1);
    s = run(s, { type: "templateEdited", value: "x" });
    expect(s.spots).toEqual([]);
  });

  it("appends_a_section_block_on_request", () => {
    let s = byHand();
    s = run(s, { type: "templateEdited", value: "{{one}}" });
    s = run(s, { type: "sectionAppendedToTemplate", row: s.sections[1].id });
    expect(s.template).toBe("{{one}}\n\n{{#two}}# Two\n{{two}}{{/two}}");
  });

  it("unusedRows_counts_a_block_only_section_as_unused", () => {
    let s = byHand();
    s = run(s, {
      type: "templateEdited",
      value: "{{one}}\n\n{{#two}}no placeholder{{/two}}",
    });
    expect(unusedRows(s)).toEqual([s.sections[1].id]);
    expect(
      unusedRows(run(s, { type: "modeChanged", automatic: true })),
    ).toEqual([]);
  });
});

describe("summary", () => {
  it("removing_the_summary_section_moves_it_to_the_first_remaining", () => {
    let s = addSection(addSection(withLabel("One"), "Two"), "Three");
    expect(s.summaryKey).toBe("one");
    s = run(s, { type: "sectionRemoved", row: s.sections[0].id });
    expect(s.summaryKey).toBe("two");
    s = run(s, { type: "sectionRemoved", row: s.sections[0].id });
    s = run(s, { type: "sectionRemoved", row: s.sections[0].id });
    expect(s.summaryKey).toBeNull();
  });

  it("ignores_choosing_an_uncommitted_row_as_summary", () => {
    const s = run(blankEditor(), { type: "summaryChosen", row: 0 });
    expect(s.summaryKey).toBeNull();
  });
});

describe("editorFor and copyOf", () => {
  it("copy_of_risen_keeps_instructions_as_summary_and_is_automatic", () => {
    const b = risen();
    const c = copyOf(b, []);
    expect(c.summaryKey).toBe("instructions");
    expect(c.automatic).toBe(true);
    expect(c.template).toBe(b.template);
    expect(c.sections.map((s) => s.key)).toEqual(b.sections.map((s) => s.key));
    expect(c.sections.every((s) => s.committed)).toBe(true);
    expect(c.sourceId).toBeNull();
    expect(c.readOnly).toBe(false);
    expect(c.saved).toBeNull();
  });

  it("copy_name_is_unique", () => {
    const c = copyOf(risen(), ["RISEN (copy)", "risen (copy) (2)"]);
    expect(c.name).toBe("RISEN (copy) (3)");
  });

  it("opens_a_built_in_read_only_and_a_custom_one_editable", () => {
    expect(editorFor(risen()).readOnly).toBe(true);
    expect(editorFor(custom()).readOnly).toBe(false);
  });

  it("read_only_ignores_every_action", () => {
    const s = editorFor(risen());
    const actions: EditorAction[] = [
      { type: "nameChanged", value: "x" },
      { type: "descriptionChanged", value: "x" },
      { type: "sectionAdded" },
      { type: "labelChanged", row: 0, value: "x" },
      { type: "labelCommitted", row: 0 },
      { type: "helpChanged", row: 0, value: "x" },
      { type: "sectionRemoved", row: 0 },
      { type: "sectionMoved", row: 0, to: 2 },
      { type: "summaryChosen", row: 1 },
      { type: "modeChanged", automatic: false },
      { type: "templateEdited", value: "x" },
      { type: "sectionAppendedToTemplate", row: 0 },
      { type: "noteDismissed", index: 0 },
    ];
    for (const action of actions) {
      expect(editorReducer(s, action)).toBe(s);
    }
  });
});

describe("validate", () => {
  it("validate_requires_a_name_unique_among_live_names_ignoring_case", () => {
    let s = withLabel("One");
    expect(validate(s, []).name).toBe("Give the framework a name.");
    s = run(s, { type: "nameChanged", value: "  Mine " });
    expect(validate(s, []).name).toBeUndefined();
    expect(validate(s, ["MINE"]).name).toBe(
      "Another framework already has this name.",
    );
  });

  it("validate_requires_a_committed_section", () => {
    const s = run(blankEditor(), { type: "nameChanged", value: "x" });
    expect(validate(s, []).sections).toBe("Add at least one section.");
    expect(validate(withLabel("One", s), []).sections).toBeUndefined();
  });

  it("a_blank_row_has_a_label_error", () => {
    const s = run(withLabel("One"), { type: "sectionAdded" });
    expect(Object.keys(validate(s, []).labels)).toEqual([
      String(s.sections[1].id),
    ]);
  });

  it("a_label_with_braces_is_invalid", () => {
    for (const label of ["a {{ b", "a }} b"]) {
      const s = withLabel(label);
      expect(validate(s, []).labels[s.sections[0].id]).toBe(
        "A label can't contain {{ or }}.",
      );
    }
  });

  it("validate_reports_duplicate_labels_on_the_second_row", () => {
    const s = addSection(withLabel("Goal"), " GOAL ");
    const labels = validate(s, []).labels;
    expect(Object.keys(labels)).toEqual([String(s.sections[1].id)]);
  });

  it("validate_reports_template_errors_with_offsets", () => {
    let s = withLabel("One");
    s = run(
      s,
      { type: "modeChanged", automatic: false },
      { type: "templateEdited", value: "ok {{nope}}" },
    );
    const errors = validate(s, []).template!;
    expect(errors).toHaveLength(1);
    expect(errors[0].offset).toBe(3);
    const cleared = run(s, { type: "templateEdited", value: "" });
    expect(validate(cleared, []).template).toBeUndefined();
  });
});

describe("toInput", () => {
  it("toInput_leaves_out_uncommitted_rows", () => {
    let s = withLabel("  One  ");
    s = run(
      s,
      { type: "nameChanged", value: "  Name " },
      { type: "sectionAdded" },
      { type: "helpChanged", row: s.sections[0].id, value: " help " },
    );
    const input = toInput(s);
    expect(input.name).toBe("Name");
    expect(input.sections).toEqual([
      { key: "one", label: "One", helpText: " help " },
    ]);
    expect(input.summaryKey).toBe("one");
    expect(input.template).toBe(autoTemplate(input.sections));
  });
});

describe("isDirty", () => {
  it("is_false_for_an_untouched_new_framework_and_true_once_edited", () => {
    expect(isDirty(blankEditor())).toBe(false);
    expect(
      isDirty(run(blankEditor(), { type: "nameChanged", value: "x" })),
    ).toBe(true);
  });

  it("is_true_for_an_unsaved_copy", () => {
    expect(isDirty(copyOf(risen(), []))).toBe(true);
  });

  it("is_false_for_a_freshly_opened_framework", () => {
    const s = editorFor(custom());
    expect(isDirty(s)).toBe(false);
    expect(isDirty(run(s, { type: "descriptionChanged", value: "d" }))).toBe(
      true,
    );
  });

  it("isDirty_is_false_after_markSaved", () => {
    const s = run(withLabel("One"), { type: "nameChanged", value: "Name" });
    expect(isDirty(s)).toBe(true);
    const saved = markSaved(s, custom({ ...toInput(s) }));
    expect(isDirty(saved)).toBe(false);
    expect(saved.sourceId).toBe(custom().id);
  });

  it("isDirty_is_false_after_saving_untrimmed_labels", () => {
    let s = run(withLabel("  Padded  "), {
      type: "nameChanged",
      value: "  Name  ",
    });
    s = run(s, { type: "sectionAdded" });
    const saved = markSaved(s, custom({ ...toInput(s) }));
    expect(saved.name).toBe("Name");
    expect(saved.sections[0].label).toBe("Padded");
    expect(saved.sections).toHaveLength(1);
    expect(isDirty(saved)).toBe(false);
    expect(saved.sections[0].id).toBe(s.sections[0].id);
  });

  it("markSaved_keeps_edits_made_while_saving_as_unsaved_changes", () => {
    const s = run(withLabel("One"), { type: "nameChanged", value: "Name" });
    const sent = toInput(s);
    const later = run(s, { type: "descriptionChanged", value: "More" });

    const landed = markSaved(later, custom({ ...sent }), sent);

    expect(landed.sourceId).toBe(custom().id);
    expect(landed.description).toBe("More");
    expect(isDirty(landed)).toBe(true);
    // Undoing the later edit leaves nothing unsaved.
    const undone = run(landed, { type: "descriptionChanged", value: "" });
    expect(isDirty(undone)).toBe(false);
  });

  it("markSaved_counts_a_row_added_while_saving_as_a_change", () => {
    const s = run(withLabel("One"), { type: "nameChanged", value: "Name" });
    const sent = toInput(s);
    const later = run(s, { type: "sectionAdded" });

    const landed = markSaved(later, custom({ ...sent }), sent);

    expect(landed.sections).toHaveLength(2);
    expect(isDirty(landed)).toBe(true);
  });

  it("markSaved_with_an_unchanged_editor_is_saved", () => {
    const s = run(withLabel("One"), { type: "nameChanged", value: "Name" });
    const sent = toInput(s);

    const landed = markSaved(s, custom({ ...sent }), sent);

    expect(isDirty(landed)).toBe(false);
    expect(landed.sourceId).toBe(custom().id);
  });

  it("markSaved_keeps_notes_and_clears_spots", () => {
    let s = run(addSection(withLabel("One"), "Two"), {
      type: "modeChanged",
      automatic: false,
    });
    s = addSection(s, "Three");
    s = run(
      s,
      { type: "templateEdited", value: "{{one}} {{two}} {{three}}" },
      { type: "sectionRemoved", row: s.sections[0].id },
    );
    expect(s.spots).toHaveLength(1);
    const saved = markSaved(s, custom({ ...toInput(s) }));
    expect(saved.notes).toEqual(s.notes);
    expect(saved.spots).toEqual([]);
    expect(saved.automatic).toBe(false);
  });
});

describe("hasErrors", () => {
  it("a_valid_editor_validates_to_no_errors", () => {
    const named = run(withLabel("One"), { type: "nameChanged", value: "x" });
    for (const s of [editorFor(risen()), named]) {
      const errors = validate(s, []);
      expect(errors).toEqual({ labels: {} });
      expect(hasErrors(errors)).toBe(false);
    }
  });

  it("is_true_for_each_kind_of_error", () => {
    const named = run(withLabel("One"), { type: "nameChanged", value: "x" });
    expect(hasErrors(validate(withLabel("One"), []))).toBe(true);
    expect(hasErrors(validate(blankEditor(), []))).toBe(true);
    const blankRow = run(named, { type: "sectionAdded" });
    expect(hasErrors(validate(blankRow, []))).toBe(true);
    const bad = run(
      named,
      { type: "modeChanged", automatic: false },
      { type: "templateEdited", value: "{{nope}}" },
    );
    expect(hasErrors(validate(bad, []))).toBe(true);
  });
});

describe("stale notes and unparsable templates", () => {
  it("keeps_notes_when_an_edit_lands_on_the_generated_template", () => {
    let s = run(withLabel("One"), { type: "modeChanged", automatic: false });
    s = addSection(s, "Two");
    expect(s.notes).toHaveLength(1);
    s = run(s, {
      type: "templateEdited",
      value: autoTemplate(toInput(s).sections),
    });
    expect(s.automatic).toBe(false);
    expect(s.notes).toHaveLength(1);
  });

  it("markSaved_drops_notes_when_the_saved_framework_is_automatic", () => {
    let s = run(withLabel("One"), { type: "modeChanged", automatic: false });
    s = addSection(s, "Two");
    s = run(s, {
      type: "templateEdited",
      value: autoTemplate(toInput(s).sections),
    });
    const noted = { ...s, notes: ["x"] };
    expect(markSaved(noted, custom({ ...toInput(s) })).notes).toEqual([]);
  });

  it("unusedRows_is_empty_while_the_template_does_not_parse", () => {
    const s = run(
      withLabel("One"),
      { type: "modeChanged", automatic: false },
      { type: "templateEdited", value: "{{#one" },
    );
    expect(unusedRows(s)).toEqual([]);
  });
});
