import type { Framework } from "../bindings/Framework";
import type { FrameworkInput } from "../bindings/FrameworkInput";
import type { Section } from "../bindings/Section";
import {
  parseTemplate,
  referencedKeys,
  removeSectionFromTemplate,
  unusedKeys,
  validateTemplate,
  type TemplateError,
} from "../template";
import { autoTemplate, isAutomatic, sectionBlock } from "./autoTemplate";
import { keyFromLabel } from "./keys";
import { nameKey, uniqueName } from "./names";

// The working copy of one framework in the editor. `row` in every action is an
// `EditorSection.id`, which stays the same while rows move and others go.

/** A section row; `id` is a stable row id and `committed` means it has a key. */
export type EditorSection = Section & { id: number; committed: boolean };

export type EditorState = {
  /** The framework being edited; null for a new one or a copy. */
  sourceId: string | null;
  /** A built-in: every action is ignored. */
  readOnly: boolean;
  name: string;
  description: string;
  sections: EditorSection[];
  summaryKey: string | null;
  /** What is saved; regenerated from the sections while automatic. */
  template: string;
  automatic: boolean;
  /** Messages about hand-edited templates, each tied to the row it names. */
  notes: { row: number; text: string }[];
  /** Offsets in the template to check after a removal. */
  spots: number[];
  /** Keys of the sections removed since the last save, not to be given out again. */
  removedKeys: string[];
  nextRowId: number;
  /** The last saved copy, for `isDirty`. */
  saved: EditorState | null;
};

export type EditorAction =
  | { type: "nameChanged"; value: string }
  | { type: "descriptionChanged"; value: string }
  | { type: "sectionAdded" }
  | { type: "labelChanged"; row: number; value: string }
  | { type: "labelCommitted"; row: number }
  | { type: "helpChanged"; row: number; value: string }
  | { type: "sectionRemoved"; row: number }
  | { type: "sectionMoved"; row: number; to: number }
  | { type: "summaryChosen"; row: number }
  | { type: "modeChanged"; automatic: boolean }
  | { type: "templateEdited"; value: string }
  | { type: "sectionAppendedToTemplate"; row: number }
  | { type: "noteDismissed"; index: number };

export type EditorErrors = {
  name?: string;
  sections?: string;
  labels: Record<number, string>;
  template?: TemplateError[];
};

/** Whether a label holds a template delimiter. */
export function hasBraces(label: string): boolean {
  return label.includes("{{") || label.includes("}}");
}

export const BRACE_LABEL_ERROR =
  "A label can't contain {{ or }}, so the template can't be built while it does.";

/** The sections as they are saved: committed rows only, labels trimmed. */
function savedSections(sections: EditorSection[]): Section[] {
  return sections
    .filter((s) => s.committed)
    .map(({ key, label, helpText }) => ({
      key,
      label: label.trim(),
      helpText,
    }));
}

/** The sections as they are saved, from `state`. */
export function committedSections(state: EditorState): Section[] {
  return savedSections(state.sections);
}

function rowOf(
  id: number,
  section: Section,
  committed: boolean,
): EditorSection {
  return { id, committed, ...section };
}

function fromFramework(framework: Framework, readOnly: boolean): EditorState {
  return {
    sourceId: framework.id,
    readOnly,
    name: framework.name,
    description: framework.description,
    sections: framework.sections.map((s, i) => rowOf(i, s, true)),
    summaryKey: framework.summaryKey,
    template: framework.template,
    automatic: isAutomatic(framework.template, framework.sections),
    notes: [],
    spots: [],
    removedKeys: [],
    nextRowId: framework.sections.length,
    saved: null,
  };
}

/** The editor for `framework`; a built-in opens read-only. */
export function editorFor(framework: Framework): EditorState {
  const state = fromFramework(framework, !framework.isCustom);
  return { ...state, saved: state };
}

