// The app's state: a pure reducer and the selectors that read from it. No
// React here, so all of it is tested as plain functions. The provider in
// AppState.tsx owns the async work and dispatches these actions.

import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
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
  view: "builder" | "history";
  projects:
    | { status: "loading" }
    | { status: "ready"; items: Project[] }
    | { status: "error"; message: string };
  /** The project new entries are filed under; one value for all frameworks. */
  selectedProjectId: string | null;
  saving: boolean;
  toasts: Toast[];
  nextToastId: number;
};

export type Action =
  | { type: "frameworksLoading" }
  | { type: "frameworksLoaded"; frameworks: Framework[] }
  | { type: "frameworksFailed"; message: string }
  | { type: "selectFramework"; id: string }
  | { type: "editSection"; key: string; value: string }
  | { type: "clearDraft" }
  | { type: "viewChanged"; view: State["view"] }
  | { type: "projectsLoaded"; projects: Project[] }
  | { type: "projectsFailed"; message: string }
  | { type: "projectSelected"; id: string | null }
  | { type: "projectCreated"; project: Project }
  | { type: "projectRenamed"; project: Project }
  | { type: "projectDeleted"; id: string }
  | { type: "editTitle"; value: string }
  | { type: "entryOpened"; entry: PromptEntry }
  | { type: "saveStarted" }
  | { type: "saveSucceeded"; frameworkId: string; renderedPrompt: string }
  | { type: "saveFailed"; message: string }
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
  projects: { status: "loading" },
  selectedProjectId: null,
  saving: false,
  toasts: [],
  nextToastId: 1,
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "frameworksLoading":
      return { ...state, frameworks: { status: "loading" } };
    case "frameworksLoaded": {
      const items = action.frameworks;
      const keep = items.some((f) => f.id === state.selectedId);
      return {
        ...state,
        frameworks: { status: "ready", items },
        selectedId: keep ? state.selectedId : (items[0]?.id ?? null),
      };
    }
    case "frameworksFailed":
      return {
        ...state,
        frameworks: { status: "error", message: action.message },
      };
    case "selectFramework":
      return loadedFrameworks(state).some((f) => f.id === action.id)
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
    case "projectsLoaded":
      return {
        ...state,
        projects: { status: "ready", items: sortProjects(action.projects) },
        selectedProjectId: projectIfPresent(
          action.projects,
          state.selectedProjectId,
        ),
      };
    case "projectsFailed":
      return {
        ...state,
        projects: { status: "error", message: action.message },
      };
    case "projectSelected":
      return { ...state, selectedProjectId: action.id };
    case "projectCreated":
      return {
        ...state,
        projects:
          state.projects.status === "ready"
            ? {
                status: "ready",
                items: sortProjects([...state.projects.items, action.project]),
              }
            : state.projects,
        selectedProjectId: action.project.id,
      };
    case "projectRenamed":
      return {
        ...state,
        projects:
          state.projects.status === "ready"
            ? {
                status: "ready",
                items: sortProjects(
                  state.projects.items.map((p) =>
                    p.id === action.project.id ? action.project : p,
                  ),
                ),
              }
            : state.projects,
      };
    case "projectDeleted":
      return {
        ...state,
        projects:
          state.projects.status === "ready"
            ? {
                status: "ready",
                items: state.projects.items.filter((p) => p.id !== action.id),
              }
            : state.projects,
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
      const target = loadedFrameworks(state).find(
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
        selectedProjectId: projectIfPresent(
          loadedProjects(state),
          entry.projectId,
        ),
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

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function loadedProjects(state: State): Project[] {
  return state.projects.status === "ready" ? state.projects.items : [];
}

/** Projects in name order, ignoring case, as the database lists them. */
function sortProjects(projects: Project[]): Project[] {
  const key = (p: Project) => p.name.toLowerCase();
  return [...projects].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : 1,
  );
}

/** `id` if a project with that id is in `projects`, else null. */
function projectIfPresent(
  projects: Project[],
  id: string | null,
): string | null {
  return id !== null && projects.some((p) => p.id === id) ? id : null;
}

function loadedFrameworks(state: State): Framework[] {
  return state.frameworks.status === "ready" ? state.frameworks.items : [];
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
  const filled = (text: string) => text.trim() !== "";
  return (
    Object.values(state.titles).some(filled) ||
    Object.values(state.drafts).some((draft) =>
      Object.values(draft).some(filled),
    )
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
  const filled = (text: string) => text.trim() !== "";
  const replacesDraft =
    id !== null &&
    ((hasOwn(state.titles, id) && filled(state.titles[id])) ||
      (hasOwn(state.drafts, id) &&
        Object.values(state.drafts[id]).some(filled)));
  const entryProject = projectIfPresent(loadedProjects(state), entry.projectId);
  return {
    replacesDraft,
    changesProject:
      hasAnyDraftText(state) && entryProject !== state.selectedProjectId,
  };
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
