import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { hasOwn } from "../../hasOwn";
import {
  useAppActions,
  useAppDispatch,
  useAppState,
  useLookAgain,
} from "../../state/AppState";
import {
  listedProjects,
  NO_PROJECT_KEY,
  type Session,
} from "../../state/reducer";
import { installCommand } from "../../terminal/install";
import { currentPlatform } from "../../terminal/keys";
import { VIEWS_TABLIST_ID } from "../AppTabs";
import { FolderText } from "../FolderText";
import { SHOW_DRAWER_ID } from "../PromptActions";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  linkButton,
  primaryButton,
  secondaryButton,
} from "../styles";
import { drawerShare, heightFor, minShare, steppedShare } from "./drawerHeight";
import { SessionTerminal } from "./SessionTerminal";
import { WaitingNote } from "./WaitingNote";

const smallButton =
  "rounded-md border border-slate-400 bg-white px-2 py-0.5 text-xs font-medium text-slate-900 not-aria-disabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:not-aria-disabled:hover:bg-slate-700";
const message = "text-sm text-slate-600 dark:text-slate-400";
/** How far the pointer moves on the handle before a press is a drag. */
const DRAG_THRESHOLD_PX = 3;

/**
 * The Claude Code drawer under the Builder's panes: one session per
 * project, the selected project's showing. Its height is a share of
 * `area`, the Builder's content box, dragged from the handle on its top
 * edge. Renders nothing while hidden; the sessions keep running.
 */
export function ClaudeDrawer({ area }: { area: HTMLElement | null }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { drawer, claude, sessions } = state;
  const areaHeight = useAreaHeight(area, drawer.open);
  const key = state.selectedProjectId ?? NO_PROJECT_KEY;
  // The key whose session Close is ending, whose buttons then go: that
  // key's empty-state button takes the focus when it appears.
  const focusAfterClose = useRef<string | null>(null);
  const takeFocus = useCallback((forKey: string) => {
    if (focusAfterClose.current !== forKey) return false;
    focusAfterClose.current = null;
    return true;
  }, []);
  const onClose = useCallback(
    (closedKey: string, closing: Promise<boolean>) => {
      focusAfterClose.current = closedKey;
      void closing.then((closed) => {
        if (!closed && focusAfterClose.current === closedKey) {
          focusAfterClose.current = null;
        }
      });
    },
    [],
  );
  // Showing another project gives that up: the user has moved on. The new
  // project's button, mounted first, doesn't match the key.
  useEffect(() => {
    focusAfterClose.current = null;
  }, [key]);
  // A Look again the user pressed that finds Claude Code: its button goes,
  // and the Start button that replaces it takes the focus.
  const onLookAgain = useCallback(
    (lookedKey: string, looking: Promise<boolean>) => {
      focusAfterClose.current = lookedKey;
      void looking.then((found) => {
        if (!found && focusAfterClose.current === lookedKey) {
          focusAfterClose.current = null;
        }
      });
    },
    [],
  );
  const { busyKeys, runFor } = useBusyKeys();
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(drawer.open);
  // Opened by a button that goes as the drawer opens (Show Claude Code),
  // which leaves the focus on the page: the drawer takes it. A terminal
  // has already taken it as it mounted; otherwise the empty state's
  // button does, or Hide when there is none.
  useEffect(() => {
    const opened = drawer.open && !wasOpen.current;
    wasOpen.current = drawer.open;
    if (!opened) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const target =
      body.current?.querySelector<HTMLElement>("button") ??
      header.current?.querySelector<HTMLElement>("button");
    target?.focus();
  }, [drawer.open]);
  if (!drawer.open) return null;

  const session = hasOwn(sessions, key) ? sessions[key] : null;
  const project =
    key === NO_PROJECT_KEY
      ? null
      : (listedProjects(state).find((p) => p.id === key) ?? null);
  const folder = session?.folder ?? project?.folder ?? null;
  const share = drawerShare(drawer, areaHeight);
  const full = drawer.maximized;

  return (
    <section
      aria-label="Claude Code"
      // A percentage of the Builder area, so it keeps its share as the
      // window resizes; never less than the header and a few rows.
      style={{ height: `${share * 100}%` }}
      className="flex min-h-[min(120px,100%)] min-w-0 flex-none flex-col border-t border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
    >
      <ResizeHandle area={area} share={share} areaHeight={areaHeight} />
      <div
        ref={header}
        className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-1 dark:border-slate-800"
      >
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">
          claude
          {folder !== null && (
            <>
              {" · "}
              <FolderText folder={folder} className="" />
            </>
          )}
        </p>
        <button
          type="button"
          className={smallButton}
          onClick={() => {
            // The drawer goes, and this button with it; the button that
            // brings it back takes the focus, or, when there is none
            // (no framework is selected), the app's selected tab.
            flushSync(() => dispatch({ type: "drawerToggled", open: false }));
            const target =
              document.getElementById(SHOW_DRAWER_ID) ??
              document
                .getElementById(VIEWS_TABLIST_ID)
                ?.querySelector<HTMLElement>('[aria-selected="true"]');
            target?.focus();
          }}
        >
          Hide
        </button>
        <button
          type="button"
          className={smallButton}
          onClick={() => dispatch({ type: "drawerMaximizeToggled" })}
        >
          {full ? "Restore" : "Maximize"}
        </button>
        {session !== null && (
          <>
            <EndButton
              sessionKey={key}
              session={session}
              verb="Restart"
              onClose={onClose}
            />
            <EndButton
              sessionKey={key}
              session={session}
              verb="Close"
              onClose={onClose}
            />
          </>
        )}
      </div>
      <WaitingNote />
      <div ref={body} className="min-h-0 flex-1">
        <Body
          sessionKey={key}
          session={session}
          status={claude.status}
          takeFocus={takeFocus}
          onLookAgain={onLookAgain}
          busy={busyKeys.has(key)}
          runFor={runFor}
        />
      </div>
    </section>
  );
}

