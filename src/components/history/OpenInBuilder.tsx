import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useId } from "react";
import { flushSync } from "react-dom";
import type { PromptEntry } from "../../bindings/PromptEntry";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { openConflicts, unplacedSections } from "../../state/reducer";
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
 * would replace the framework's draft or move the drafts to another project;
 * unavailable when the entry's framework is no longer loaded.
 */
export function OpenInBuilder({ entry }: { entry: PromptEntry }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const noteId = useId();

  const framework =
    state.frameworks.status === "ready"
      ? (state.frameworks.items.find((f) => f.id === entry.frameworkId) ?? null)
      : null;

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
  const projects =
    state.projects.status === "ready" ? state.projects.items : [];
  const projectName =
    projects.find((p) => p.id === entry.projectId)?.name ?? "No project";

  function open() {
    // Rendered at once, so the Builder's title is showing to take focus;
    // this button goes away with the History tab.
    flushSync(() => dispatch({ type: "entryOpened", entry }));
    document.getElementById(TITLE_INPUT_ID)?.focus();
    const unplaced = unplacedSections(entry, framework);
    if (unplaced.length > 0) {
      dispatch({
        type: "toastAdded",
        kind: "info",
        message: `Opened. Not placed: ${unplaced.join(", ")}; they are still in History.`,
      });
    }
  }

  if (!replacesDraft && !changesProject) {
    return (
      <button type="button" className={primaryButton} onClick={open}>
        Open in Builder
      </button>
    );
  }

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button type="button" className={primaryButton}>
          Open in Builder
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content className={dialogPanel}>
          <AlertDialog.Title className={dialogTitle}>
            Open in Builder?
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={`${dialogDescription} flex flex-col gap-1`}>
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
              <button type="button" className={primaryButton} onClick={open}>
                Open
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
