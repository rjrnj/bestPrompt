import { useAppActions } from "../state/AppState";
import { TextFieldDialog } from "./TextFieldDialog";

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
    <TextFieldDialog
      {...props}
      title="New project"
      description="Prompts you copy or save are filed under the selected project."
      fieldLabel="Name"
      submitLabel="Create"
      initialValue=""
      onSubmit={createProject}
    />
  );
}
