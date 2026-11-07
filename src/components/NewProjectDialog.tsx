import { useId, useRef, useState } from "react";
import { useAppActions } from "../state/AppState";
import { FolderText } from "./FolderText";
import { fieldLabel, secondaryButton } from "./styles";
import { TextFieldDialog } from "./TextFieldDialog";

type OpenProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Where focus goes on closing, for a dialog opened without a trigger. */
  onCloseAutoFocus?(event: Event): void;
};

/**
 * Asks for a name and, optionally, a folder, and creates a project, which
 * becomes the selected one.
 */
export function NewProjectDialog({ onOpenChange, ...props }: OpenProps) {
  const { createProject, pickFolder } = useAppActions();
  const folderLabelId = useId();
  const [folder, setFolder] = useState<string | null>(null);

  // Bumped on every opening and closing, so a pick that was started before
  // one is dropped when it resolves. `choosing` allows one chooser at a time.
  const generation = useRef(0);
  const choosing = useRef(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooseButton = useRef<HTMLButtonElement>(null);

  function reset() {
    generation.current += 1;
    choosing.current = false;
    setChooserOpen(false);
    setFolder(null);
  }

  async function choose() {
    if (choosing.current) return;
    choosing.current = true;
    setChooserOpen(true);
    const started = generation.current;
    try {
      const picked = await pickFolder();
      if (started === generation.current && picked !== null) setFolder(picked);
    } finally {
      if (started === generation.current) {
        choosing.current = false;
        setChooserOpen(false);
      }
    }
  }

  return (
    <TextFieldDialog
      {...props}
      // Every opening and closing starts from no folder, as the name does.
      onOpenChange={(open) => {
        reset();
        onOpenChange(open);
      }}
      title="New project"
      description="Prompts you copy or save are filed under the selected project."
      fieldLabel="Name"
      submitLabel="Create"
      initialValue=""
      onSubmit={(name) => createProject(name, folder)}
    >
      <div role="group" aria-labelledby={folderLabelId}>
        <span id={folderLabelId} className={fieldLabel}>
          Folder
        </span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <FolderText folder={folder} className="min-w-0 flex-1 text-sm" />
          <button
            type="button"
            className={secondaryButton}
            ref={chooseButton}
            aria-disabled={chooserOpen}
            onClick={() => void choose()}
          >
            Choose folder…
          </button>
          {folder !== null && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setFolder(null);
                chooseButton.current?.focus();
              }}
            >
              Clear folder
            </button>
          )}
        </div>
      </div>
    </TextFieldDialog>
  );
}
