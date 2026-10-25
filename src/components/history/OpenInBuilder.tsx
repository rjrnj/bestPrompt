import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Framework } from "../../bindings/Framework";
import type { PromptEntry } from "../../bindings/PromptEntry";
import {
  useAppActions,
  useAppDispatch,
  useAppState,
} from "../../state/AppState";
import {
  listedProjects,
  loadedFrameworks,
  openConflicts,
  openedProject,
  unplacedSections,
} from "../../state/reducer";
import {
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  primaryButton,
  secondaryButton,
} from "../styles";
import { TITLE_INPUT_ID } from "../TitleField";

/**
 * Loads a saved prompt into the Builder as a new draft. Asks first when that
 * would replace the framework's draft or move the drafts to another project.
 * When the entry's framework was deleted, the same dialog offers to bring it
 * back first. Unavailable when the framework is no longer loaded.
 */
export function OpenInBuilder({ entry }: { entry: PromptEntry }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { restoreFramework } = useAppActions();
  const noteId = useId();
  const [bringingBack, setBringingBack] = useState(false);
  // True from the click that starts a bring-back until it has finished; the
  // button only disables once `bringingBack` renders, which is too late for
  // the second click of a double click.
  const running = useRef(false);

  const framework =
    loadedFrameworks(state).find((f) => f.id === entry.frameworkId) ?? null;

  if (framework === null) {
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={noteId}
          className={primaryButton}
        >
          Open in Builder
        </button>
        <p
          id={noteId}
          className="w-full text-sm text-slate-600 dark:text-slate-400"
        >
          This prompt&apos;s framework is no longer available.
        </p>
      </>
    );
  }

  const { replacesDraft, changesProject } = openConflicts(state, entry);
  const target = openedProject(state, entry);
  // While the projects load, the entry's project is kept before the list
  // can name it.
  const projectName =
    target === null
      ? "No project"
      : (listedProjects(state).find((p) => p.id === target)?.name ??
        "this prompt's project");

  const deleted = framework.deletedAt !== null;
  // Taken here, where the framework is known to be loaded; the async
  // function below can't rely on that check.
  const { id: frameworkId, name: shownName } = framework;

  /** Opens the entry into `live`: the framework itself, or as brought back. */
  function open(live: Framework) {
    // Rendered at once, so the Builder's title is showing to take focus;
    // this button goes away with the History tab.
    flushSync(() => dispatch({ type: "entryOpened", entry }));
    document.getElementById(TITLE_INPUT_ID)?.focus();
    const unplaced = unplacedSections(entry, live);
    if (unplaced.length > 0) {
      dispatch({
        type: "toastAdded",
        kind: "info",
        message: `Opened. Not placed: ${unplaced.join(", ")}; they are still in History.`,
      });
    }
  }

  async function bringBackAndOpen() {
    if (running.current) return;
    running.current = true;
    setBringingBack(true);
    try {
      const restored = await restoreFramework(frameworkId);
      if (restored === null) return;
      open(restored);
      if (restored.name !== shownName) {
        dispatch({
          type: "toastAdded",
          kind: "info",
          message: `Brought back as ${restored.name}.`,
        });
      }
    } finally {
      running.current = false;
      setBringingBack(false);
    }
  }

  if (!deleted && !replacesDraft && !changesProject) {
    return (
      <button
        type="button"
        className={primaryButton}
        onClick={() => open(framework)}
      >
        Open in Builder
      </button>
    );
  }

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          type="button"
          aria-disabled={bringingBack || undefined}
          className={primaryButton}
          onClick={(event) => {
            if (bringingBack) event.preventDefault();
          }}
        >
          Open in Builder
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content className={dialogPanel}>
          <AlertDialog.Title className={dialogTitle}>
            {deleted ? `Bring back ${framework.name}?` : "Open in Builder?"}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={`${dialogDescription} flex flex-col gap-1`}>
              {deleted && (
                <p>
                  {framework.name} was deleted. Bring it back and open this
                  prompt?
                </p>
              )}
              {replacesDraft && (
                <p>Your current {framework.name} draft will be replaced.</p>
              )}
              {changesProject && (
                <p>Your unsaved drafts will be filed under {projectName}.</p>
              )}
            </div>
          </AlertDialog.Description>
          <div className={dialogButtons}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={secondaryButton}>
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={primaryButton}
                onClick={deleted ? bringBackAndOpen : () => open(framework)}
              >
                {deleted ? "Bring back and open" : "Open"}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
