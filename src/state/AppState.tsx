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
  useState,
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
  getSettings,
  latestEntryProject,
  listFrameworks,
  listProjects,
  openHelp as openHelpPage,
  pickFolder as pickFolderCommand,
  renameProject as renameProjectCommand,
  restoreFramework as restoreFrameworkCommand,
  savePromptEntry,
  setProjectFolder as setProjectFolderCommand,
  setSetting,
  updateFramework,
} from "../api";
import type { FolderPurpose } from "../bindings/FolderPurpose";
import type { Framework } from "../bindings/Framework";
import type { FrameworkInput } from "../bindings/FrameworkInput";
import type { HelpPage } from "../bindings/HelpPage";
import type { NewPromptEntry } from "../bindings/NewPromptEntry";
import type { Project } from "../bindings/Project";
import type { SessionEvent } from "../bindings/SessionEvent";
import type { Setting } from "../bindings/Setting";
import type { StartedSession } from "../bindings/StartedSession";
import { writeText } from "../clipboard";
import { hasOwn } from "../hasOwn";
import { currentPlatform, pasteKeys } from "../terminal/keys";
import {
  DEFAULT_SETTINGS,
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
  /**
   * Saves the entry unless already saved, then starts Claude Code for its
   * project with the prompt in Claude's input box. A prompt that can't be
   * passed is copied instead, as is one whose session turns out to be
   * running or starting by the time the save is done. Does nothing while
   * the project's session is running: nothing is ever typed into a session.
   */
  send: (entry: NewPromptEntry) => Promise<void>;
  /** Creates a project and selects it. False, after a toast, when it fails. */
  createProject: (name: string, folder: string | null) => Promise<boolean>;
  /** Renames a project. False, after a toast, when it fails. */
  renameProject: (id: string, name: string) => Promise<boolean>;
  /** Sets or, with null, clears a project's folder. False, after a toast, when it fails. */
  setProjectFolder: (id: string, folder: string | null) => Promise<boolean>;
  /**
   * Asks for a folder, straight away; the default purpose is a project's
   * folder. Null when cancelled or, after a toast, when it fails.
   */
  pickFolder: (purpose?: FolderPurpose) => Promise<string | null>;
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
  /**
   * Changes a setting at once and saves it. If saving fails, says so in a
   * toast and keeps the new value for this run.
   */
  saveSetting: (setting: Setting) => Promise<void>;
  /**
   * Looks for Claude Code again, re-reading the environment. Ignored while
   * a look is under way, and takes at least `MIN_LOOK_MS` so the look can
   * be seen. True when Claude Code was found; false when it wasn't, when
   * the look failed (after a toast) or when it was ignored.
   */
  lookAgain: () => Promise<boolean>;
  /** Puts the install command on the clipboard and toasts the result. */
  copyInstallCommand: (command: string) => Promise<void>;
  /** Opens a help page in the browser; toasts if that fails. */
  openHelp: (page: HelpPage) => Promise<void>;
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

/** How long a Look again shows as looking at least, in milliseconds. */
const MIN_LOOK_MS = 400;

/** What the missing-Claude view shows of its Look again; see `useLookAgain`. */
export type LookAgainState = {
  /** Whether a Look again is under way. */
  lookingAgain: boolean;
  /** When the last Look again found Claude Code still missing, as text. */
  lastCheckedAt: string | null;
};

const StateContext = createContext<State | null>(null);
const LookAgainContext = createContext<LookAgainState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);
const ActionsContext = createContext<AppActions | null>(null);

