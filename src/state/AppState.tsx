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
  ApiError,
  claudeStatus,
  closeSession as closeSessionCommand,
  createFramework,
  createProject as createProjectCommand,
  deleteFramework as deleteFrameworkCommand,
  deleteProject as deleteProjectCommand,
  detectClaude,
  latestEntryProject,
  listFrameworks,
  listProjects,
  pickFolder as pickFolderCommand,
  renameProject as renameProjectCommand,
  restoreFramework as restoreFrameworkCommand,
  savePromptEntry,
  setProjectFolder as setProjectFolderCommand,
  updateFramework,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { FrameworkInput } from "../bindings/FrameworkInput";
import type { NewPromptEntry } from "../bindings/NewPromptEntry";
import type { Project } from "../bindings/Project";
import type { SessionEvent } from "../bindings/SessionEvent";
import type { StartedSession } from "../bindings/StartedSession";
import { writeText } from "../clipboard";
import { hasOwn } from "../hasOwn";
import {
  initialStateFor,
  listedProjects,
  NO_PROJECT_KEY,
  reducer,
  type Action,
  type Session,
  type State,
  type Toast,
} from "./reducer";

// xterm.js loads with the first session, not with the app.
const terminals = () => import("../terminal/terminals");

/**
 * Drops a session's terminal. The module is already loaded whenever a
 * terminal exists, so a failed load here only means there is none to drop.
 */
async function disposeTerminalOf(id: string): Promise<void> {
  try {
    (await terminals()).disposeTerminal(id);
  } catch (error) {
    console.error("Could not load the terminal code", error);
  }
}

/** The backend's words when a session's folder has gone. */
const FOLDER_MISSING = "That folder no longer exists.";

