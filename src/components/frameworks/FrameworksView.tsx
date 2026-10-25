import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useReducer, useRef, useState } from "react";
import type { Framework } from "../../bindings/Framework";
import type { FrameworkInput } from "../../bindings/FrameworkInput";
import {
  blankEditor,
  copyOf,
  editorFor,
  editorReducer,
  hasErrors,
  isDirty,
  markSaved,
  toInput,
  validate,
  type EditorAction,
  type EditorState,
} from "../../frameworks/frameworkEditor";
import {
  useAppActions,
  useAppDispatch,
  useAppState,
} from "../../state/AppState";
import { draftTextIn, liveFrameworks } from "../../state/reducer";
import { LoadErrorPanel } from "../LoadErrorPanel";
import {
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  primaryButton,
  secondaryButton,
} from "../styles";
import { DeleteFrameworkButton } from "./DeleteFrameworkButton";
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { FrameworkEditor } from "./FrameworkEditor";
import { FrameworkList } from "./FrameworkList";

/** The editor pane: what is open, and how it was opened. */
type Pane = {
  editor: EditorState | null;
  /** Counts openings, so each one mounts a fresh form. */
  opening: number;
  focusName: boolean;
  /** Whether Save has been tried, after which errors show as they change. */
  tried: boolean;
};

type PaneAction =
  | EditorAction
  | { type: "opened"; editor: EditorState | null; focusName: boolean }
  | { type: "saveTried" }
  | {
      type: "saved";
      /** The opening the save was made from. */
      opening: number;
      sent: FrameworkInput;
      framework: Framework;
    };

function paneReducer(pane: Pane, action: PaneAction): Pane {
  switch (action.type) {
    case "opened":
      return {
        editor: action.editor,
        opening: pane.opening + 1,
        focusName: action.focusName,
        tried: false,
      };
    case "saveTried":
      return { ...pane, tried: true };
    case "saved":
      // Only if the editor saved from is still the one open: New and Copy
      // both open an editor with no source.
      if (pane.editor === null || pane.opening !== action.opening) return pane;
      return {
        ...pane,
        editor: markSaved(pane.editor, action.framework, action.sent),
      };
    default:
      if (pane.editor === null) return pane;
      return { ...pane, editor: editorReducer(pane.editor, action) };
  }
}

const closed: Pane = {
  editor: null,
  opening: 0,
  focusName: false,
  tried: false,
};

/** Asked before a Save that drops sections with text in the Builder's draft. */
type Removal = {
  input: FrameworkInput;
  opening: number;
  name: string;
  labels: string[];
};

/**
 * The Frameworks tab: the list on the left, about 200 px wide, and the
 * editor on the right, each scrolling on its own. Nothing is open on
 * arrival. Leaving a framework with unsaved changes, here or by changing
 * tabs, asks first; the app state carries what the tabs need to ask.
 */
