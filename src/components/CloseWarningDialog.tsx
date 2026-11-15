import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { closeWarning, type CloseWarning } from "../closeWarning";
import {
  useAppDispatch,
  useAppState,
  useStartingKeys,
} from "../state/AppState";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  secondaryButton,
} from "./styles";

type Line = { kind: "sessions" | "drafts" | "frameworkEdits"; text: string };

/** The lines the dialog shows for `warning`, in order. */
export function closeWarningLines(warning: CloseWarning): Line[] {
  const lines: Line[] = [];
  if (warning.sessions > 0) {
    lines.push({
      kind: "sessions",
      text:
        warning.sessions === 1
          ? "1 Claude Code session will end."
          : `${warning.sessions} Claude Code sessions will end.`,
    });
  }
  if (warning.drafts) {
    lines.push({
      kind: "drafts",
      text: "Unsaved Builder drafts will be lost.",
    });
  }
  if (warning.frameworkEdits !== null) {
    const name = warning.frameworkEdits.name.trim();
    lines.push({
      kind: "frameworkEdits",
      text:
        name === ""
          ? "Unsaved changes to a framework will be lost."
          : `Unsaved changes to ${name} will be lost.`,
    });
  }
  return lines;
}

/**
 * Asks before the window closes when that would end Claude Code sessions or
 * lose unsaved work; closes without asking otherwise. Quit closes the
 * window, and the app's exit ends the sessions. Cancel, Escape or any other
 * way of closing the dialog keeps everything as it was.
 */
export function CloseWarningDialog() {
  const state = useAppState();
  const startingKeys = useStartingKeys();
  const dispatch = useAppDispatch();
  const [asking, setAsking] = useState(false);
  // While asking, the lines come from the state as it is now. If nothing is
  // left to lose, the dialog closes.
  const warning = asking ? closeWarning(state, startingKeys()) : null;

  // What a close request reads, for the one listener: the state as of the
  // last render (starting keys are read live through their getter), and
  // whether the dialog is open, which changes the moment it is shown.
  const latest = useRef({ state, startingKeys });
  const shown = useRef(false);
  useEffect(() => {
    latest.current = { state, startingKeys };
  });

  const show = (next: boolean) => {
    shown.current = next;
    setAsking(next);
  };
  // Adjusting state while rendering is React's way to follow a derived
  // value; the ref catches up once the render commits.
  if (asking && warning === null) setAsking(false);
  useEffect(() => {
    shown.current = asking;
  }, [asking]);

  const quit = () => {
    show(false);
    getCurrentWindow()
      .destroy()
      .catch((error: unknown) => {
        dispatch({
          type: "toastAdded",
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };
  // The listener is set up once, so it calls these through a ref.
  const actions = useRef({ show, quit });
  useEffect(() => {
    actions.current = { show, quit };
  });

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onCloseRequested((event) => {
        try {
          const found = closeWarning(
            latest.current.state,
            latest.current.startingKeys(),
          );
          if (shown.current) {
            // Asking already: a close request never closes behind the
            // dialog. When nothing is left to lose, it quits as the button
            // would.
            event.preventDefault();
            if (found === null) actions.current.quit();
            return;
          }
          // With nothing to lose the window is destroyed as usual.
          if (found === null) return;
          event.preventDefault();
          actions.current.show(true);
        } catch (error) {
          // Not preventing the close lets the window close as it would
          // without this warning.
          console.warn("The close request could not be checked:", error);
        }
      })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        console.warn("The close warning could not be set up:", error);
      });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  return (
    <AlertDialog.Root
      open={warning !== null}
      onOpenChange={(next) => {
        if (!next) show(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content className={dialogPanel}>
          <AlertDialog.Title className={dialogTitle}>
            Quit bestPrompt?
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={dialogDescription}>
              {warning !== null &&
                closeWarningLines(warning).map(({ kind, text }) => (
                  <p key={kind}>{text}</p>
                ))}
            </div>
          </AlertDialog.Description>
          <div className={dialogButtons}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={secondaryButton}>
                Cancel
              </button>
            </AlertDialog.Cancel>
            <button type="button" className={dangerButton} onClick={quit}>
              Quit
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
