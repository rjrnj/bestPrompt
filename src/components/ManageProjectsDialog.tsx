import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { Project } from "../bindings/Project";
import { useAppActions, useAppState } from "../state/AppState";
import { ProjectNameDialog } from "./NewProjectDialog";
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

/** The projects, each with Rename and Delete. Prompts are never deleted. */
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
  const { renameProject, deleteProject } = useAppActions();
  const [renaming, setRenaming] = useState(false);

  // The buttons read the same on every row; their accessible names add the
  // project's, so a screen reader can tell them apart.
  const named = (verb: string) => `${verb} ${project.name}`;

  return (
    <li className="flex items-center gap-2 py-2">
      <span
        data-testid="project-name"
        className="min-w-0 flex-1 text-sm wrap-break-word"
      >
        {project.name}
      </span>
      <ProjectNameDialog
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
        submitLabel="Rename"
        initialName={project.name}
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
    </li>
  );
}
