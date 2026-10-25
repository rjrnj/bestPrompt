import type { Framework } from "../bindings/Framework";
import type { FrameworkInput } from "../bindings/FrameworkInput";
import type { Section } from "../bindings/Section";
import {
  parseTemplate,
  removeSectionFromTemplate,
  usedKeys,
  validateTemplate,
  type TemplateError,
} from "../template";
import { autoTemplate, isAutomatic, sectionBlock } from "./autoTemplate";
import { keyFromLabel } from "./keys";
import { uniqueName } from "./names";

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
  notes: string[];
  /** Offsets in the template to check after a removal. */
  spots: number[];
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

/** Regenerates the template from the sections while it is automatic. */
function followSections(state: EditorState): EditorState {
  if (!state.automatic) return state;
  return { ...state, template: autoTemplate(savedSections(state.sections)) };
}

function appendBlock(template: string, section: Section): string {
  const block = sectionBlock(section);
  return template === "" ? block : `${template}\n\n${block}`;
}

function removeRow(state: EditorState, row: number): EditorState {
  const target = state.sections.find((s) => s.id === row);
  if (!target) return state;
  const sections = state.sections.filter((s) => s.id !== row);
  const next: EditorState = { ...state, sections };
  if (!target.committed) return next;

  if (state.summaryKey === target.key) {
    next.summaryKey = sections.find((s) => s.committed)?.key ?? null;
  }
  if (state.automatic) return followSections(next);
  const removal = removeSectionFromTemplate(state.template, {
    key: target.key,
    label: target.label.trim(),
    helpText: target.helpText,
  });
  return { ...next, template: removal.template, spots: removal.spots };
}

function commitLabel(state: EditorState, row: number): EditorState {
  const target = state.sections.find((s) => s.id === row);
  const label = target?.label.trim() ?? "";
  if (!target || target.committed || label === "") return state;

  const taken = new Set(
    state.sections.filter((s) => s.id !== row).map((s) => s.key),
  );
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
  return {
    ...next,
    template: appendBlock(state.template, { ...committed, label }),
    notes: [
      ...state.notes,
      `${label} was added to the end of the template. Move or reword it as you like.`,
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
    case "modeChanged":
      if (!action.automatic) return { ...state, automatic: false };
      return {
        ...state,
        automatic: true,
        template: autoTemplate(savedSections(state.sections)),
        notes: [],
        spots: [],
      };
    case "templateEdited": {
      const automatic = isAutomatic(
        action.value,
        savedSections(state.sections),
      );
      return {
        ...state,
        template: action.value,
        automatic,
        notes: automatic ? [] : state.notes,
        spots: [],
      };
    }
    case "sectionAppendedToTemplate": {
      const target = state.sections.find((s) => s.id === action.row);
      if (!target?.committed || state.automatic) return state;
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

  const name = state.name.trim().toLowerCase();
  if (name === "") {
    errors.name = "Give the framework a name.";
  } else if (liveNames.some((n) => n.trim().toLowerCase() === name)) {
    errors.name = "Another framework already has this name.";
  }

  if (!state.sections.some((s) => s.committed)) {
    errors.sections = "Add at least one section.";
  }

  const seen = new Set<string>();
  for (const section of state.sections) {
    const label = section.label.trim();
    if (label === "") {
      errors.labels[section.id] = "Give the section a label.";
    } else if (label.includes("{{") || label.includes("}}")) {
      errors.labels[section.id] = "A label can't contain {{ or }}.";
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
  if (state.automatic || !parseTemplate(state.template).ok) return [];
  const used = usedKeys(state.template);
  return state.sections
    .filter((s) => s.committed && !used.has(s.key))
    .map((s) => s.id);
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

function content(state: EditorState): string {
  return JSON.stringify([
    state.name,
    state.description,
    state.sections.map((s) => [s.key, s.label, s.helpText, s.committed]),
    state.summaryKey,
    state.template,
  ]);
}

/** Whether the content differs from the last saved copy (or from a blank editor if never saved). */
export function isDirty(state: EditorState): boolean {
  return content(state) !== content(state.saved ?? blankEditor());
}

/**
 * Rebuilds the editor from the framework the backend returned after a save.
 * With `sent`, the input that was saved: if the editor has changed since it
 * was sent, the changes are kept, now as unsaved changes to the stored
 * framework, so the next Save updates it rather than creating another.
 */
export function markSaved(
  state: EditorState,
  framework: Framework,
  sent?: FrameworkInput,
): EditorState {
  // A saved editor has no uncommitted rows (blank labels block Save), so
  // one now was added while the save was under way.
  const changed =
    sent !== undefined &&
    (JSON.stringify(toInput(state)) !== JSON.stringify(sent) ||
      state.sections.some((s) => !s.committed));
  const saved = rebuilt(state, framework);
  if (changed) return { ...state, sourceId: framework.id, saved };
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
    notes: isAutomatic(framework.template, framework.sections)
      ? []
      : state.notes,
    nextRowId,
  };
}
