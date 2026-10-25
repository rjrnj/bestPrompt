import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  secondaryButton,
} from "../styles";

type Props = {
  open: boolean;
  /** The framework's name as typed; blank reads as "this framework". */
  name: string;
  onKeep(): void;
  onDiscard(): void;
  /** Where focus goes on closing; the dialog is opened without a trigger. */
  onCloseAutoFocus?(event: Event): void;
};

/**
 * Asks before leaving a framework with unsaved changes, from the list or by
 * changing tabs. Keep editing has the focus, so Enter keeps the changes.
 */
export function DiscardChangesDialog({
  open,
  name,
  onKeep,
  onDiscard,
  onCloseAutoFocus,
}: Props) {
  const shown = name.trim() === "" ? "this framework" : name.trim();
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content
          className={dialogPanel}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <AlertDialog.Title className={dialogTitle}>
            Discard changes to {shown}?
          </AlertDialog.Title>
          <AlertDialog.Description className={dialogDescription}>
            The changes you haven&apos;t saved will be lost.
          </AlertDialog.Description>
          <div className={dialogButtons}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={secondaryButton}>
                Keep editing
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={dangerButton}
                onClick={onDiscard}
              >
                Discard
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
