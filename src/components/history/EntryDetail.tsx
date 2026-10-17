import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { useEffect, useRef, useState } from "react";
import type { PromptEntry } from "../../bindings/PromptEntry";
import { writeText } from "../../clipboard";
import { entryLabel } from "../../history/label";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { useHistory } from "../../state/HistoryState";
import { ProjectSelect } from "../ProjectSelect";
import { TextFieldDialog } from "../TextFieldDialog";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  secondaryButton,
} from "../styles";

type View = "sections" | "prompt";

const toggleItem =
  "px-3 py-1 text-sm font-medium text-slate-700 first:rounded-l-md last:rounded-r-md hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 data-[state=on]:bg-sky-100 data-[state=on]:text-sky-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:data-[state=on]:bg-sky-900 dark:data-[state=on]:text-sky-100";

/** The reading pane: the selected saved prompt, with its actions. */
export function EntryDetail() {
  const { frameworks } = useAppState();
  const { state } = useHistory();
  const entry = state.entries.find((e) => e.id === state.selectedId);

  // Set once a delete succeeds: the pane then shows the hint, and focus
  // goes there instead of falling to the page.
  const focusHint = useRef(false);
  const hint = useRef<HTMLParagraphElement>(null);
  const hasEntry = entry !== undefined;
  useEffect(() => {
    if (!hasEntry && focusHint.current) {
      focusHint.current = false;
      hint.current?.focus();
    }
  }, [hasEntry]);

  if (entry === undefined) {
    return (
      <p
        ref={hint}
        tabIndex={-1}
        className="text-sm text-slate-600 focus:outline-none dark:text-slate-400"
      >
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
      onDeleted={() => {
        focusHint.current = true;
      }}
    />
  );
}

function Detail({
  entry,
  label,
  onDeleted,
}: {
  entry: PromptEntry;
  label: string;
  onDeleted(): void;
}) {
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
            const ok = await remove(entry.id);
            if (ok) onDeleted();
            return ok;
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
        <pre
          data-testid="saved-prompt"
          className="rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm wrap-break-word whitespace-pre-wrap text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
    <TextFieldDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={secondaryButton}>
          Rename
        </button>
      }
      title="Rename prompt"
      description="Leave the title empty to label the prompt by its text."
      fieldLabel="Title"
      submitLabel="Save"
      initialValue={entry.title ?? ""}
      allowBlank
      onSubmit={(title) =>
        setTitle(entry.id, title.trim() === "" ? null : title)
      }
    />
  );
}

function DeleteDialog({ onDelete }: { onDelete(): Promise<boolean> }) {
  // Set while a delete runs, so reopening the dialog can't start a second.
  const deleting = useRef(false);
  const confirmed = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button type="button" ref={trigger} className={secondaryButton}>
          Delete
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content
          className={dialogPanel}
          onCloseAutoFocus={(event) => {
            // After a confirmed delete the trigger is usually gone, so focus
            // is placed once the outcome is known (below, or by the pane).
            if (confirmed.current) event.preventDefault();
          }}
        >
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
                onClick={() => {
                  if (deleting.current) return;
                  deleting.current = true;
                  confirmed.current = true;
                  void onDelete()
                    .then((ok) => {
                      if (!ok) {
                        confirmed.current = false;
                        trigger.current?.focus();
                      }
                    })
                    .finally(() => {
                      deleting.current = false;
                    });
                }}
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
