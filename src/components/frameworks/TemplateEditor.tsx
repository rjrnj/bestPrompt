import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { isAutomatic } from "../../frameworks/autoTemplate";
import {
  committedSections,
  hasBraces,
  unusedRows,
  type EditorAction,
  type EditorState,
} from "../../frameworks/frameworkEditor";
import { useAppState } from "../../state/AppState";
import { draftTextIn } from "../../state/reducer";
import {
  insertPlaceholder,
  renderTemplate,
  validateTemplate,
} from "../../template";
import {
  dangerButton,
  dialogButtons,
  dialogDescription,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  errorText,
  fieldHelp,
  linkButton,
  secondaryButton,
  textInput,
} from "../styles";

type Props = {
  editor: EditorState;
  dispatch: Dispatch<EditorAction>;
};

const toggleItem =
  "px-3 py-1 text-sm font-medium text-slate-700 first:rounded-l-md last:rounded-r-md not-aria-disabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[state=on]:bg-sky-100 data-[state=on]:text-sky-900 dark:text-slate-300 dark:not-aria-disabled:hover:bg-slate-800 dark:data-[state=on]:bg-sky-900 dark:data-[state=on]:text-sky-100";
const chip =
  "rounded-full border border-slate-400 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-900 not-aria-disabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:not-aria-disabled:hover:bg-slate-700";
const subheading = "text-sm font-medium text-slate-900 dark:text-slate-100";

/** The 1-based line of `offset` in `text`. */
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** The 1-based column of `offset` in `text`. */
function columnOf(text: string, offset: number): number {
  return offset - (text.lastIndexOf("\n", offset - 1) + 1) + 1;
}

/**
 * How the prompt is put together: Automatic, or By hand with the template
 * in a text area, a chip per section, and a sample prompt beside it. A
 * built-in can't be switched, and its template can't be edited.
 */
