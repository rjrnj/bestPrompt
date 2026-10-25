import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
} from "react";
import { dropIndex } from "../../frameworks/dropIndex";
import {
  unusedRows,
  type EditorAction,
  type EditorErrors,
  type EditorSection,
  type EditorState,
} from "../../frameworks/frameworkEditor";
import { Arrow, Grip } from "../icons";
import {
  errorText,
  fieldLabel,
  linkButton,
  secondaryButton,
  textInput,
} from "../styles";

type Props = {
  editor: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Shown once Save has been tried; null before. */
  errors: EditorErrors | null;
};

const iconButton = `${secondaryButton} flex size-7 items-center justify-center px-0 py-0`;

/**
 * The framework's sections, one row each, then Add section. Rows move with
 * Move up and Move down, or by dragging the handle; the drag uses pointer
 * events because the desktop webview swallows HTML drag and drop.
 */
export function SectionRows({ editor, dispatch, errors }: Props) {
  const { sections, readOnly } = editor;
  const list = useRef<HTMLOListElement>(null);
  // The control to focus once the next render is on screen, by its
  // data-focus value: the moved row's button, or a new row's label.
  const pendingFocus = useRef<string | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const unused = unusedRows(editor);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    list.current?.parentElement
      ?.querySelector<HTMLElement>(`[data-focus="${target}"]`)
      ?.focus();
  });

  function move(row: number, to: number, button: "up" | "down") {
    if (to < 0 || to >= sections.length) return;
    pendingFocus.current = `${button}-${row}`;
    dispatch({ type: "sectionMoved", row, to });
  }

  function remove(index: number) {
    const neighbour = sections[index + 1] ?? sections[index - 1];
    pendingFocus.current = neighbour ? `remove-${neighbour.id}` : "add";
    dispatch({ type: "sectionRemoved", row: sections[index].id });
  }

  const drag = (row: number) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragged(row);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (dragged !== row) return;
      setDragged(null);
      dispatch({
        type: "sectionMoved",
        row,
        to: dropIndex(
          Array.from(list.current?.children ?? [], (item) =>
            item.getBoundingClientRect(),
          ),
          sections.findIndex((s) => s.id === row),
          event.clientY,
        ),
      });
    },
    // Ends a drag the pointer-up didn't: a cancelled pointer, or capture
    // taken away.
    onLostPointerCapture() {
      setDragged(null);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <ol ref={list} className="flex flex-col gap-3">
        {sections.map((section, index) => (
          <SectionRow
            key={section.id}
            section={section}
            name={section.label.trim() || `section ${index + 1}`}
            readOnly={readOnly}
            isSummary={section.committed && section.key === editor.summaryKey}
            unused={unused.includes(section.id)}
            error={errors?.labels[section.id]}
            dragging={dragged === section.id}
            first={index === 0}
            last={index === sections.length - 1}
            dispatch={dispatch}
            onMoveUp={() => move(section.id, index - 1, "up")}
            onMoveDown={() => move(section.id, index + 1, "down")}
            onRemove={() => remove(index)}
            dragHandle={drag(section.id)}
          />
        ))}
      </ol>
      {errors?.sections && (
        <p tabIndex={-1} data-error="sections" className={errorText}>
          {errors.sections}
        </p>
      )}
      {!readOnly && (
        <button
          type="button"
          data-focus="add"
          className={`${secondaryButton} self-start`}
          onClick={() => {
            pendingFocus.current = `label-${editor.nextRowId}`;
            dispatch({ type: "sectionAdded" });
          }}
        >
          <span aria-hidden="true">+ </span>Add section
        </button>
      )}
    </div>
  );
}

