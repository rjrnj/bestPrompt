import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Framework } from "../../bindings/Framework";
import type { FrameworkInput } from "../../bindings/FrameworkInput";
import {
  BRACE_LABEL_ERROR,
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
  type EditorErrors,
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
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
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
  /** The name of the framework this editor is an unsaved copy of. */
  copiedFrom: string | null;
  /** Whether Save has been tried, after which errors show as they change. */
  tried: boolean;
};

type PaneAction =
  | EditorAction
  | {
      type: "opened";
      editor: EditorState | null;
      focusName: boolean;
      copiedFrom: string | null;
    }
  | { type: "saveTried" }
  | {
      type: "deleted";
      /** The opening the delete was made from. */
      opening: number;
    }
  | {
      type: "saved";
      /** The opening the save was made from. */
      opening: number;
      /** The editor as it was when Save was pressed. */
      sent: EditorState;
      framework: Framework;
    };

function paneReducer(pane: Pane, action: PaneAction): Pane {
  switch (action.type) {
    case "opened":
      return {
        editor: action.editor,
        opening: pane.opening + 1,
        focusName: action.focusName,
        copiedFrom: action.copiedFrom,
        tried: false,
      };
    case "saveTried":
      return { ...pane, tried: true };
    case "deleted":
      // Only if the editor of the deleted framework is still the one open.
      if (pane.opening !== action.opening) return pane;
      return {
        editor: null,
        opening: pane.opening + 1,
        focusName: false,
        copiedFrom: null,
        tried: false,
      };
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
  copiedFrom: null,
  tried: false,
};

/** Asked before a Save that drops sections with text in the Builder's draft. */
type Removal = {
  input: FrameworkInput;
  sent: EditorState;
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
  const { saveFramework, deleteFramework } = useAppActions();
  const [pane, dispatch] = useReducer(paneReducer, closed);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  // The name asked about, kept from when the question opened: the editor
  // shows another framework by the time the dialog has closed.
  const [askedAbout, setAskedAbout] = useState("");
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [saving, setSaving] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const editorPane = useRef<HTMLElement>(null);
  // True from Save or Delete until the backend answers, so a second click of
  // a double click is ignored, and so is one button while the other works;
  // `saving` only marks the buttons once it renders.
  const busy = useRef(false);
  // The button that opened a dialog, for focus to return to: these dialogs
  // have no trigger of their own.
  const asker = useRef<HTMLElement | null>(null);
  // The opening on screen, for a delete that finishes later to compare with.
  const showing = useRef(0);

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
    showing.current = pane.opening;
  }, [pane.opening]);

  useEffect(() => {
    appDispatch({
      type: "editingChanged",
      editing: editing ? { dirty, name, busy: saving } : null,
    });
  }, [appDispatch, editing, dirty, name, saving]);

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
    if (busy.current) return;
    if (!dirty) return leave();
    asker.current = from;
    setAskedAbout(editor?.name ?? "");
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

  async function remove(framework: Framework, opening: number) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      if (!(await deleteFramework(framework.id))) return;
      dispatch({ type: "deleted", opening });
      if (showing.current === opening) newButton.current?.focus();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function open(
    next: EditorState | null,
    focusName = false,
    copiedFrom: string | null = null,
  ) {
    dispatch({ type: "opened", editor: next, focusName, copiedFrom });
  }

  /** Names taken by other live frameworks. */
  function takenNames(exceptId: string | null): string[] {
    return live.filter((f) => f.id !== exceptId).map((f) => f.name);
  }

  async function store(
    sourceId: string | null,
    input: FrameworkInput,
    sent: EditorState,
    opening: number,
  ) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const framework = await saveFramework(sourceId, input);
      if (framework === null) return;
      dispatch({ type: "saved", opening, sent, framework });
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
    // Rendered at once, so the errors are on screen to be focused.
    flushSync(() => {
      for (const commit of commits) dispatch(commit);
      dispatch({ type: "saveTried" });
    });
    if (hasErrors(validate(next, takenNames(next.sourceId)))) {
      // Whichever problem comes first may be scrolled out of sight.
      editorPane.current
        ?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-error="sections"]',
        )
        ?.focus();
      return;
    }

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
          sent: next,
          opening: pane.opening,
          name: source.name,
          labels: removed
            .filter((s) => withText.includes(s.key))
            .map((s) => s.label),
        });
        return;
      }
    }
    void store(next.sourceId, input, next, pane.opening);
  }

  // Before Save is tried only the brace error shows, as soon as it is typed:
  // it is the one that stops the template following the sections.
  let errors: EditorErrors | null = null;
  if (editor !== null) {
    const all = validate(editor, takenNames(editor.sourceId));
    if (pane.tried) {
      errors = all;
    } else {
      const braces = Object.entries(all.labels).filter(
        ([, message]) => message === BRACE_LABEL_ERROR,
      );
      if (braces.length > 0) errors = { labels: Object.fromEntries(braces) };
    }
  }

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
          disabled={saving}
          onSelect={(framework, from) => {
            if (framework.id === editor?.sourceId) return;
            guard(() => open(editorFor(framework)), from);
          }}
          onNew={(from) => guard(() => open(blankEditor(), true), from)}
        />
      </section>
      <div className="w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
      <section
        ref={editorPane}
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
            copiedFrom={pane.copiedFrom}
            saving={saving}
            onSave={save}
            onCopy={
              source &&
              ((from) =>
                guard(
                  () =>
                    open(copyOf(source, takenNames(null)), true, source.name),
                  from,
                ))
            }
            deleteButton={
              source?.isCustom && (
                <DeleteFrameworkButton
                  framework={source}
                  disabled={saving}
                  onDelete={() => remove(source, pane.opening)}
                />
              )
            }
          />
        )}
      </section>

      <DiscardChangesDialog
        open={leaving !== null}
        name={askedAbout}
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
                  className={dangerButton}
                  onClick={() => {
                    if (removal !== null && source !== undefined) {
                      void store(
                        source.id,
                        removal.input,
                        removal.sent,
                        removal.opening,
                      );
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
