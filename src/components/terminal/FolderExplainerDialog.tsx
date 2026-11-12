import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useFolderExplainer } from "../../state/AppState";
import {
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  primaryButton,
  secondaryButton,
} from "../styles";

/**
 * Says what Claude Code does with a folder before the chooser opens for
 * it. Choosing goes on to the chooser; Cancel, Escape or any other way of
 * closing it cancels.
 */
export function FolderExplainerDialog() {
  const { open, answer, opener } = useFolderExplainer();
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content
          className={dialogPanel}
          onCloseAutoFocus={(event) => {
            // There is no trigger to give the focus back to. After Choose
            // folder… the chooser is still to come; a start that succeeds
            // then focuses its terminal, and anything else leaves the focus
            // here.
            event.preventDefault();
            const before = opener.current;
            if (before instanceof HTMLElement && before.isConnected) {
              before.focus();
            }
          }}
        >
          <AlertDialog.Title className={dialogTitle}>
            Choose a folder for Claude Code
          </AlertDialog.Title>
          <AlertDialog.Description className={dialogDescription}>
            Claude Code works inside one folder, usually your project&apos;s. It
            can read and change files there. Choose the folder you want it to
            work in.
          </AlertDialog.Description>
          <div className={dialogButtons}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={secondaryButton}>
                Cancel
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className={primaryButton}
              onClick={() => answer(true)}
            >
              Choose folder…
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