export function TemplateEditor({ editor, dispatch }: Props) {
  const { readOnly, automatic, template } = editor;
  const field = useRef<HTMLTextAreaElement>(null);
  const modeSwitch = useRef<HTMLDivElement>(null);
  const resetLink = useRef<HTMLButtonElement>(null);
  // What opened the reset question, for focus to return to.
  const asker = useRef<"link" | "toggle">("toggle");
  // Where the cursor goes once the inserted text is on screen.
  const cursor = useRef<number | null>(null);
  // Whether the template has been focused since it appeared.
  const focused = useRef(false);
  const textarea = useCallback((element: HTMLTextAreaElement | null) => {
    field.current = element;
    if (element !== null) focused.current = false;
  }, []);
  const [asking, setAsking] = useState(false);
  const fieldId = useId();
  const errorsId = useId();

  const committed = committedSections(editor);
  // The template can't be rebuilt from labels that hold braces.
  const cannotReset = committed.some((s) => hasBraces(s.label));
  const errors = automatic
    ? []
    : validateTemplate(
        template,
        committed.map((s) => s.key),
      );
  const unused = unusedRows(editor).flatMap((row) => {
    const section = editor.sections.find((s) => s.id === row);
    return section ? [section.label.trim()] : [];
  });

  useLayoutEffect(() => {
    if (cursor.current === null) return;
    field.current?.focus();
    field.current?.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  });

  function insert(key: string) {
    if (readOnly) return;
    // A textarea's cursor starts at 0 before anyone has been in it, which
    // is not a place the user chose: until then the tag goes at the end.
    const input = focused.current ? field.current : null;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? template.length;
    const inserted = insertPlaceholder(template, start, end, key);
    cursor.current = inserted.cursor;
    dispatch({ type: "templateEdited", value: inserted.template });
  }

  /** Switches to Automatic, asking first if hand edits would be lost. */
  function toAutomatic(from: "link" | "toggle") {
    if (cannotReset) return;
    if (isAutomatic(template, committed)) {
      dispatch({ type: "modeChanged", automatic: true });
    } else {
      asker.current = from;
      setAsking(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ToggleGroup.Root
          ref={modeSwitch}
          type="single"
          value={automatic ? "automatic" : "by-hand"}
          aria-label="Template mode"
          onValueChange={(next) => {
            if (readOnly) return;
            if (next === "automatic") toAutomatic("toggle");
            else if (next === "by-hand") {
              dispatch({ type: "modeChanged", automatic: false });
            }
          }}
          className="flex w-fit rounded-md border border-slate-400 dark:border-slate-500"
        >
          <ToggleGroup.Item
            value="automatic"
            aria-disabled={readOnly || cannotReset || undefined}
            className={toggleItem}
          >
            Automatic
          </ToggleGroup.Item>
          <ToggleGroup.Item
            value="by-hand"
            aria-disabled={readOnly || undefined}
            className={toggleItem}
          >
            By hand
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        {!automatic && !readOnly && (
          <button
            ref={resetLink}
            type="button"
            aria-disabled={cannotReset || undefined}
            className={`${linkButton} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
            onClick={() => toAutomatic("link")}
          >
            Reset to automatic
          </button>
        )}
      </div>

      {automatic ? (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Automatic: each section as a heading, left out when empty.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {committed.map((section) => (
              <button
                key={section.key}
                type="button"
                aria-label={`Insert ${section.label}`}
                aria-disabled={readOnly || undefined}
                className={chip}
                onClick={() => insert(section.key)}
              >
                {section.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
              <label htmlFor={fieldId} className={subheading}>
                Template
              </label>
              <textarea
                ref={textarea}
                id={fieldId}
                rows={12}
                spellCheck={false}
                readOnly={readOnly}
                value={template}
                aria-invalid={errors.length > 0 ? true : undefined}
                aria-describedby={errors.length > 0 ? errorsId : undefined}
                onFocus={() => {
                  focused.current = true;
                }}
                onChange={(event) =>
                  dispatch({
                    type: "templateEdited",
                    value: event.target.value,
                  })
                }
                className={`${textInput} resize-y font-mono`}
              />
              {errors.length > 0 && (
                <ul id={errorsId} className="flex flex-col gap-0.5">
                  {errors.map((error) => (
                    <li
                      key={`${error.offset} ${error.message}`}
                      className={errorText}
                    >
                      {error.message} (line {lineOf(template, error.offset)},
                      column {columnOf(template, error.offset)})
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Sample
              editor={editor}
              sections={committed}
              broken={errors.length > 0}
            />
          </div>

          {unused.length > 0 && (
            // Each row has the warning and the button; this only sums up.
            <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Not in the template: {unused.join(", ")}. Use &quot;Add to end of
              template&quot; on the section to add it.
            </p>
          )}
          {editor.notes.map((note, index) => (
            <div
              key={`${note.row} ${note.text}`}
              className="flex items-start gap-2 rounded-md bg-sky-50 px-2 py-1 dark:bg-sky-950"
            >
              <p className="min-w-0 flex-1 text-xs text-sky-900 dark:text-sky-200">
                {note.text}
              </p>
              <button
                type="button"
                aria-label="Dismiss note"
                className={linkButton}
                onClick={() => dispatch({ type: "noteDismissed", index })}
              >
                Dismiss
              </button>
            </div>
          ))}
          {[...new Set(editor.spots.map((s) => lineOf(template, s)))].map(
            (line) => (
              <p
                key={line}
                className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              >
                Check the wording at line {line}
              </p>
            ),
          )}
        </>
      )}

      <AlertDialog.Root open={asking} onOpenChange={setAsking}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={dialogOverlay} />
          <AlertDialog.Content
            className={dialogPanel}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (
                (asker.current === "link" ? resetLink.current : null) ??
                modeSwitch.current?.querySelector<HTMLElement>(
                  "[data-state=on]",
                )
              )?.focus();
            }}
          >
            <AlertDialog.Title className={dialogTitle}>
              Reset to automatic?
            </AlertDialog.Title>
            <AlertDialog.Description className={dialogDescription}>
              Your changes to the template will be lost.
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
                  onClick={() =>
                    dispatch({ type: "modeChanged", automatic: true })
                  }
                >
                  Reset
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

/**
 * The template rendered with the Builder's draft text for this framework
 * where a section has some, else the section's label in brackets.
 */
function Sample({
  editor,
  sections,
  broken,
}: {
  editor: EditorState;
  sections: { key: string; label: string }[];
  broken: boolean;
}) {
  const state = useAppState();
  const headingId = useId();
  const { sourceId } = editor;
  const drafted = new Set(
    sourceId === null
      ? []
      : draftTextIn(
          state,
          sourceId,
          sections.map((s) => s.key),
        ),
  );
  const values = Object.fromEntries(
    sections.map(({ key, label }) => [
      key,
      sourceId !== null && drafted.has(key)
        ? state.drafts[sourceId][key]
        : `[${label}]`,
    ]),
  );

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-1 basis-60 flex-col gap-1"
    >
      <h4 id={headingId} className={subheading}>
        Sample prompt
      </h4>
      <pre
        data-testid="sample-prompt"
        className="min-h-24 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm wrap-break-word whitespace-pre-wrap text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {broken ? "" : renderTemplate(editor.template, values)}
      </pre>
      {broken && <p className={fieldHelp}>Fix the template to see a sample.</p>}
    </section>
  );
}