export function blankEditor(): EditorState {
  return {
    sourceId: null,
    readOnly: false,
    name: "",
    description: "",
    sections: [rowOf(0, { key: "", label: "", helpText: "" }, false)],
    summaryKey: null,
    template: "",
    automatic: true,
    notes: [],
    spots: [],
    removedKeys: [],
    nextRowId: 1,
    saved: null,
  };
}

/** An editable copy of `framework`; `taken` holds the names already in use. */
export function copyOf(framework: Framework, taken: string[]): EditorState {
  return {
    ...fromFramework(framework, false),
    sourceId: null,
    name: uniqueName(`${framework.name} (copy)`, taken),
  };
}

/**
 * The template generated from the sections, or null while a section's label
 * holds braces: the text would not parse, so the previous template stays
 * until the label is fixed.
 */
function generated(state: EditorState): string | null {
  const sections = savedSections(state.sections);
  if (sections.some((s) => hasBraces(s.label))) return null;
  return autoTemplate(sections);
}

/** Regenerates the template from the sections while it is automatic. */
function followSections(state: EditorState): EditorState {
  if (!state.automatic) return state;
  const template = generated(state);
  return template === null ? state : { ...state, template };
}

function appendBlock(template: string, section: Section): string {
  const block = sectionBlock(section);
  return template === "" ? block : `${template}\n\n${block}`;
}

function removeRow(state: EditorState, row: number): EditorState {
  const target = state.sections.find((s) => s.id === row);
  if (!target) return state;
  const sections = state.sections.filter((s) => s.id !== row);
  const next: EditorState = {
    ...state,
    sections,
    notes: state.notes.filter((n) => n.row !== row),
  };
  if (!target.committed) return next;

  if (state.summaryKey === target.key) {
    next.summaryKey = sections.find((s) => s.committed)?.key ?? null;
  }
  let result: EditorState | null = null;
  if (state.automatic) {
    const template = generated(next);
    if (template !== null) result = { ...next, template };
    // Not regenerated while a label holds braces, so cut the block out below.
  }
  if (!result) {
    const removal = removeSectionFromTemplate(
      state.template,
      target.key,
      state.spots,
    );
    result = { ...next, template: removal.template, spots: removal.spots };
  }
  // Only a key the template may still hold stays reserved, and that is only
  // in text that doesn't parse. A template that parses has had every
  // placeholder and block of the key taken out, leaving nothing to collide
  // with.
  if (!parseTemplate(result.template).ok) {
    result.removedKeys = [...state.removedKeys, target.key];
  }
  return result;
}

function commitLabel(state: EditorState, row: number): EditorState {
  const target = state.sections.find((s) => s.id === row);
  const label = target?.label.trim() ?? "";
  if (!target || target.committed || label === "") return state;
  // Left as it is: the row stays uncommitted and the label is flagged.
  if (hasBraces(label)) return state;

  // Within one editing session a new section never takes a key that was in
  // use: not one the stored framework still has, nor one of a section
  // removed since, which a template that doesn't parse may still hold. Once
  // a removal is saved, its key may be given out again, so a re-added
  // section with the same label picks up old History text by design.
  const taken = new Set([
    ...state.sections.filter((s) => s.id !== row).map((s) => s.key),
    ...(state.saved?.sections ?? []).map((s) => s.key),
    ...state.removedKeys,
  ]);
  const committed = {
    ...target,
    key: keyFromLabel(label, taken),
    committed: true,
  };
  const next: EditorState = {
    ...state,
    sections: state.sections.map((s) => (s.id === row ? committed : s)),
    summaryKey: state.summaryKey ?? committed.key,
  };
  if (state.automatic) return followSections(next);
  // A template that doesn't parse can't be searched for the key, so adding
  // a block could repeat one the user already typed.
  if (!parseTemplate(state.template).ok) {
    return {
      ...next,
      notes: [
        ...state.notes,
        {
          row,
          text: `${label} wasn't added to the template because the template has an error. Fix it, then use "Add to end of template" if you need it.`,
        },
      ],
    };
  }
  // The template already has a placeholder or block for this key, typed by
  // hand: it now belongs to the section, and a second block would repeat it.
  if (referencedKeys(state.template).has(committed.key)) return next;
  return {
    ...next,
    template: appendBlock(state.template, { ...committed, label }),
    notes: [
      ...state.notes,
      {
        row,
        text: `${label} was added to the end of the template. Move or reword it as you like.`,
      },
    ],
  };
}