/**
 * Which keys have an empty-state action (start, restart, look again)
 * under way, so a button shows as busy only for the project it was
 * pressed for, and a second press is ignored.
 */
function useBusyKeys() {
  const running = useRef(new Set<string>());
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const runFor = useCallback((key: string, action: () => Promise<unknown>) => {
    if (running.current.has(key)) return;
    running.current.add(key);
    setBusyKeys(new Set(running.current));
    void action().finally(() => {
      running.current.delete(key);
      setBusyKeys(new Set(running.current));
    });
  }, []);
  return { busyKeys, runFor };
}

/** The Builder area's height in pixels, kept up to date while shown. */
function useAreaHeight(area: HTMLElement | null, open: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const box = area;
    if (!open || !box) return;
    const measure = () => setHeight(box.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [area, open]);
  return height;
}

/**
 * The drawer's top edge: drag it, or use the arrow keys, to resize the
 * drawer; double-click it to maximize or restore.
 */
function ResizeHandle({
  area,
  share,
  areaHeight,
}: {
  area: HTMLElement | null;
  share: number;
  areaHeight: number;
}) {
  const dispatch = useAppDispatch();
  // The press under way: a drag only once the pointer has moved past the
  // threshold, so a click or double-click that wobbles a pixel leaves the
  // height, and whether it is maximized, alone.
  const press = useRef<{
    pointerId: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  const box = () => area?.getBoundingClientRect();

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = press.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    if (
      !current.dragging &&
      Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    current.dragging = true;
    const rect = box();
    if (!rect) return;
    dispatch({
      type: "drawerResized",
      height: heightFor(event.clientY, rect.top, rect.height),
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction =
      event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    // Already full: nothing moves, and a maximized drawer keeps the height
    // it restores to.
    if (direction === 1 && share >= 1) return;
    const height = box()?.height ?? areaHeight;
    dispatch({
      type: "drawerResized",
      height: steppedShare(share, direction, height),
    });
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize Claude Code"
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={Math.round(minShare(areaHeight) * 100)}
      aria-valuemax={100}
      tabIndex={0}
      className="h-1.5 flex-none cursor-row-resize touch-none bg-slate-200 hover:bg-sky-300 focus-visible:bg-sky-400 focus-visible:outline-none dark:bg-slate-800 dark:hover:bg-sky-700 dark:focus-visible:bg-sky-500"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          dragging: false,
        };
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        if (press.current?.pointerId !== event.pointerId) return;
        press.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      // Capture can go without a pointerup, as when the window loses focus
      // mid-drag; the drag ends with it.
      onLostPointerCapture={() => {
        press.current = null;
      }}
      onDoubleClick={() => dispatch({ type: "drawerMaximizeToggled" })}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * Restart or Close for the session. A running one asks first, since its
 * conversation is lost; one that has ended doesn't.
 */
function EndButton({
  sessionKey,
  session,
  verb,
  onClose,
}: {
  sessionKey: string;
  session: Session;
  verb: "Restart" | "Close";
  /** Told of each close this starts, with whether it succeeded. */
  onClose: (key: string, closing: Promise<boolean>) => void;
}) {
  const { restartSession, closeSession } = useAppActions();
  const run = () => {
    if (verb === "Restart") void restartSession(sessionKey);
    else onClose(sessionKey, closeSession(sessionKey));
  };

  if (session.state === "exited") {
    return (
      <button type="button" className={smallButton} onClick={run}>
        {verb}
      </button>
    );
  }
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button type="button" className={smallButton}>
          {verb}
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content className={dialogPanel}>
          <AlertDialog.Title className={dialogTitle}>
            End this Claude Code session?
          </AlertDialog.Title>
          <AlertDialog.Description className={dialogDescription}>
            The conversation can&apos;t be brought back.
          </AlertDialog.Description>
          <div className={dialogButtons}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={secondaryButton}>
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button type="button" className={dangerButton} onClick={run}>
                {verb === "Restart" ? "Restart" : "End session"}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** The session's terminal, or what to do without one. */
function Body({
  sessionKey,
  session,
  status,
  takeFocus,
  onLookAgain,
  busy,
  runFor,
}: {
  sessionKey: string;
  session: Session | null;
  status: "unknown" | "found" | "missing";
  /** True once when `key`'s button appearing now should take the focus. */
  takeFocus: (key: string) => boolean;
  /** Told of each Look again pressed, with whether it found Claude Code. */
  onLookAgain: (key: string, looking: Promise<boolean>) => void;
  /** Whether an action for this key is under way. */
  busy: boolean;
  runFor: (key: string, action: () => Promise<unknown>) => void;
}) {
  const state = useAppState();
  const { startSession, chooseFolderAndStart, restartSession, lookAgain } =
    useAppActions();
  const { lookingAgain, lastCheckedAt } = useLookAgain();
  const missingFolder = state.missingFolders.includes(sessionKey);
  const action = (run: () => Promise<unknown>) => () => runFor(sessionKey, run);
  const takeOwnFocus = useCallback(
    () => takeFocus(sessionKey),
    [takeFocus, sessionKey],
  );

  if (session !== null) {
    // One shape whether running or ended, so the terminal isn't mounted
    // again when the session ends, which would take the focus; the ended
    // session's last screen stays above the note.
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <SessionTerminal key={session.id} sessionId={session.id} />
        </div>
        {session.state === "exited" && (
          <Note
            text={
              session.code === null
                ? "Claude Code ended."
                : `Claude Code ended (exit code ${session.code}).`
            }
          >
            <ActionButton
              busy={busy}
              onClick={action(() => restartSession(sessionKey))}
            >
              Restart
            </ActionButton>
          </Note>
        )}
      </div>
    );
  }
  if (status === "unknown") {
    return (
      <div className="p-3">
        <p className={message}>Looking for Claude Code…</p>
      </div>
    );
  }
  if (status === "missing") {
    return (
      <div className="flex h-full min-w-0 flex-col gap-2 overflow-y-auto p-3">
        <div>
          <p className={message}>
            Claude Code wasn&apos;t found. Install it, then Look again.
          </p>
          {/* Always there, so that the first answer is announced. */}
          <p role="status" className={message}>
            {lastCheckedAt !== null &&
              `Still not found. Last checked at ${lastCheckedAt}.`}
          </p>
        </div>
        <InstallCommand />
        <div className="flex flex-wrap items-center gap-3">
          <HelpLink />
          <ActionButton
            busy={lookingAgain}
            onClick={() => onLookAgain(sessionKey, lookAgain())}
            takeFocus={takeOwnFocus}
          >
            {lookingAgain ? "Looking…" : "Look again"}
          </ActionButton>
        </div>
      </div>
    );
  }
  if (missingFolder) {
    return (
      <Note text="That folder is gone. Choose another to start Claude Code in.">
        <ActionButton
          busy={busy}
          onClick={action(() => chooseFolderAndStart(sessionKey))}
          takeFocus={takeOwnFocus}
        >
          Choose folder…
        </ActionButton>
      </Note>
    );
  }
  return (
    <Note text="Claude Code is Anthropic's coding assistant. Start it here in a project's folder, and Send puts your prompt straight into it.">
      <ActionButton
        busy={busy}
        onClick={action(() => startSession(sessionKey))}
        takeFocus={takeOwnFocus}
      >
        Start Claude Code
      </ActionButton>
    </Note>
  );
}

/** The command that installs Claude Code in this system, to copy. */
function InstallCommand() {
  const { copyInstallCommand } = useAppActions();
  const { shell, command } = installCommand(currentPlatform());
  return (
    <div className="flex flex-col gap-1">
      <p className={message}>In {shell}:</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs break-all text-slate-900 dark:bg-slate-800 dark:text-slate-100">
          {command}
        </code>
        <button
          type="button"
          className={smallButton}
          aria-label="Copy install command"
          onClick={() => void copyInstallCommand(command)}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function HelpLink() {
  const { openHelp } = useAppActions();
  return (
    <button
      type="button"
      className={linkButton}
      onClick={() => void openHelp("claudeSetup")}
    >
      How to install Claude Code
    </button>
  );
}

function Note({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <p className={message}>{text}</p>
      {children}
    </div>
  );
}

/**
 * A button for an action that runs for a while; while `busy` it is
 * unavailable and ignores clicks. On appearing it takes the focus if
 * `takeFocus` says so.
 */
function ActionButton({
  busy,
  onClick,
  takeFocus,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  takeFocus?: () => boolean;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (takeFocus?.()) button.current?.focus();
  }, [takeFocus]);
  return (
    <button
      ref={button}
      type="button"
      className={primaryButton}
      aria-disabled={busy}
      onClick={() => {
        if (!busy) onClick();
      }}
    >
      {children}
    </button>
  );
}
