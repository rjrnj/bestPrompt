import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type ReactNode } from "react";
import { useAppActions } from "../state/AppState";
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

type OpenProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Where focus goes on closing, for a dialog opened without a trigger. */
  onCloseAutoFocus?(event: Event): void;
};

/** Asks for a name and creates a project, which becomes the selected one. */
export function NewProjectDialog(props: OpenProps) {
  const { createProject } = useAppActions();
  return (
    <ProjectNameDialog
      {...props}
      title="New project"
      description="Prompts you copy or save are filed under the selected project."
      submitLabel="Create"
      initialName=""
      onSubmit={createProject}
    />
  );
}

type NameDialogProps = OpenProps & {
  title: string;
  description: string;
  submitLabel: string;
  initialName: string;
  /** Resolves true when done; false keeps the dialog open to try again. */
  onSubmit(name: string): Promise<boolean>;
  /** The button that opens the dialog, if it has one. */
  trigger?: ReactNode;
};

/**
 * A dialog with one field for a project's name. It closes once `onSubmit`
 * succeeds; on a failure (which the app toasts) it stays open with the name
 * as typed. The backend trims and checks the name, so it is passed as typed.
 */
export function ProjectNameDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  title,
  description,
  submitLabel,
  initialName,
  onSubmit,
  trigger,
}: NameDialogProps) {
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
          {/* Mounted with the dialog, so each opening starts from initialName. */}
          <NameForm
            initialName={initialName}
            submitLabel={submitLabel}
            onSubmit={async (name) => {
              if (await onSubmit(name)) onOpenChange(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NameForm({
  initialName,
  submitLabel,
  onSubmit,
}: {
  initialName: string;
  submitLabel: string;
  onSubmit(name: string): Promise<void>;
}) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const canSubmit = name.trim() !== "" && !pending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setPending(true);
        void onSubmit(name).finally(() => setPending(false));
      }}
    >
      <div>
        <label htmlFor={inputId} className={fieldLabel}>
          Name
        </label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
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