export function FrameworksView() {
  const state = useAppState();
  const appDispatch = useAppDispatch();
  const { saveFramework } = useAppActions();
  const [pane, dispatch] = useReducer(paneReducer, closed);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [saving, setSaving] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  // True from Save until the backend answers, so a second click of a double
  // click is ignored; `saving` only marks the button once it renders.
  const busy = useRef(false);
  // The button that opened a dialog, for focus to return to: these dialogs
  // have no trigger of their own.
  const asker = useRef<HTMLElement | null>(null);

  const { editor } = pane;
  const live = liveFrameworks(state);
  const source =
    editor === null || editor.sourceId === null
      ? undefined
      : live.find((f) => f.id === editor.sourceId);
  const dirty = editor !== null && isDirty(editor);
  const editing = editor !== null && !editor.readOnly;
  const name = editor?.name.trim() ?? "";

  useEffect(() => {
    appDispatch({
      type: "editingChanged",
      editing: editing ? { dirty, name } : null,
    });
  }, [appDispatch, editing, dirty, name]);

  useEffect(
    () => () => appDispatch({ type: "editingChanged", editing: null }),
    [appDispatch],
  );

  if (state.frameworks.status === "loading") {
    return (
      <p
        role="status"
        className="p-6 text-sm text-slate-500 dark:text-slate-400"
      >
        Loading frameworks…
      </p>
    );
  }
  if (state.frameworks.status === "error") {
    return <LoadErrorPanel message={state.frameworks.message} />;
  }

  /** Runs `leave` now, or after the user agrees to drop unsaved changes. */
  function guard(leave: () => void, from: HTMLElement) {
    if (!dirty) return leave();
    asker.current = from;
    setLeaving(() => leave);
  }

  /**
   * Returns focus to the button that opened a dialog, unless what the dialog
   * did has put it somewhere already, such as Name in a new framework.
   */
  function returnFocus(event: Event) {
    event.preventDefault();
    const active = document.activeElement;
    if (active === null || active === document.body) asker.current?.focus();
    asker.current = null;
  }

  function open(next: EditorState | null, focusName = false) {
    dispatch({ type: "opened", editor: next, focusName });
  }

  /** Names taken by other live frameworks. */
  function takenNames(exceptId: string | null): string[] {
    return live.filter((f) => f.id !== exceptId).map((f) => f.name);
  }

  async function store(
    sourceId: string | null,
    input: FrameworkInput,
    opening: number,
  ) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const framework = await saveFramework(sourceId, input);
      if (framework === null) return;
      dispatch({ type: "saved", opening, sent: input, framework });
      appDispatch({ type: "toastAdded", kind: "info", message: "Saved" });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function save(from: HTMLElement) {
    if (editor === null || busy.current) return;
    // A label still being typed counts, as if its field had lost focus.
    const commits: EditorAction[] = editor.sections
      .filter((s) => !s.committed && s.label.trim() !== "")
      .map((s) => ({ type: "labelCommitted", row: s.id }));
    const next = commits.reduce(editorReducer, editor);
    for (const commit of commits) dispatch(commit);
    dispatch({ type: "saveTried" });
    if (hasErrors(validate(next, takenNames(next.sourceId)))) return;

    const input = toInput(next);
    if (source !== undefined) {
      const removed = source.sections.filter(
        (s) => !input.sections.some((kept) => kept.key === s.key),
      );
      const withText = draftTextIn(
        state,
        source.id,
        removed.map((s) => s.key),
      );
      if (withText.length > 0) {
        asker.current = from;
        setRemoval({
          input,
          opening: pane.opening,
          name: source.name,
          labels: removed
            .filter((s) => withText.includes(s.key))
            .map((s) => s.label),
        });
        return;
      }
    }
    void store(next.sourceId, input, pane.opening);
  }

  const errors =
    editor !== null && pane.tried
      ? validate(editor, takenNames(editor.sourceId))
      : null;

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Framework list"
        className="flex w-50 shrink-0 flex-col overflow-y-auto p-4"
      >
        <FrameworkList
          frameworks={live}
          selectedId={editor?.sourceId ?? null}
          newButtonRef={newButton}
          onSelect={(framework, from) => {
            if (framework.id === editor?.sourceId) return;
            guard(() => open(editorFor(framework)), from);
          }}
          onNew={(from) => guard(() => open(blankEditor(), true), from)}
        />
      </section>
      <div className="w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
      <section
        aria-label="Framework editor"
        className="min-w-0 flex-1 overflow-y-auto p-6"
      >
        {editor === null ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Select a framework to see it, or make a new one with New framework.
          </p>
        ) : (
          <FrameworkEditor
            key={pane.opening}
            editor={editor}
            dispatch={dispatch}
            errors={errors}
            focusName={pane.focusName}
            saving={saving}
            onSave={save}
            onCopy={
              source &&
              ((from) =>
                guard(() => open(copyOf(source, takenNames(null)), true), from))
            }
            deleteButton={
              source?.isCustom && (
                <DeleteFrameworkButton
                  framework={source}
                  onDeleted={() => {
                    open(null);
                    newButton.current?.focus();
                  }}
                />
              )
            }
          />
        )}
      </section>

      <DiscardChangesDialog
        open={leaving !== null}
        name={editor?.name ?? ""}
        onKeep={() => setLeaving(null)}
        onDiscard={() => {
          leaving?.();
          setLeaving(null);
        }}
        onCloseAutoFocus={returnFocus}
      />

      <AlertDialog.Root
        open={removal !== null}
        onOpenChange={(next) => {
          if (!next) setRemoval(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={dialogOverlay} />
          <AlertDialog.Content
            className={dialogPanel}
            onCloseAutoFocus={returnFocus}
          >
            <AlertDialog.Title className={dialogTitle}>
              Remove sections with draft text?
            </AlertDialog.Title>
            <AlertDialog.Description className={dialogDescription}>
              Your {removal?.name} draft has text in{" "}
              {removal?.labels.join(", ")}. Saving will discard it.
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
                  className={primaryButton}
                  onClick={() => {
                    if (removal !== null && source !== undefined) {
                      void store(source.id, removal.input, removal.opening);
                    }
                  }}
                >
                  Save
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
