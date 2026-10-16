// The app's state: a pure reducer and the selectors that read from it. No
// React here, so all of it is tested as plain functions. The provider in
// AppState.tsx owns the async work and dispatches these actions.

import type { Framework } from "../bindings/Framework";
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
  | { type: "saveStarted" }
  | { type: "saveSucceeded"; frameworkId: string; renderedPrompt: string }
  | { type: "saveFailed"; message: string }
  | { type: "toastAdded"; kind: Toast["kind"]; message: string }
  | { type: "toastDismissed"; id: number };

export const initialState: State = {
  frameworks: { status: "loading" },
  selectedId: null,
  drafts: {},
  lastSaved: {},
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
      return { ...state, drafts: { ...state.drafts, [id]: {} } };
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
      return {
        ...state,
        toasts: [...state.toasts, toast],
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

function loadedFrameworks(state: State): Framework[] {
  return state.frameworks.status === "ready" ? state.frameworks.items : [];
}

export function selectedFramework(state: State): Framework | null {
  return loadedFrameworks(state).find((f) => f.id === state.selectedId) ?? null;
}

/** The selected framework's draft with every section present, empty when unset. */
export function currentDraft(state: State): Record<string, string> {
  const framework = selectedFramework(state);
  if (framework === null) return {};
  const draft = state.drafts[framework.id] ?? {};
  // Own-property check: a section key such as `constructor` must not read
  // Object.prototype through a plain object.
  return Object.fromEntries(
    framework.sections.map((section) => [
      section.key,
      hasOwn(draft, section.key) ? draft[section.key] : "",
    ]),
  );
}

/**
 * The prompt for the selected framework and its draft, or an empty string
 * when the template does not parse. Only a custom framework (Phase 4) could
 * carry such a template; the editor there reports the errors, and a
 * selector must not throw inside a render.
 */
export function renderedPrompt(state: State): string {
  const framework = selectedFramework(state);
  if (framework === null) return "";
  try {
    return renderTemplate(framework.template, currentDraft(state));
  } catch (error) {
    if (error instanceof TemplateSyntaxError) return "";
    throw error;
  }
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