function moveRow(state: EditorState, row: number, to: number): EditorState {
  const from = state.sections.findIndex((s) => s.id === row);
  if (from === -1) return state;
  const sections = [...state.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(Math.max(0, Math.min(to, sections.length)), 0, moved);
  return followSections({ ...state, sections });
}

function changeRow(
  state: EditorState,
  row: number,
  change: Partial<Section>,
): EditorState {
  return {
    ...state,
    sections: state.sections.map((s) =>
      s.id === row ? { ...s, ...change } : s,
    ),
  };
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  if (state.readOnly) return state;
  switch (action.type) {
    case "nameChanged":
      return { ...state, name: action.value };
    case "descriptionChanged":
      return { ...state, description: action.value };
    case "sectionAdded":
      return {
        ...state,
        sections: [
          ...state.sections,
          rowOf(state.nextRowId, { key: "", label: "", helpText: "" }, false),
        ],
        nextRowId: state.nextRowId + 1,
      };
    case "labelChanged":
      return followSections(
        changeRow(state, action.row, { label: action.value }),
      );
    case "labelCommitted":
      return commitLabel(state, action.row);
    case "helpChanged":
      return changeRow(state, action.row, { helpText: action.value });
    case "sectionRemoved":
      return removeRow(state, action.row);
    case "sectionMoved":
      return moveRow(state, action.row, action.to);
    case "summaryChosen": {
      const target = state.sections.find((s) => s.id === action.row);
      return target?.committed ? { ...state, summaryKey: target.key } : state;
    }
    case "modeChanged": {
      if (!action.automatic) return { ...state, automatic: false };
      // The template can't be rebuilt while a label holds braces.
      const template = generated(state);
      if (template === null) return state;
      return {
        ...state,
        automatic: true,
        template,
        notes: [],
        spots: [],
      };
    }
    case "templateEdited":
      // The mode stays the user's choice while editing: landing on the
      // generated text must not switch the editor away under the cursor.
      return { ...state, template: action.value, spots: [] };
    case "sectionAppendedToTemplate": {
      const target = state.sections.find((s) => s.id === action.row);
      if (!target?.committed || state.automatic) return state;
      if (hasBraces(target.label)) return state;
      return {
        ...state,
        template: appendBlock(state.template, {
          ...target,
          label: target.label.trim(),
        }),
      };
    }
    case "noteDismissed":
      return {
        ...state,
        notes: state.notes.filter((_, i) => i !== action.index),
      };
  }
}

/** What stops the framework being saved; `liveNames` excludes the framework itself. */
export function validate(
  state: EditorState,
  liveNames: string[],
): EditorErrors {
  const errors: EditorErrors = { labels: {} };

  const name = nameKey(state.name);
  if (name === "") {
    errors.name = "Give the framework a name.";
  } else if (liveNames.some((n) => nameKey(n) === name)) {
    errors.name = "Another framework already has this name.";
  }

  if (!state.sections.some((s) => s.committed)) {
    errors.sections = "Add at least one section.";
  }

  const seen = new Set<string>();
  for (const section of state.sections) {
    // Save drops a blank row nobody confirmed, so it has nothing to flag.
    if (isUnusedRow(section)) continue;
    const label = section.label.trim();
    if (label === "") {
      errors.labels[section.id] = "Give the section a label.";
    } else if (hasBraces(label)) {
      errors.labels[section.id] = BRACE_LABEL_ERROR;
    } else if (seen.has(label.toLowerCase())) {
      errors.labels[section.id] = "Another section already has this label.";
    } else {
      seen.add(label.toLowerCase());
    }
  }

  const keys = state.sections.filter((s) => s.committed).map((s) => s.key);
  const templateErrors = validateTemplate(state.template, keys);
  if (templateErrors.length > 0) errors.template = templateErrors;
  return errors;
}

/** Whether anything in `errors` should block Save. */
export function hasErrors(errors: EditorErrors): boolean {
  return (
    errors.name !== undefined ||
    errors.sections !== undefined ||
    Object.keys(errors.labels).length > 0 ||
    errors.template !== undefined
  );
}

/** Committed rows the hand-written template never uses; none while automatic or unparsable. */
export function unusedRows(state: EditorState): number[] {
  if (state.automatic) return [];
  const committed = state.sections.filter((s) => s.committed);
  const unused = unusedKeys(
    state.template,
    committed.map((s) => s.key),
  );
  return committed.filter((s) => unused.includes(s.key)).map((s) => s.id);
}

export function toInput(state: EditorState): FrameworkInput {
  const sections = savedSections(state.sections);
  return {
    name: state.name.trim(),
    description: state.description,
    template: state.template,
    summaryKey: state.summaryKey ?? sections[0]?.key ?? "",
    sections,
  };
}

/** Blank rows nobody has committed: adding one changes nothing worth saving. */
function isUnusedRow(s: EditorSection): boolean {
  return !s.committed && s.label.trim() === "" && s.helpText.trim() === "";
}

function content(state: EditorState): string {
  return JSON.stringify([
    state.name,
    state.description,
    state.sections
      .filter((s) => !isUnusedRow(s))
      .map((s) => [s.key, s.label, s.helpText, s.committed]),
    state.summaryKey,
    state.template,
  ]);
}

/**
 * Whether the content differs from the last saved copy. Never saved, it is
 * dirty once it holds anything worth keeping: a name or description, a
 * committed row or one with a label or help text, or a template. Adding or
 * removing empty rows doesn't count.
 */
export function isDirty(state: EditorState): boolean {
  if (state.saved !== null) return content(state) !== content(state.saved);
  return (
    state.name.trim() !== "" ||
    state.description.trim() !== "" ||
    state.sections.some((s) => !isUnusedRow(s)) ||
    state.template !== ""
  );
}

/**
 * Rebuilds the editor from the framework the backend returned after a save.
 * With `sent`, the editor as it was when Save was pressed: if it has changed
 * since, even by a space the save would have trimmed or a blank row, the
 * changes are kept, now as unsaved changes to the stored framework, so the
 * next Save updates it rather than creating another.
 */
export function markSaved(
  state: EditorState,
  framework: Framework,
  sent?: EditorState,
): EditorState {
  const rows = (s: EditorState) => s.sections.map((r) => r.id).join();
  const changed =
    sent !== undefined &&
    (content(state) !== content(sent) || rows(state) !== rows(sent));
  const saved = rebuilt(state, framework);
  if (changed) {
    // A section removed after Save was pressed keeps its key reserved; one
    // the stored framework now has is taken anyway.
    const removedKeys = state.removedKeys.filter(
      (key) => !framework.sections.some((s) => s.key === key),
    );
    return { ...state, sourceId: framework.id, saved, removedKeys };
  }
  return { ...saved, saved };
}

/** The editor as the backend stored `framework`, keeping the row ids. */
function rebuilt(state: EditorState, framework: Framework): EditorState {
  const ids = new Map(
    state.sections.filter((s) => s.committed).map((s) => [s.key, s.id]),
  );
  let nextRowId = state.nextRowId;
  const sections = framework.sections.map((s) =>
    rowOf(ids.get(s.key) ?? nextRowId++, s, true),
  );
  return {
    ...fromFramework(framework, false),
    sections,
    // The mode is the user's choice; only opening a framework works it out.
    automatic: state.automatic,
    notes: state.automatic ? [] : state.notes,
    // The saved template is the one the spots point into.
    spots: state.automatic ? [] : state.spots,
    nextRowId,
  };
}