/** What the folder explainer dialog needs; see `useFolderExplainer`. */
export type FolderExplainer = {
  open: boolean;
  /**
   * Answers the question: true to go on to the chooser, false to cancel.
   * Does nothing while the dialog isn't open.
   */
  answer: (choose: boolean) => void;
  /** What had the focus when the dialog opened, to give it back. */
  opener: { current: Element | null };
};
const FolderExplainerContext = createContext<FolderExplainer | null>(null);

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

  const pickFolder = useCallback(
    async (purpose: FolderPurpose = "project"): Promise<string | null> => {
      try {
        return await pickFolderCommand(purpose);
      } catch (error) {
        dispatch(toast("error", messageOf(error)));
        return null;
      }
    },
    [],
  );

  // The explainer's state is the view's, not the reducer's: whether it is
  // open, and the question being asked, which later requests share.
  const [folderExplainerOpen, setFolderExplainerOpen] = useState(false);
  const explainerOpener = useRef<Element | null>(null);
  const [lookingAgain, setLookingAgain] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  // `pick` is the folder the answer leads to, so that everyone who joins the
  // question while it is open gets it from the one chooser.
  const folderQuestion = useRef<{
    pick: Promise<string | null>;
    resolve: (choose: boolean) => void;
  } | null>(null);

  const answerFolderExplainer = useCallback((choose: boolean) => {
    const question = folderQuestion.current;
    if (question === null) return;
    folderQuestion.current = null;
    setFolderExplainerOpen(false);
    question.resolve(choose);
  }, []);

  /**
   * Explains the folder, then opens Claude's chooser. Null if declined.
   * A request made while the explainer is open shares its answer and pick.
   */
  const pickFolderForClaude = useCallback((): Promise<string | null> => {
    if (folderQuestion.current !== null) return folderQuestion.current.pick;
    let resolve!: (choose: boolean) => void;
    const answer = new Promise<boolean>((r) => (resolve = r));
    const pick = answer.then((choose) =>
      choose ? pickFolder("claude") : null,
    );
    folderQuestion.current = { pick, resolve };
    explainerOpener.current = document.activeElement;
    setFolderExplainerOpen(true);
    return pick;
  }, [pickFolder]);

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

  // The settings load without blocking anything; if they can't be read, the
  // defaults stand in.
  useEffect(() => {
    let current = true;
    getSettings().then(
      (settings) => {
        if (current) dispatch({ type: "settingsLoaded", settings });
      },
      () => {
        if (current) {
          dispatch({ type: "settingsLoaded", settings: DEFAULT_SETTINGS });
        }
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const saveSetting = useCallback(async (setting: Setting) => {
    dispatch({ type: "settingChanged", setting });
    try {
      await setSetting(setting);
    } catch (error) {
      dispatch(
        toast("error", `Couldn't save the setting: ${messageOf(error)}`),
      );
    }
  }, []);

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

  const lookingRef = useRef(false);
  const lookAgain = useCallback(async () => {
    if (lookingRef.current) return false;
    lookingRef.current = true;
    setLookingAgain(true);
    const shown = new Promise((resolve) => setTimeout(resolve, MIN_LOOK_MS));
    let found = false;
    try {
      const status = await detectClaude().finally(() => shown);
      found = status.found;
      setLastCheckedAt(
        found
          ? null
          : new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
      );
      dispatch({ type: "claudeDetected", found });
    } catch (error) {
      dispatch(toast("error", messageOf(error)));
    } finally {
      lookingRef.current = false;
      setLookingAgain(false);
    }
    return found;
  }, []);

  const copyInstallCommand = useCallback(async (command: string) => {
    try {
      await writeText(command);
      dispatch(toast("info", "Copied."));
    } catch (error) {
      dispatch(
        toast("error", `Couldn't copy to the clipboard: ${messageOf(error)}`),
      );
    }
  }, []);

  const openHelp = useCallback(async (page: HelpPage) => {
    try {
      await openHelpPage(page);
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
        return pickFolderForClaude();
      }
      const project = listedProjects(latest.current).find((p) => p.id === key);
      if (!choose && project !== undefined && project.folder !== null) {
        return project.folder;
      }
      const picked = await pickFolderForClaude();
      // Cancelled, or closed or deleted while the chooser was open: there
      // is nothing to save it on.
      if (picked === null || cancelledKeys.current.has(key)) return null;
      return (await setProjectFolder(key, picked)) ? picked : null;
    },
    [pickFolderForClaude, setProjectFolder],
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
      // Rendered at once, so `latest` has the session, and any exit that
      // came early, before the key is free again: an action waiting
      // meanwhile, such as a send whose save has just finished, then sees
      // it instead of starting over it, and a send sees whether its
      // session is still running.
      const exit = earlyExit as { code: number | null } | null;
      flushSync(() => {
        // Only a prompt Claude took as a prefill is waiting in the session.
        const sent = started.prefilled ? prompt : undefined;
        dispatch({ type: "sessionStarted", key, id, folder, sent });
        dispatch({ type: "drawerToggled", open: true });
        if (exit !== null) {
          dispatch({ type: "sessionExited", key, id, code: exit.code });
        }
      });
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

  /** Copies `prompt` and toasts `copied`, or why it couldn't be copied. */
  const copyPrompt = useCallback(async (prompt: string, copied: string) => {
    try {
      await writeText(prompt);
    } catch (error) {
      dispatch(
        toast("error", `Couldn't copy to the clipboard: ${messageOf(error)}`),
      );
      return;
    }
    dispatch(toast("info", copied));
  }, []);

  const send = useCallback(
    async (entry: NewPromptEntry) => {
      if (busy.current) return;
      const key = entry.projectId ?? NO_PROJECT_KEY;
      // Starting would end the running session and its conversation.
      if (sessionOf(key)?.state === "running") return;
      busy.current = true;
      try {
        // A failed save doesn't stop the send; it is reported after it.
        const result = await persist(entry);
        // Checked again after the save, with no await before the start,
        // which claims the key at once: a session that started, or began
        // starting, meanwhile is never replaced.
        let started: StartedSession | null = null;
        const keys = pasteKeys(currentPlatform());
        if (sessionOf(key)?.state === "running") {
          await copyPrompt(
            entry.renderedPrompt,
            `Claude Code is already running, so your prompt is copied. Paste it into Claude with ${keys}.`,
          );
        } else if (busyKeys.current.has(key)) {
          await copyPrompt(
            entry.renderedPrompt,
            `Claude Code is already starting, so your prompt is copied. Paste it into Claude with ${keys} once it's ready.`,
          );
        } else {
          started = await startSession(key, { prompt: entry.renderedPrompt });
        }
        if (started?.prefilled === true) {
          const session = sessionOf(key);
          if (session?.id !== started.id || session.state !== "running") {
            // It ended at once, taking the prompt with it.
            await copyPrompt(
              entry.renderedPrompt,
              "Claude Code ended before your prompt could run, so it's copied.",
            );
          } else {
            // The drawer is open by now, but it shows the selected project:
            // after a switch, the terminal isn't there to focus.
            const { terminalFor } = await terminals();
            const selected = latest.current.selectedProjectId ?? NO_PROJECT_KEY;
            if (selected === key) terminalFor(started.id)?.focus();
          }
        } else if (started !== null) {
          // Too long, or a form Claude can't be handed: it started without
          // the prompt, which goes on the clipboard for pasting.
          await copyPrompt(
            entry.renderedPrompt,
            `Claude Code couldn't take this prompt directly, so it's copied. Paste it into Claude with ${keys}.`,
          );
        }
        if (typeof result === "object") {
          dispatch(
            toast("error", `Couldn't save to History: ${result.failed}`),
          );
        }
      } finally {
        busy.current = false;
      }
    },
    [copyPrompt, persist, sessionOf, startSession],
  );

  const actions = useMemo<AppActions>(
    () => ({
      loadFrameworks,
      copy,
      save,
      send,
      createProject,
      renameProject,
      setProjectFolder,
      pickFolder,
      deleteProject,
      saveFramework,
      deleteFramework,
      pruneDeletedFrameworks,
      restoreFramework,
      saveSetting,
      lookAgain,
      copyInstallCommand,
      openHelp,
      startSession,
      chooseFolderAndStart,
      closeSession,
      restartSession,
    }),
    [
      loadFrameworks,
      copy,
      save,
      send,
      createProject,
      renameProject,
      setProjectFolder,
      pickFolder,
      deleteProject,
      saveFramework,
      deleteFramework,
      pruneDeletedFrameworks,
      restoreFramework,
      saveSetting,
      lookAgain,
      copyInstallCommand,
      openHelp,
      startSession,
      chooseFolderAndStart,
      closeSession,
      restartSession,
    ],
  );

  const lookAgainState = useMemo(
    () => ({ lookingAgain, lastCheckedAt }),
    [lookingAgain, lastCheckedAt],
  );
  const folderExplainer = useMemo(
    () => ({
      open: folderExplainerOpen,
      answer: answerFolderExplainer,
      opener: explainerOpener,
    }),
    [folderExplainerOpen, answerFolderExplainer],
  );

  return (
    <StateContext value={state}>
      <DispatchContext value={dispatch}>
        <ActionsContext value={actions}>
          <LookAgainContext value={lookAgainState}>
            <FolderExplainerContext value={folderExplainer}>
              {children}
            </FolderExplainerContext>
          </LookAgainContext>
        </ActionsContext>
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

/** Whether a Look again is under way and its last answer; only the missing-Claude view needs it. */
export function useLookAgain(): LookAgainState {
  return useRequired(LookAgainContext, "useLookAgain");
}

/** The folder explainer's state; only its dialog needs it. */
export function useFolderExplainer(): FolderExplainer {
  return useRequired(FolderExplainerContext, "useFolderExplainer");
}