/** The async operations components can start. */
export type AppActions = {
  loadFrameworks: () => Promise<void>;
  /** Copies the entry's prompt, then saves the entry unless already saved. */
  copy: (entry: NewPromptEntry) => Promise<void>;
  /** Saves the entry without copying, unless already saved. */
  save: (entry: NewPromptEntry) => Promise<void>;
  /** Creates a project and selects it. False, after a toast, when it fails. */
  createProject: (name: string, folder: string | null) => Promise<boolean>;
  /** Renames a project. False, after a toast, when it fails. */
  renameProject: (id: string, name: string) => Promise<boolean>;
  /** Sets or, with null, clears a project's folder. False, after a toast, when it fails. */
  setProjectFolder: (id: string, folder: string | null) => Promise<boolean>;
  /** Asks for a folder. Null when cancelled or, after a toast, when it fails. */
  pickFolder: () => Promise<string | null>;
  /** Deletes a project. False, after a toast, when it fails. */
  deleteProject: (id: string) => Promise<boolean>;
  /**
   * Creates the framework (`id` null) or edits it, and keeps the list in step
   * without reloading. Null, after a toast, when it fails.
   */
  saveFramework: (
    id: string | null,
    input: FrameworkInput,
  ) => Promise<Framework | null>;
  /** Deletes a framework. False, after a toast, when it fails. */
  deleteFramework: (id: string) => Promise<boolean>;
  /**
   * Drops the deleted frameworks the backend no longer lists, which are the
   * ones with no saved prompts left. Returns at once; stays quiet on failure.
   */
  pruneDeletedFrameworks: () => void;
  /** Restores a deleted framework. Null, after a toast, when it fails. */
  restoreFramework: (id: string) => Promise<Framework | null>;
  /** Looks for Claude Code again. */
  lookAgain: () => Promise<void>;
  /**
   * Starts Claude Code for `key` (a project id, or `NO_PROJECT_KEY`) and
   * opens the drawer. It runs in the project's folder; No project reuses
   * the folder of its last session. Without one it asks, and saves the
   * answer on the project (No project keeps it for this session only).
   * Replaces any session `key` already has. Null when the pick is
   * cancelled or, after a toast, when starting fails.
   */
  startSession: (
    key: string,
    options?: { prompt?: string },
  ) => Promise<StartedSession | null>;
  /** As `startSession`, but always asks for the folder first. */
  chooseFolderAndStart: (key: string) => Promise<StartedSession | null>;
  /**
   * Ends `key`'s session, if it has one, and drops its terminal; a session
   * still starting is ended as soon as it has, and a close already under
   * way is waited for. False, after a toast, when it couldn't be closed.
   */
  closeSession: (key: string) => Promise<boolean>;
  /**
   * Ends `key`'s session and starts a new one in the folder a fresh start
   * would use, found (or asked for) before the session ends.
   */
  restartSession: (key: string) => Promise<StartedSession | null>;
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
  const [state, dispatch] = useReducer(
    reducer,
    window.innerHeight,
    initialStateFor,
  );
  // The latest state, for the session actions, which read it across awaits.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
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
  // newest entry becomes the starting selection when it is in the list and
  // the user hasn't chosen one meanwhile; the reducer checks both. The two
  // lookups run together, and a failed one means no starting project.
  useEffect(() => {
    let current = true;
    const latest = latestEntryProject().catch(() => null);
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
      const id = await latest;
      if (current) dispatch({ type: "startingProjectFound", id });
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

  const pickFolder = useCallback(async (): Promise<string | null> => {
    try {
      return await pickFolderCommand();
    } catch (error) {
      dispatch(toast("error", messageOf(error)));
      return null;
    }
  }, []);

  const createProject = useCallback(
    (name: string, folder: string | null) =>
      projectAction(async () => ({
        type: "projectCreated",
        project: await createProjectCommand(name, folder),
      })),
    [projectAction],
  );

  const renameProject = useCallback(
    (id: string, name: string) =>
      projectAction(async () => ({
        type: "projectUpdated",
        project: await renameProjectCommand(id, name),
      })),
    [projectAction],
  );

  const setProjectFolder = useCallback(
    (id: string, folder: string | null) =>
      projectAction(async () => ({
        type: "projectUpdated",
        project: await setProjectFolderCommand(id, folder),
      })),
    [projectAction],
  );

  // The backend answers once its startup detection is done. A failed call
  // can only be the bridge itself; it counts as not found, which offers
  // Look again.
  useEffect(() => {
    let current = true;
    claudeStatus().then(
      (status) => {
        if (current) dispatch({ type: "claudeDetected", found: status.found });
      },
      () => {
        if (current) dispatch({ type: "claudeDetected", found: false });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const lookAgain = useCallback(async () => {
    try {
      const status = await detectClaude();
      dispatch({ type: "claudeDetected", found: status.found });
    } catch (error) {
      dispatch(toast("error", messageOf(error)));
    }
  }, []);

  // The folder of each key's last session, which No project starts in
  // again; projects use the folder saved on them.
  const lastFolders = useRef(new Map<string, string>());
  // Keys with a start, restart or close under way, so a second click can't
  // start a second session for the same key; each settles once its work
  // has finished.
  const busyKeys = useRef(new Map<string, Promise<void>>());
  // Keys whose session is being closed, with whether the close succeeds.
  const closingKeys = useRef(new Map<string, Promise<boolean>>());
  // Busy keys whose session was closed, or whose project was deleted,
  // meanwhile: a session that starts for one is ended at once, since
  // nothing would show it or could close it.
  const cancelledKeys = useRef(new Set<string>());

  /** Runs `run` for `key`, or returns `idle` if `key` is already busy. */
  const exclusive = useCallback(
    async <T,>(key: string, run: () => Promise<T>, idle: T): Promise<T> => {
      if (busyKeys.current.has(key)) return idle;
      let finished!: () => void;
      busyKeys.current.set(key, new Promise((resolve) => (finished = resolve)));
      try {
        return await run();
      } finally {
        busyKeys.current.delete(key);
        cancelledKeys.current.delete(key);
        finished();
      }
    },
    [],
  );

  /**
   * The folder to start `key`'s session in: the saved or last one unless
   * `choose`, else one picked now and, for a project, saved on it. Null
   * when cancelled or when the save failed, after a toast.
   */
  const folderFor = useCallback(
    async (key: string, choose: boolean): Promise<string | null> => {
      if (key === NO_PROJECT_KEY) {
        const last = lastFolders.current.get(key);
        if (!choose && last !== undefined) return last;
        return pickFolder();
      }
      const project = listedProjects(latest.current).find((p) => p.id === key);
      if (!choose && project !== undefined && project.folder !== null) {
        return project.folder;
      }
      const picked = await pickFolder();
      // Cancelled, or closed or deleted while the chooser was open: there
      // is nothing to save it on.
      if (picked === null || cancelledKeys.current.has(key)) return null;
      return (await setProjectFolder(key, picked)) ? picked : null;
    },
    [pickFolder, setProjectFolder],
  );

  /**
   * Ends `session`, `key`'s current one: closes it if it is still running
   * (one that ended meanwhile is fine), then drops its terminal. False,
   * after a toast, when it couldn't be closed; it is kept then.
   */
  const endSession = useCallback(
    async (key: string, session: Session): Promise<boolean> => {
      const ending = (async () => {
        if (session.state === "running") {
          try {
            await closeSessionCommand(session.id);
          } catch (error) {
            if (!(error instanceof ApiError && error.kind === "notFound")) {
              dispatch(toast("error", messageOf(error)));
              return false;
            }
          }
        }
        await disposeTerminalOf(session.id);
        dispatch({ type: "sessionClosed", key });
        return true;
      })();
      closingKeys.current.set(key, ending);
      try {
        return await ending;
      } finally {
        if (closingKeys.current.get(key) === ending) {
          closingKeys.current.delete(key);
        }
      }
    },
    [],
  );

  /** Ends a session that started for a key cancelled meanwhile. */
  const discard = useCallback(async (id: string) => {
    try {
      await closeSessionCommand(id);
    } catch (error) {
      // One that has already ended is fine.
      if (!(error instanceof ApiError && error.kind === "notFound")) {
        console.error("Could not end the session", error);
      }
    }
    await disposeTerminalOf(id);
  }, []);

  /** `key`'s session, if it has one. */
  const sessionOf = useCallback((key: string): Session | null => {
    const { sessions } = latest.current;
    return hasOwn(sessions, key) ? sessions[key] : null;
  }, []);

  /** Starts `key`'s session in `folder`, ending any it has first. */
  const launch = useCallback(
    async (
      key: string,
      folder: string,
      prompt: string | undefined,
    ): Promise<StartedSession | null> => {
      const old = sessionOf(key);
      if (old !== null && !(await endSession(key, old))) return null;
      if (cancelledKeys.current.has(key)) return null;
      // The exit can arrive before the id does; it waits for it here.
      let id: string | null = null;
      let earlyExit: { code: number | null } | null = null;
      const onEvent = (event: SessionEvent) => {
        if (event.type !== "exited") return;
        if (id === null) earlyExit = { code: event.code };
        else dispatch({ type: "sessionExited", key, id, code: event.code });
      };
      let started: StartedSession;
      try {
        const { startTerminalSession } = await terminals();
        started = await startTerminalSession(folder, onEvent, { prompt });
      } catch (error) {
        dispatch(toast("error", messageOf(error)));
        if (error instanceof ApiError) {
          if (error.kind === "invalid" && error.message === FOLDER_MISSING) {
            // The drawer offers Choose folder…, so it shows.
            dispatch({ type: "sessionFolderMissing", key });
            dispatch({ type: "drawerToggled", open: true });
          } else if (error.kind === "notFound") {
            // Claude Code has gone since it was found.
            dispatch({ type: "claudeDetected", found: false });
          }
        }
        return null;
      }
      if (cancelledKeys.current.has(key)) {
        await discard(started.id);
        return null;
      }
      id = started.id;
      lastFolders.current.set(key, folder);
      dispatch({ type: "sessionStarted", key, id, folder });
      dispatch({ type: "drawerToggled", open: true });
      const exit = earlyExit as { code: number | null } | null;
      if (exit !== null) {
        dispatch({ type: "sessionExited", key, id, code: exit.code });
      }
      return started;
    },
    [discard, endSession, sessionOf],
  );

  const startSession = useCallback(
    (key: string, options?: { prompt?: string }) =>
      exclusive(
        key,
        async () => {
          const folder = await folderFor(key, false);
          if (folder === null) return null;
          return launch(key, folder, options?.prompt);
        },
        null,
      ),
    [exclusive, folderFor, launch],
  );

  const chooseFolderAndStart = useCallback(
    (key: string) =>
      exclusive(
        key,
        async () => {
          const folder = await folderFor(key, true);
          if (folder === null) return null;
          return launch(key, folder, undefined);
        },
        null,
      ),
    [exclusive, folderFor, launch],
  );

  const closeSession = useCallback(
    async (key: string): Promise<boolean> => {
      for (;;) {
        const busy = busyKeys.current.get(key);
        if (busy === undefined) {
          return exclusive(
            key,
            async () => {
              const session = sessionOf(key);
              return session === null || (await endSession(key, session));
            },
            true,
          );
        }
        // Whatever is under way for the key stops at its next step.
        cancelledKeys.current.add(key);
        // A close under way: its result is this one's.
        const closing = closingKeys.current.get(key);
        if (closing !== undefined) return closing;
        // A start with no session yet: its session is ended as soon as it
        // has started.
        if (sessionOf(key) === null) return true;
        // A session that the work under way may yet end, or leave, as a
        // restart whose pick is cancelled does: wait, then end what is left.
        await busy;
      }
    },
    [exclusive, endSession, sessionOf],
  );

  const restartSession = useCallback(
    (key: string) =>
      exclusive(
        key,
        async () => {
          // Found before the session ends, as a fresh start would find it:
          // a folder that can't be found, or a cancelled pick, leaves the
          // session running.
          const folder = await folderFor(key, false);
          if (folder === null) return null;
          return launch(key, folder, undefined);
        },
        null,
      ),
    [exclusive, folderFor, launch],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      // Its session ends first: nothing could reach it once the project is
      // gone. If it can't be ended (after a toast), the project stays.
      if (!(await closeSession(id))) return false;
      return projectAction(async () => {
        await deleteProjectCommand(id);
        return { type: "projectDeleted", id };
      });
    },
    [closeSession, projectAction],
  );

  /**
   * Runs a framework command and dispatches the action for the framework it
   * returns. On failure toasts and returns null; a framework that no longer
   * exists gets its own words rather than the backend's.
   */
  const frameworkAction = useCallback(
    async (
      run: () => Promise<Framework>,
      type: "frameworkSaved" | "frameworkDeleted" | "frameworkRestored",
    ): Promise<Framework | null> => {
      let framework: Framework;
      try {
        framework = await run();
      } catch (error) {
        const missing = error instanceof ApiError && error.kind === "notFound";
        dispatch(
          toast(
            "error",
            missing ? "That framework no longer exists." : messageOf(error),
          ),
        );
        return null;
      }
      dispatch({ type, framework });
      return framework;
    },
    [],
  );

  const saveFramework = useCallback(
    (id: string | null, input: FrameworkInput) =>
      frameworkAction(
        () =>
          id === null ? createFramework(input) : updateFramework(id, input),
        "frameworkSaved",
      ),
    [frameworkAction],
  );

  const pruneDeletedFrameworks = useCallback(() => {
    // The list leaves out a deleted framework that has no saved prompts, which
    // the marked copy here doesn't show. Read the list again without waiting
    // for it, and drop only the deleted frameworks it no longer has, so a save
    // that lands meanwhile isn't undone. If the read fails, the list stays as
    // it was.
    listFrameworks().then(
      (frameworks) =>
        dispatch({
          type: "deletedFrameworksPruned",
          listedIds: frameworks.map((f) => f.id),
        }),
      () => {},
    );
  }, []);

  const deleteFramework = useCallback(
    async (id: string) => {
      const deleted = await frameworkAction(
        () => deleteFrameworkCommand(id),
        "frameworkDeleted",
      );
      if (deleted === null) return false;
      pruneDeletedFrameworks();
      return true;
    },
    [frameworkAction, pruneDeletedFrameworks],
  );

  const restoreFramework = useCallback(
    (id: string) =>
      frameworkAction(() => restoreFrameworkCommand(id), "frameworkRestored"),
    [frameworkAction],
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
      setProjectFolder,
      pickFolder,
      deleteProject,
      saveFramework,
      deleteFramework,
      pruneDeletedFrameworks,
      restoreFramework,
      lookAgain,
      startSession,
      chooseFolderAndStart,
      closeSession,
      restartSession,
    }),
    [
      loadFrameworks,
      copy,
      save,
      createProject,
      renameProject,
      setProjectFolder,
      pickFolder,
      deleteProject,
      saveFramework,
      deleteFramework,
      pruneDeletedFrameworks,
      restoreFramework,
      lookAgain,
      startSession,
      chooseFolderAndStart,
      closeSession,
      restartSession,
    ],
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
