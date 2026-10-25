// The app's state: a pure reducer and the selectors that read from it. No
// React here, so all of it is tested as plain functions. The provider in
// AppState.tsx owns the async work and dispatches these actions.

import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import { hasOwn } from "../hasOwn";
import { renderTemplate, TemplateSyntaxError } from "../template";

export type Toast = { id: number; kind: "info" | "error"; message: string };

export type State = {
  frameworks:
    | { status: "loading" }
    | { status: "ready"; items: Framework[] }
    | { status: "error"; message: string };
  /** The framework being edited; the first one once loaded. */
  selectedId: string | null;
  /** What the user typed, by framework id and then section key. */
  drafts: Record<string, Record<string, string>>;
  /** The rendered prompt last saved for each framework, for the duplicate check. */
  lastSaved: Record<string, string>;
  /** The title typed for each framework, by framework id. */
  titles: Record<string, string>;
  /** Which tab is showing. */
  view: "builder" | "history" | "frameworks";
  /**
   * The custom framework being edited in the Frameworks tab, for the guard
   * that asks before leaving it; null when none is open.
   */
  editingFramework: {
    dirty: boolean;
    name: string;
    /** A save or delete is running, so the tab can't be left. */
    busy: boolean;
  } | null;
  /**
   * Ids of frameworks deleted here and not restored since, so a save that
   * finishes late can't bring one back, even once a fresh listing or a
   * prune has dropped it from the list.
   */
  deletedFrameworks: string[];
  projects:
    | { status: "loading" }
    | { status: "ready"; items: Project[] }
    | { status: "error"; message: string };
  /** The project new entries are filed under; one value for all frameworks. */
  selectedProjectId: string | null;
  /**
   * Whether the user has chosen the project (opened the project list, picked
   * one or none, created one, or opened an entry), so the newest entry's
   * project, looked up at startup, no longer replaces it.
   */
  projectChosen: boolean;
  /**
   * Projects created while the list is loading or failed to load, in name
   * order, so they can be listed and selected meanwhile. A list read before
   * they were created doesn't have them, so they join it when it loads.
   */
  createdProjects: Project[];
  /**
   * Ids of projects deleted while the list is loading, so a list read before
   * the delete doesn't bring them back when it loads.
   */
  deletedProjects: string[];
  saving: boolean;
  toasts: Toast[];
  nextToastId: number;
};

export type Action =
  | { type: "frameworksLoading" }
  | { type: "frameworksLoaded"; frameworks: Framework[] }
  | { type: "frameworksFailed"; message: string }
  | { type: "deletedFrameworksPruned"; listedIds: string[] }
  | { type: "frameworkSaved"; framework: Framework }
  | { type: "frameworkDeleted"; framework: Framework }
  | { type: "frameworkRestored"; framework: Framework }
  | { type: "editingChanged"; editing: State["editingFramework"] }
  | { type: "selectFramework"; id: string }
  | { type: "editSection"; key: string; value: string }
  | { type: "clearDraft" }
  | { type: "viewChanged"; view: State["view"] }
  | { type: "projectsLoaded"; projects: Project[] }
  | { type: "projectsFailed"; message: string }
  | { type: "projectSelected"; id: string | null }
  | { type: "projectListOpened" }
  | { type: "startingProjectFound"; id: string | null }
  | { type: "projectCreated"; project: Project }
  | { type: "projectRenamed"; project: Project }
  | { type: "projectDeleted"; id: string }
  | { type: "editTitle"; value: string }
  | { type: "entryOpened"; entry: PromptEntry }
  | { type: "saveStarted" }
  | { type: "saveSucceeded"; frameworkId: string; renderedPrompt: string }
  | { type: "saveFailed"; message: string }
  | { type: "entryDeleted"; frameworkId: string | null; renderedPrompt: string }
  | { type: "toastAdded"; kind: Toast["kind"]; message: string }
  | { type: "toastDismissed"; id: number };

/** The most toasts shown at once; adding another drops the oldest. */
export const MAX_TOASTS = 3;

