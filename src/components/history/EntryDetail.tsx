import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { useId, useState } from "react";
import type { PromptEntry } from "../../bindings/PromptEntry";
import { writeText } from "../../clipboard";
import { entryLabel } from "../../history/label";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { useHistory } from "../../state/HistoryState";
import { ProjectSelect } from "../ProjectSelect";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  fieldLabel,
  primaryButton,
  secondaryButton,
  textInput,
} from "../styles";

type View = "sections" | "prompt";

const toggleItem =
  "px-3 py-1 text-sm font-medium text-slate-700 first:rounded-l-md last:rounded-r-md hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 data-[state=on]:bg-sky-100 data-[state=on]:text-sky-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:data-[state=on]:bg-sky-900 dark:data-[state=on]:text-sky-100";

/** The reading pane: the selected saved prompt, with its actions. */
export function EntryDetail() {
  const { frameworks } = useAppState();
  const { state } = useHistory();
  const entry = state.entries.find((e) => e.id === state.selectedId);

  if (entry === undefined) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Select a prompt to read it.
      </p>
    );
  }
  const frameworkItems = frameworks.status === "ready" ? frameworks.items : [];
  // Keyed so the Sections | Prompt choice starts over for each entry.
  return (
    <Detail
      key={entry.id}
      entry={entry}
      label={entryLabel(entry, frameworkItems)}
    />
  );
}

function Detail({ entry, label }: { entry: PromptEntry; label: string }) {
  const { projects } = useAppState();
  const dispatch = useAppDispatch();
  const { setProject, remove } = useHistory();
  const [view, setView] = useState<View>("sections");

  const projectItems = projects.status === "ready" ? projects.items : [];
  const project = projectItems.find((p) => p.id === entry.projectId);
  const when = new Date(entry.createdAt).toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });

  async function copy() {
    try {
      await writeText(entry.renderedPrompt);
    } catch (error) {
      dispatch({
        type: "toastAdded",
        kind: "error",
        message: `Couldn't copy to the clipboard: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }
    dispatch({ type: "toastAdded", kind: "info", message: "Copied" });
  }

  const filled = entry.frameworkSnapshot.sections.filter(
    (section) => (entry.sectionValues[section.key] ?? "").trim() !== "",
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold wrap-break-word text-slate-900 dark:text-slate-100">
          {label}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {entry.frameworkSnapshot.name} · {project?.name ?? "no project"} ·{" "}
          {when}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Open in Builder goes here, first in the row. */}
        <button type="button" className={secondaryButton} onClick={copy}>
          Copy
        </button>
        <ProjectSelect
          label="Project"
          projects={projectItems}
          value={project?.id ?? null}
          onChange={(id) => void setProject(entry.id, id)}
        />
        <RenameDialog entry={entry} />
        <DeleteDialog
          onDelete={async () => {
            await remove(entry.id);
          }}
        />
      </div>

      <ToggleGroup.Root
        type="single"
        value={view}
        onValueChange={(next) => {
          if (next === "sections" || next === "prompt") setView(next);
        }}
        aria-label="Show"
        className="flex w-fit rounded-md border border-slate-400 dark:border-slate-500"
      >
        <ToggleGroup.Item value="sections" className={toggleItem}>
          Sections
        </ToggleGroup.Item>
        <ToggleGroup.Item value="prompt" className={toggleItem}>
          Prompt
        </ToggleGroup.Item>
      </ToggleGroup.Root>

      {view === "prompt" ? (
        // Focusable because it can scroll; see PromptPreview.
        <pre
          data-testid="saved-prompt"
          tabIndex={0}
          className="overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm wrap-break-word whitespace-pre-wrap text-slate-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {entry.renderedPrompt}
        </pre>
      ) : filled.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Every section was left blank.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filled.map((section) => (
            <section key={section.key}>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {section.label}
              </h3>
              <p className="text-sm wrap-break-word whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                {entry.sectionValues[section.key]}
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sets the entry's title; submitting it empty clears it. */
function RenameDialog({ entry }: { entry: PromptEntry }) {
  const { setTitle } = useHistory();
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={secondaryButton}>
          Rename
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogPanel}>
          <Dialog.Title className={dialogTitle}>Rename prompt</Dialog.Title>
          <Dialog.Description className={dialogDescription}>
            Leave the title empty to label the prompt by its text.
          </Dialog.Description>
          {/* Mounted with the dialog, so each opening starts from the title. */}
          <TitleForm
            initialTitle={entry.title ?? ""}
            onSubmit={async (title) => {
              const next = title.trim() === "" ? null : title;
              if (await setTitle(entry.id, next)) setOpen(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TitleForm({
  initialTitle,
  onSubmit,
}: {
  initialTitle: string;
  onSubmit(title: string): Promise<void>;
}) {
  const inputId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        void onSubmit(title).finally(() => setPending(false));
      }}
    >
      <div>
        <label htmlFor={inputId} className={fieldLabel}>
          Title
        </label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={`mt-1.5 ${textInput}`}
        />
      </div>
      <div className={dialogButtons}>
        <Dialog.Close asChild>
          <button type="button" className={secondaryButton}>
            Cancel
          </button>
        </Dialog.Close>
        <button type="submit" className={primaryButton} aria-disabled={pending}>
          Save
        </button>
      </div>
    </form>
  );
}

function DeleteDialog({ onDelete }: { onDelete(): Promise<void> }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button type="button" className={secondaryButton}>
          Delete
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content className={dialogPanel}>
          <AlertDialog.Title className={dialogTitle}>
            Delete this prompt?
          </AlertDialog.Title>
          <AlertDialog.Description className={dialogDescription}>
            This can&apos;t be undone.
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
                onClick={() => void onDelete()}
              >
                Delete
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
