import { useRef, useState } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import { ManageProjectsDialog } from "./ManageProjectsDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectSelect } from "./ProjectSelect";

/**
 * The Builder's project, which new prompts are filed under, with New
 * project… and Manage projects… at the end of its list. While the projects
 * are loading or failed to load it offers only No project.
 */
export function ProjectPicker() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [dialog, setDialog] = useState<"new" | "manage" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const projects =
    state.projects.status === "ready" ? state.projects.items : [];

  const onOpenChange = (open: boolean) => {
    if (!open) setDialog(null);
  };
  // The dialogs open from a list item rather than a trigger of their own, so
  // they hand focus back to the picker as they close.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };

  return (
    <>
      <ProjectSelect
        ref={trigger}
        label="Project"
        projects={projects}
        value={state.selectedProjectId}
        onChange={(id) => dispatch({ type: "projectSelected", id })}
        extraItems={[
          {
            value: "new",
            label: "New project…",
            onSelect: () => setDialog("new"),
          },
          {
            value: "manage",
            label: "Manage projects…",
            onSelect: () => setDialog("manage"),
          },
        ]}
      />
      <NewProjectDialog
        open={dialog === "new"}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={returnFocus}
      />
      <ManageProjectsDialog
        open={dialog === "manage"}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={returnFocus}
      />
    </>
  );
}