export const initialState: State = {
  frameworks: { status: "loading" },
  selectedId: null,
  drafts: {},
  lastSaved: {},
  titles: {},
  view: "builder",
  editingFramework: null,
  deletedFrameworks: [],
  projects: { status: "loading" },
  selectedProjectId: null,
  projectChosen: false,
  createdProjects: [],
  deletedProjects: [],
  saving: false,
  toasts: [],
  nextToastId: 1,
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "frameworksLoading":
      return { ...state, frameworks: { status: "loading" } };
    case "frameworksLoaded": {
      // A list read before a delete still shows that framework live: the
      // deleted copy held here stands in for it, or it is left out if there
      // is none. One the read shows deleted is kept.
      const held = loadedFrameworks(state);
      return withItems(
        state,
        action.frameworks.flatMap((f) => {
          if (f.deletedAt !== null || !state.deletedFrameworks.includes(f.id))
            return [f];
          const copy = held.find((h) => h.id === f.id && h.deletedAt !== null);
          return copy === undefined ? [] : [copy];
        }),
      );
    }
    case "deletedFrameworksPruned": {
      // Drops deleted frameworks a fresh listing left out; everything else
      // stays as it is here, so a save that landed during the read is kept.
      if (state.frameworks.status !== "ready") return state;
      const listed = new Set(action.listedIds);
      const items = state.frameworks.items.filter(
        (f) => f.deletedAt === null || listed.has(f.id),
      );
      if (items.length === state.frameworks.items.length) return state;
      return withItems(state, items);
    }
    case "frameworkSaved": {
      const { framework } = action;
      // A save that finishes after a delete must not undo it; only a restore
      // makes a deleted framework live again.
      if (
        state.deletedFrameworks.includes(framework.id) ||
        (state.frameworks.status === "ready" &&
          state.frameworks.items.some(
            (f) => f.id === framework.id && f.deletedAt !== null,
          ))
      ) {
        return state;
      }
      const next = withFramework(state, framework);
      if (next === state) return state;
      // Text in sections the framework still has stays; the rest is dropped.
      const stored = state.drafts[framework.id];
      if (stored === undefined) return next;
      const kept = Object.fromEntries(
        Object.entries(stored).filter(([key]) =>
          framework.sections.some((s) => s.key === key),
        ),
      );
      return { ...next, drafts: { ...next.drafts, [framework.id]: kept } };
    }
    case "frameworkDeleted": {
      const { framework } = action;
      const deletedFrameworks = state.deletedFrameworks.includes(framework.id)
        ? state.deletedFrameworks
        : [...state.deletedFrameworks, framework.id];
      const next = { ...withFramework(state, framework), deletedFrameworks };
      // A deleted framework's work is gone, so it no longer counts as text
      // that opening an entry or leaving would lose.
      const drafts = { ...state.drafts };
      const titles = { ...state.titles };
      const lastSaved = { ...state.lastSaved };
      delete drafts[framework.id];
      delete titles[framework.id];
      delete lastSaved[framework.id];
      return { ...next, drafts, titles, lastSaved };
    }
    case "frameworkRestored":
      return {
        ...withFramework(state, action.framework),
        deletedFrameworks: state.deletedFrameworks.filter(
          (id) => id !== action.framework.id,
        ),
      };
    case "frameworksFailed":
      return {
        ...state,
        frameworks: { status: "error", message: action.message },
      };
    case "selectFramework":
      return liveFrameworks(state).some((f) => f.id === action.id)
        ? { ...state, selectedId: action.id }
        : state;
    case "editSection": {
      const framework = selectedFramework(state);
      if (framework === null) return state;
      if (!framework.sections.some((s) => s.key === action.key)) return state;
      const id = framework.id;
      const draft = { ...state.drafts[id], [action.key]: action.value };
      return { ...state, drafts: { ...state.drafts, [id]: draft } };
    }
    case "clearDraft": {
      const id = state.selectedId;
      if (id === null) return state;
      return {
        ...state,
        drafts: { ...state.drafts, [id]: {} },
        titles: { ...state.titles, [id]: "" },
      };
    }
    case "viewChanged":
      return { ...state, view: action.view };
    case "editingChanged":
      return { ...state, editingFramework: action.editing };
    case "projectsLoaded": {
      // A list read after a create already has the project, and one read
      // before a delete still has that one.
      const loaded = action.projects.filter(
        (p) =>
          !state.createdProjects.some((c) => c.id === p.id) &&
          !state.deletedProjects.includes(p.id),
      );
      const items = sortProjects([...loaded, ...state.createdProjects]);
      return {
        ...state,
        projects: { status: "ready", items },
        selectedProjectId: projectIfPresent(items, state.selectedProjectId),
        createdProjects: [],
        deletedProjects: [],
      };
    }
    case "projectsFailed":
      return {
        ...state,
        projects: { status: "error", message: action.message },
        // Only a project created here is known to exist without the list.
        selectedProjectId: projectIfPresent(
          state.createdProjects,
          state.selectedProjectId,
        ),
        deletedProjects: [],
      };
    case "projectSelected":
      return { ...state, selectedProjectId: action.id, projectChosen: true };
    case "projectListOpened":
      // Radix reports no pick of the project already selected, so opening
      // the list counts as choosing: the user has seen what is selected.
      return state.projectChosen ? state : { ...state, projectChosen: true };
    case "startingProjectFound": {
      if (state.projectChosen) return state;
      const id = projectIfPresent(loadedProjects(state), action.id);
      return id === null ? state : { ...state, selectedProjectId: id };
    }
    case "projectCreated":
      return {
        ...withListedProjects(state, (projects) =>
          sortProjects([...projects, action.project]),
        ),
        selectedProjectId: action.project.id,
        projectChosen: true,
      };
    case "projectRenamed":
      return withListedProjects(state, (projects) =>
        sortProjects(
          projects.map((p) =>
            p.id === action.project.id ? action.project : p,
          ),
        ),
      );
    case "projectDeleted":
      return {
        ...withListedProjects(state, (projects) =>
          projects.filter((p) => p.id !== action.id),
        ),
        deletedProjects:
          state.projects.status === "loading"
            ? [...state.deletedProjects, action.id]
            : state.deletedProjects,
        selectedProjectId:
          state.selectedProjectId === action.id
            ? null
            : state.selectedProjectId,
      };
    case "editTitle": {
      const id = state.selectedId;
      if (id === null) return state;
      return { ...state, titles: { ...state.titles, [id]: action.value } };
    }
    case "entryOpened": {
      const target = liveFrameworks(state).find(
        (f) => f.id === action.entry.frameworkId,
      );
      if (target === undefined) return state;
      const { entry } = action;
      const draft: Record<string, string> = Object.fromEntries(
        target.sections
          .filter((section) => hasOwn(entry.sectionValues, section.key))
          .map((section) => [section.key, entry.sectionValues[section.key]]),
      );
      return {
        ...state,
        view: "builder",
        selectedId: target.id,
        drafts: { ...state.drafts, [target.id]: draft },
        titles: { ...state.titles, [target.id]: entry.title ?? "" },
        selectedProjectId: openedProject(state, entry),
        projectChosen: true,
        lastSaved: { ...state.lastSaved, [target.id]: entry.renderedPrompt },
      };
    }
    case "saveStarted":
      return { ...state, saving: true };
    case "saveSucceeded":
      return {
        ...state,
        saving: false,
        lastSaved: {
          ...state.lastSaved,
          [action.frameworkId]: action.renderedPrompt,
        },
      };
    case "saveFailed":
      return { ...state, saving: false };
    case "entryDeleted": {
      // Once the entry last saved for a framework is gone, saving that
      // prompt again stores it again rather than reporting it as saved.
      const id = action.frameworkId;
      if (
        id === null ||
        !hasOwn(state.lastSaved, id) ||
        state.lastSaved[id] !== action.renderedPrompt
      ) {
        return state;
      }
      const lastSaved = { ...state.lastSaved };
      delete lastSaved[id];
      return { ...state, lastSaved };
    }
    case "toastAdded": {
      const toast = {
        id: state.nextToastId,
        kind: action.kind,
        message: action.message,
      };
      // A repeat replaces the one already showing (the new id restarts its
      // timer and announces it again), and the stack is capped so repeated
      // clicks cannot grow it over the preview.
      const others = state.toasts.filter(
        (t) => t.kind !== toast.kind || t.message !== toast.message,
      );
      return {
        ...state,
        toasts: [...others, toast].slice(-MAX_TOASTS),
        nextToastId: state.nextToastId + 1,
      };
    }
    case "toastDismissed":
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.id),
      };
  }
}

