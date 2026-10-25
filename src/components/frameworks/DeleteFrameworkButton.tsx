import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { Framework } from "../../bindings/Framework";
import { useAppState } from "../../state/AppState";
import { hasDraftFor } from "../../state/reducer";
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
  /** A saved custom framework. */
  framework: Framework;
  /** True while a save or delete is under way: Delete does nothing then. */
  disabled: boolean;
  /** Deletes the framework; the question has been answered. */
  onDelete(): void;
};

/**
 * Deletes a custom framework after asking. Its saved prompts stay in History,
 * and the Builder's draft for it is discarded, which the question says when
 * there is one.
 */
export function DeleteFrameworkButton({
  framework,
  disabled,
  onDelete,
}: Props) {
  const state = useAppState();
  const hasDraft = hasDraftFor(state, framework.id);

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Delete ${framework.name}`}
          aria-disabled={disabled || undefined}
          className={secondaryButton}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          Delete
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content className={dialogPanel}>
          <AlertDialog.Title className={dialogTitle}>
            Delete {framework.name}?
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={`${dialogDescription} flex flex-col gap-1`}>
              <p>Its saved prompts stay in History.</p>
              {hasDraft && (
                <p>Your {framework.name} draft will be discarded.</p>
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
              <button type="button" className={dangerButton} onClick={onDelete}>
                Delete
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