type RowProps = {
  section: EditorSection;
  /** The label, or "section n" while it is blank, for the buttons' names. */
  name: string;
  readOnly: boolean;
  isSummary: boolean;
  unused: boolean;
  error: string | undefined;
  dragging: boolean;
  first: boolean;
  last: boolean;
  dispatch: Dispatch<EditorAction>;
  onMoveUp(): void;
  onMoveDown(): void;
  onRemove(): void;
  dragHandle: {
    onPointerDown(event: PointerEvent<HTMLElement>): void;
    onPointerUp(event: PointerEvent<HTMLElement>): void;
    onLostPointerCapture(): void;
  };
};

function SectionRow({
  section,
  name,
  readOnly,
  isSummary,
  unused,
  error,
  dragging,
  first,
  last,
  dispatch,
  onMoveUp,
  onMoveDown,
  onRemove,
  dragHandle,
}: RowProps) {
  const labelId = useId();
  const helpId = useId();
  const errorId = useId();
  const row = section.id;

  return (
    <li
      className={`flex gap-2 rounded-md border bg-white p-3 dark:bg-slate-900 ${
        dragging
          ? "border-sky-500 opacity-70 dark:border-sky-400"
          : "border-slate-200 dark:border-slate-700"
      }`}
    >
      {!readOnly && (
        // Mouse and touch only; the Move buttons are the keyboard's way.
        <span
          aria-hidden="true"
          title="Drag to reorder"
          className="-ml-1 flex shrink-0 cursor-grab touch-none items-start pt-7 text-slate-400 select-none hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          {...dragHandle}
        >
          <Grip />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={labelId} className={fieldLabel}>
            Label
          </label>
          <input
            id={labelId}
            data-focus={`label-${row}`}
            value={section.label}
            readOnly={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) =>
              dispatch({ type: "labelChanged", row, value: event.target.value })
            }
            // The section gets its key when its label is first confirmed.
            onBlur={() => dispatch({ type: "labelCommitted", row })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              dispatch({ type: "labelCommitted", row });
            }}
            className={textInput}
          />
          {error && (
            <p id={errorId} className={errorText}>
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={helpId} className={fieldLabel}>
            Help text
          </label>
          <input
            id={helpId}
            value={section.helpText}
            readOnly={readOnly}
            onChange={(event) =>
              dispatch({ type: "helpChanged", row, value: event.target.value })
            }
            className={textInput}
          />
        </div>
        {isSummary ? (
          <p className="text-xs font-medium text-sky-800 dark:text-sky-300">
            Used for History labels
          </p>
        ) : (
          section.committed &&
          !readOnly && (
            <button
              type="button"
              aria-label={`Use for History labels: ${name}`}
              className={`${linkButton} self-start`}
              onClick={() => dispatch({ type: "summaryChosen", row })}
            >
              Use for History labels
            </button>
          )
        )}
        {unused && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-2 py-1 dark:bg-amber-950">
            <p className="text-xs text-amber-900 dark:text-amber-200">
              Not in the template, so its text won&apos;t appear in the prompt.
            </p>
            <button
              type="button"
              aria-label={`Add to end of template: ${name}`}
              className={linkButton}
              onClick={() =>
                dispatch({ type: "sectionAppendedToTemplate", row })
              }
            >
              Add to end of template
            </button>
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex shrink-0 flex-col items-end gap-1 pt-6">
          <div className="flex gap-1">
            <button
              type="button"
              data-focus={`up-${row}`}
              aria-label={`Move ${name} up`}
              title="Move up"
              aria-disabled={first || undefined}
              className={iconButton}
              onClick={onMoveUp}
            >
              <Arrow direction="up" />
            </button>
            <button
              type="button"
              data-focus={`down-${row}`}
              aria-label={`Move ${name} down`}
              title="Move down"
              aria-disabled={last || undefined}
              className={iconButton}
              onClick={onMoveDown}
            >
              <Arrow direction="down" />
            </button>
          </div>
          <button
            type="button"
            data-focus={`remove-${row}`}
            aria-label={`Remove ${name}`}
            className={secondaryButton}
            // A typed label is confirmed when the field is left by keyboard,
            // not by a click on this button: it would be added and cut again.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}
