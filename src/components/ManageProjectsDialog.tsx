import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import type { Project } from "../bindings/Project";
import { hasOwn } from "../hasOwn";
import { useAppActions, useAppState } from "../state/AppState";
import { FolderText } from "./FolderText";
import { TextFieldDialog } from "./TextFieldDialog";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  secondaryButton,
} from "./styles";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Where focus goes on closing; the dialog is opened without a trigger. */
  onCloseAutoFocus?(event: Event): void;
};

/** The projects, each with Rename, Delete and its folder. Prompts are never deleted. */
export function ManageProjectsDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={dialogPanel}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Dialog.Title className={dialogTitle}>Manage projects</Dialog.Title>
          <Dialog.Description className={dialogDescription}>
            Renaming or deleting a project keeps its prompts.
          </Dialog.Description>
          <ProjectList />
          <div className={dialogButtons}>
            <Dialog.Close asChild>
              <button type="button" className={secondaryButton}>
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectList() {
  const { projects } = useAppState();
  const message = "text-sm text-slate-600 dark:text-slate-400";
  if (projects.status === "loading") {
    return <p className={message}>Loading projects…</p>;
  }
  if (projects.status === "error") {
    return (
      <p className={message}>
        Couldn&apos;t load the projects: {projects.message}
      </p>
    );
  }
  if (projects.items.length === 0) {
    return <p className={message}>No projects yet.</p>;
  }
  return (
    <ul className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">
      {projects.items.map((project) => (
        <ProjectRow key={project.id} project={project} />
      ))}
    </ul>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const { renameProject, deleteProject, setProjectFolder, pickFolder } =
    useAppActions();
  const { sessions } = useAppState();
  const hasSession =
    hasOwn(sessions, project.id) && sessions[project.id].state === "running";
  const folderButton = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);

  // The buttons read the same on every row; their accessible names add the
  // project's, so a screen reader can tell them apart.
  const named = (verb: string) => `${verb} ${project.name}`;

  // The folder buttons are unavailable while a pick or a save is pending.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function change(run: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // A cancelled chooser changes nothing.
  const chooseFolder = () =>
    change(async () => {
      const folder = await pickFolder();
      if (folder !== null) await setProjectFolder(project.id, folder);
    });

  // The name and folder take a line of their own when the four buttons don't
  // fit beside them; the buttons then wrap under it.
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <div className="min-w-48 flex-1">
        <span
          data-testid="project-name"
          className="block text-sm wrap-break-word"
        >
          {project.name}
        </span>
        <FolderText folder={project.folder} className="block text-xs" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={`Folder… for ${project.name}`}
          ref={folderButton}
          className={secondaryButton}
          aria-disabled={busy}
          onClick={() => void chooseFolder()}
        >
          Folder…
        </button>
        {project.folder !== null && (
          <button
            type="button"
            aria-label={`Clear folder of ${project.name}`}
            className={secondaryButton}
            aria-disabled={busy}
            onClick={() =>
              void change(async () => {
                // The button is about to go; keep focus in this row.
                folderButton.current?.focus();
                await setProjectFolder(project.id, null);
              })
            }
          >
            Clear folder
          </button>
        )}
        <TextFieldDialog
          open={renaming}
          onOpenChange={setRenaming}
          trigger={
            <button
              type="button"
              aria-label={named("Rename")}
              className={secondaryButton}
            >
              Rename
            </button>
          }
          title="Rename project"
          description="Its prompts stay filed under it."
          fieldLabel="Name"
          submitLabel="Rename"
          initialValue={project.name}
          onSubmit={(name) =>
            name.trim() === project.name
              ? Promise.resolve(true)
              : renameProject(project.id, name)
          }
        />
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild>
            <button
              type="button"
              aria-label={named("Delete")}
              className={secondaryButton}
            >
              Delete
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className={dialogOverlay} />
            <AlertDialog.Content className={dialogPanel}>
              <AlertDialog.Title className={dialogTitle}>
                Delete “{project.name}”?
              </AlertDialog.Title>
              <AlertDialog.Description className={dialogDescription}>
                Its prompts move to No project. No prompts are deleted.
                {hasSession && " Its Claude Code session will end."}
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
                    className={dangerButton}
                    onClick={() => void deleteProject(project.id)}
                  >
                    Delete
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </li>
  );
}
