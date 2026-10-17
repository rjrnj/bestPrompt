import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type ReactNode } from "react";
import {
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  fieldLabel,
  primaryButton,
  secondaryButton,
  textInput,
} from "./styles";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Where focus goes on closing, for a dialog opened without a trigger. */
  onCloseAutoFocus?(event: Event): void;
  title: string;
  description: string;
  /** The label of the one text field. */
  fieldLabel: string;
  submitLabel: string;
  initialValue: string;
  /** Whether an empty (or blank) value can be submitted. */
  allowBlank?: boolean;
  /** Resolves true when done; false keeps the dialog open to try again. */
  onSubmit(value: string): Promise<boolean>;
  /** The button that opens the dialog, if it has one. */
  trigger?: ReactNode;
};

/**
 * A dialog with one text field. It closes once `onSubmit` succeeds; on a
 * failure (which the caller toasts) it stays open with the text as typed.
 * The value is passed as typed; callers trim it where that matters.
 */
export function TextFieldDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  title,
  description,
  fieldLabel: label,
  submitLabel,
  initialValue,
  allowBlank = false,
  onSubmit,
  trigger,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && (
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={dialogPanel}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Dialog.Title className={dialogTitle}>{title}</Dialog.Title>
          <Dialog.Description className={dialogDescription}>
            {description}
          </Dialog.Description>
          {/* Mounted with the dialog, so each opening starts from initialValue. */}
          <TextForm
            label={label}
            initialValue={initialValue}
            allowBlank={allowBlank}
            submitLabel={submitLabel}
            onSubmit={async (value) => {
              if (await onSubmit(value)) onOpenChange(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TextForm({
  label,
  initialValue,
  allowBlank,
  submitLabel,
  onSubmit,
}: {
  label: string;
  initialValue: string;
  allowBlank: boolean;
  submitLabel: string;
  onSubmit(value: string): Promise<void>;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const canSubmit = (allowBlank || value.trim() !== "") && !pending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setPending(true);
        void onSubmit(value).finally(() => setPending(false));
      }}
    >
      <div>
        <label htmlFor={inputId} className={fieldLabel}>
          {label}
        </label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`mt-1.5 ${textInput}`}
        />
      </div>
      <div className={dialogButtons}>
        <Dialog.Close asChild>
          <button type="button" className={secondaryButton}>
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="submit"
          className={primaryButton}
          aria-disabled={!canSubmit}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
