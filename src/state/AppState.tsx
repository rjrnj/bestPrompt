// The app's state provider. The reducer in reducer.ts is synchronous; this
// is where the async work lives (loading frameworks, copying and saving),
// each step dispatching a start, success or failure action.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Context,
  type Dispatch,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  createProject as createProjectCommand,
  deleteProject as deleteProjectCommand,
  latestEntryProject,
  listFrameworks,
  listProjects,
  renameProject as renameProjectCommand,
  savePromptEntry,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { NewPromptEntry } from "../bindings/NewPromptEntry";
import type { Project } from "../bindings/Project";
import { writeText } from "../clipboard";
import {
  initialState,
  reducer,
  type Action,
  type State,
  type Toast,
} from "./reducer";

/** The async operations components can start. */
export type AppActions = {
  loadFrameworks: () => Promise<void>;
  /** Copies the entry's prompt, then saves the entry unless already saved. */
  copy: (entry: NewPromptEntry) => Promise<void>;
  /** Saves the entry without copying, unless already saved. */
  save: (entry: NewPromptEntry) => Promise<void>;
  /** Creates a project and selects it. False, after a toast, when it fails. */
  createProject: (name: string) => Promise<boolean>;
  /** Renames a project. False, after a toast, when it fails. */
  renameProject: (id: string, name: string) => Promise<boolean>;
  /** Deletes a project. False, after a toast, when it fails. */
  deleteProject: (id: string) => Promise<boolean>;
};

const StateContext = createContext<State | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);
const ActionsContext = createContext<AppActions | null>(null);

// api.ts rejects with an ApiError, so the fallback only matters if that
// contract breaks; it keeps the failure path from ever throwing itself.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toast(kind: Toast["kind"], message: string): Action {
  return { type: "toastAdded", kind, message };
}

type SaveResult = "saved" | "unchanged" | { failed: string };

/** The toast for a save's result, in the words of the button that caused it. */
function report(
  result: SaveResult,
  words: { saved: string; unchanged: string; failed: string },
): Action {
  if (result === "saved") return toast("info", words.saved);
  if (result === "unchanged") return toast("info", words.unchanged);
  return toast("error", `${words.failed}: ${result.failed}`);
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Each load takes a number; a result is applied only if no later load has
  // started since, so overlapping loads can't finish out of order.
  const loadCount = useRef(0);

  const loadFrameworks = useCallback(async () => {
    const mine = ++loadCount.current;
    dispatch({ type: "frameworksLoading" });
    let frameworks: Framework[];
    try {
      frameworks = await listFrameworks();
    } catch (error) {
      if (mine === loadCount.current) {
        dispatch({ type: "frameworksFailed", message: messageOf(error) });
      }
      return;
    }
    if (mine === loadCount.current) {
      dispatch({ type: "frameworksLoaded", frameworks });
    }
  }, []);

  useEffect(() => {
    void loadFrameworks();
  }, [loadFrameworks]);

  // The projects load without blocking the Builder, and without a toast when
  // they fail: the Builder still works with "No project". The project of the
  // newest entry becomes the starting selection when it is in the list.
  useEffect(() => {
    let current = true;
    void (async () => {
      let projects: Project[];
      try {
        projects = await listProjects();
      } catch (error) {
        if (current) {
          dispatch({ type: "projectsFailed", message: messageOf(error) });
        }
        return;
      }
      if (!current) return;
      dispatch({ type: "projectsLoaded", projects });
      let latest: string | null;
      try {
        latest = await latestEntryProject();
      } catch {
        return;
      }
      if (current && projects.some((p) => p.id === latest)) {
        dispatch({ type: "projectSelected", id: latest });
      }
    })();
    return () => {
      current = false;
    };
  }, []);

  /** Runs a project command; on failure toasts its message and returns false. */
  const projectAction = useCallback(
    async (run: () => Promise<Action>): Promise<boolean> => {
      let action: Action;
      try {
        action = await run();
      } catch (error) {
        dispatch(toast("error", messageOf(error)));
        return false;
      }
      dispatch(action);
      return true;
    },
    [],
  );

  const createProject = useCallback(
    (name: string) =>
      projectAction(async () => ({
        type: "projectCreated",
        project: await createProjectCommand(name),
      })),
    [projectAction],
  );

  const renameProject = useCallback(
    (id: string, name: string) =>
      projectAction(async () => ({
        type: "projectRenamed",
        project: await renameProjectCommand(id, name),
      })),
    [projectAction],
  );

  const deleteProject = useCallback(
    (id: string) =>
      projectAction(async () => {
        await deleteProjectCommand(id);
        return { type: "projectDeleted", id };
      }),
    [projectAction],
  );

  // True from the click that starts a copy or save until it has finished, so
  // the second click of a double click is ignored rather than saving twice.
  // The buttons only disable once `saving` renders, which is too late.
  const busy = useRef(false);
  const { lastSaved } = state;

  /** Saves `entry` unless it is the one last saved for its framework. */
  const persist = useCallback(
    async (entry: NewPromptEntry): Promise<SaveResult> => {
      if (lastSaved[entry.frameworkId] === entry.renderedPrompt) {
        return "unchanged";
      }
      dispatch({ type: "saveStarted" });
      try {
        await savePromptEntry(entry);
      } catch (error) {
        const message = messageOf(error);
        dispatch({ type: "saveFailed", message });
        return { failed: message };
      }
      // Rendered before `busy` is released, so the next click already runs
      // with the new `lastSaved` instead of a stale copy of this callback.
      flushSync(() =>
        dispatch({
          type: "saveSucceeded",
          frameworkId: entry.frameworkId,
          renderedPrompt: entry.renderedPrompt,
        }),
      );
      return "saved";
    },
    [lastSaved],
  );

  const copy = useCallback(
    async (entry: NewPromptEntry) => {
      if (busy.current) return;
      busy.current = true;
      try {
        try {
          await writeText(entry.renderedPrompt);
        } catch (error) {
          dispatch(
            toast(
              "error",
              `Couldn't copy to the clipboard: ${messageOf(error)}`,
            ),
          );
          return;
        }
        const result = await persist(entry);
        dispatch(
          report(result, {
            saved: "Copied and saved",
            unchanged: "Copied",
            failed: "Copied, but couldn't save",
          }),
        );
      } finally {
        busy.current = false;
      }
    },
    [persist],
  );

  const save = useCallback(
    async (entry: NewPromptEntry) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await persist(entry);
        dispatch(
          report(result, {
            saved: "Saved",
            unchanged: "Already saved",
            failed: "Couldn't save",
          }),
        );
      } finally {
        busy.current = false;
      }
    },
    [persist],
  );

  const actions = useMemo<AppActions>(
    () => ({
      loadFrameworks,
      copy,
      save,
      createProject,
      renameProject,
      deleteProject,
    }),
    [loadFrameworks, copy, save, createProject, renameProject, deleteProject],
  );

  return (
    <StateContext value={state}>
      <DispatchContext value={dispatch}>
        <ActionsContext value={actions}>{children}</ActionsContext>
      </DispatchContext>
    </StateContext>
  );
}

function useRequired<T>(context: Context<T | null>, hook: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${hook} must be used inside an AppStateProvider`);
  }
  return value;
}

export function useAppState(): State {
  return useRequired(StateContext, "useAppState");
}

export function useAppDispatch(): Dispatch<Action> {
  return useRequired(DispatchContext, "useAppDispatch");
}

export function useAppActions(): AppActions {
  return useRequired(ActionsContext, "useAppActions");
}