function loadedProjects(state: State): Project[] {
  return state.projects.status === "ready" ? state.projects.items : [];
}

/** Lowercases A-Z only, as SQLite's NOCASE does. */
function foldAscii(name: string): string {
  return name.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Orders by code point, which is how SQLite's byte-wise comparison of UTF-8
 * orders text; `<` would compare UTF-16 units and put a surrogate pair
 * before U+E000 to U+FFFF.
 */
function compareCodePoints(a: string, b: string): number {
  const x = a[Symbol.iterator]();
  const y = b[Symbol.iterator]();
  for (;;) {
    const p = x.next();
    const q = y.next();
    if (p.done || q.done) return p.done === q.done ? 0 : p.done ? -1 : 1;
    const d = p.value.codePointAt(0)! - q.value.codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
}

/** Orders by name ignoring ASCII case (as `COLLATE NOCASE` does), then by id. */
function byNameThenId(
  a: { name: string; id: string },
  b: { name: string; id: string },
): number {
  return (
    compareCodePoints(foldAscii(a.name), foldAscii(b.name)) ||
    compareCodePoints(a.id, b.id)
  );
}

/** Projects in name order, ignoring case, as the database lists them. */
function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(byNameThenId);
}

/**
 * The projects the pickers offer: the loaded list, or the projects created
 * here while it loads or after it failed.
 */
export function listedProjects(state: State): Project[] {
  return state.projects.status === "ready"
    ? state.projects.items
    : state.createdProjects;
}

/** `state` with `change` applied to the projects `listedProjects` returns. */
function withListedProjects(
  state: State,
  change: (projects: Project[]) => Project[],
): State {
  return state.projects.status === "ready"
    ? {
        ...state,
        projects: { status: "ready", items: change(state.projects.items) },
      }
    : { ...state, createdProjects: change(state.createdProjects) };
}

/** `id` if a project with that id is in `projects`, else null. */
function projectIfPresent(
  projects: Project[],
  id: string | null,
): string | null {
  return id !== null && projects.some((p) => p.id === id) ? id : null;
}

/** Frameworks in list order: built-ins first, then name ignoring case, then id. */
function sortFrameworks(frameworks: Framework[]): Framework[] {
  return [...frameworks].sort((a, b) => {
    if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
    return byNameThenId(a, b);
  });
}

/**
 * `state` with `framework` inserted or replacing the one with its id, in list
 * order. The selection moves to the first live framework when the selected
 * one is no longer live (or nothing was selected). Unchanged while the list
 * isn't loaded: a load that starts later reads the change from the database.
 */
function withFramework(state: State, framework: Framework): State {
  if (state.frameworks.status !== "ready") return state;
  return withItems(
    state,
    sortFrameworks([
      ...state.frameworks.items.filter((f) => f.id !== framework.id),
      framework,
    ]),
  );
}

/**
 * `state` with `items` as the loaded list. The selection stays if that
 * framework is still live, else moves to the first live one.
 */
function withItems(state: State, items: Framework[]): State {
  const live = items.filter((f) => f.deletedAt === null);
  const keep = live.some((f) => f.id === state.selectedId);
  return {
    ...state,
    frameworks: { status: "ready", items },
    selectedId: keep ? state.selectedId : (live[0]?.id ?? null),
  };
}

function loadedFrameworks(state: State): Framework[] {
  return state.frameworks.status === "ready" ? state.frameworks.items : [];
}

/** The loaded frameworks that haven't been deleted, in list order. */
export function liveFrameworks(state: State): Framework[] {
  return loadedFrameworks(state).filter((f) => f.deletedAt === null);
}

const filled = (text: string) => text.trim() !== "";

/** True when the title or any section of the draft has non-blank text. */
function hasText(
  title: string | undefined,
  draft: Record<string, string> | undefined,
) {
  return (
    (title !== undefined && filled(title)) ||
    (draft !== undefined && Object.values(draft).some(filled))
  );
}

/** The keys among `keys` that have non-blank draft text for the framework. */
export function draftTextIn(
  state: State,
  frameworkId: string,
  keys: string[],
): string[] {
  if (!hasOwn(state.drafts, frameworkId)) return [];
  const draft = state.drafts[frameworkId];
  return keys.filter((key) => hasOwn(draft, key) && filled(draft[key]));
}

export function selectedFramework(state: State): Framework | null {
  return loadedFrameworks(state).find((f) => f.id === state.selectedId) ?? null;
}

/** `framework`'s draft with every section present, empty when unset. */
export function draftOf(
  framework: Framework,
  stored: Record<string, string> | undefined,
): Record<string, string> {
  const draft = stored ?? {};
  // Own-property check: a section key such as `constructor` must not read
  // Object.prototype through a plain object.
  return Object.fromEntries(
    framework.sections.map((section) => [
      section.key,
      hasOwn(draft, section.key) ? draft[section.key] : "",
    ]),
  );
}

/** The selected framework's draft with every section present, empty when unset. */
export function currentDraft(state: State): Record<string, string> {
  const framework = selectedFramework(state);
  if (framework === null) return {};
  return draftOf(framework, state.drafts[framework.id]);
}

/**
 * The prompt for `framework` and a draft, or an empty string when the
 * template does not parse. Only a custom framework could carry such a
 * template; its editor reports the errors, and a selector must not throw
 * inside a render.
 */
export function renderPrompt(
  framework: Framework,
  draft: Record<string, string>,
): string {
  try {
    return renderTemplate(framework.template, draft);
  } catch (error) {
    if (error instanceof TemplateSyntaxError) return "";
    throw error;
  }
}

/** The prompt for the selected framework and its draft; see `renderPrompt`. */
export function renderedPrompt(state: State): string {
  const framework = selectedFramework(state);
  if (framework === null) return "";
  return renderPrompt(framework, currentDraft(state));
}

/** True while no section has visible text, so there is nothing to copy or save. */
export function isBlank(state: State): boolean {
  return Object.values(currentDraft(state)).every((v) => v.trim() === "");
}

/**
 * True when there is a prompt to save and it differs from the one last
 * saved for this framework.
 */
export function needsSave(state: State): boolean {
  if (state.selectedId === null || isBlank(state)) return false;
  const prompt = renderedPrompt(state);
  return prompt !== "" && state.lastSaved[state.selectedId] !== prompt;
}

/** The selected framework's title, empty when none has been typed. */
export function currentTitle(state: State): string {
  const id = state.selectedId;
  if (id === null || !hasOwn(state.titles, id)) return "";
  return state.titles[id];
}

/** True when any framework has a non-blank section or title. */
export function hasAnyDraftText(state: State): boolean {
  return (
    Object.values(state.titles).some(filled) ||
    Object.values(state.drafts).some((draft) => hasText(undefined, draft))
  );
}

/** True when `frameworkId` has a section with text or a title in the Builder. */
export function hasDraftFor(state: State, frameworkId: string): boolean {
  return hasText(
    hasOwn(state.titles, frameworkId) ? state.titles[frameworkId] : undefined,
    hasOwn(state.drafts, frameworkId) ? state.drafts[frameworkId] : undefined,
  );
}

/**
 * What opening `entry` in the Builder would overwrite: the draft and title
 * of the entry's framework, and the selected project (when any draft has
 * text, since that text was written under it).
 */
export function openConflicts(
  state: State,
  entry: PromptEntry,
): { replacesDraft: boolean; changesProject: boolean } {
  const id = entry.frameworkId;
  return {
    replacesDraft: id !== null && hasDraftFor(state, id),
    changesProject:
      hasAnyDraftText(state) &&
      openedProject(state, entry) !== state.selectedProjectId,
  };
}

/**
 * The project opening `entry` selects: its own while the list loads, since
 * projectsLoaded checks it then, else its own if listed, else none.
 */
export function openedProject(state: State, entry: PromptEntry): string | null {
  return state.projects.status === "loading"
    ? entry.projectId
    : projectIfPresent(listedProjects(state), entry.projectId);
}

/**
 * Labels of the entry's sections that have text but no section with the
 * same key in `framework` (all of them when there is no framework).
 */
export function unplacedSections(
  entry: PromptEntry,
  framework: Framework | null,
): string[] {
  return entry.frameworkSnapshot.sections
    .filter((section) => {
      const text = hasOwn(entry.sectionValues, section.key)
        ? entry.sectionValues[section.key]
        : "";
      const placed =
        framework?.sections.some((s) => s.key === section.key) ?? false;
      return text.trim() !== "" && !placed;
    })
    .map((section) => section.label);
}
