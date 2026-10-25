import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
} from "react";
import { dropGap, dropIndex, lineAt } from "../../frameworks/dropIndex";
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
  iconButton,
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

/** A row being dragged by its handle. */
type Drag = {
  row: number;
  pointerId: number;
  /** The gap it would drop into, as dropGap counts it; null for none. */
  gap: number | null;
  /** The rows the gap was measured in. */
  sections: EditorSection[];
};

/**
 * Where `row` is in `sections`, and where it lands if dropped at height `y`
 * over the rows of `list` as they are on screen. `from` is -1 once the row
 * is gone.
 */
function landing(
  list: HTMLOListElement | null,
  sections: EditorSection[],
  row: number,
  y: number,
) {
  const from = sections.findIndex((s) => s.id === row);
  const bounds = Array.from(list?.children ?? [], (item) =>
    item.getBoundingClientRect(),
  );
  return { from, to: dropIndex(bounds, from, y) };
}

/**
 * The framework's sections, one row each, then Add section. Rows move with
 * Move up and Move down, or by dragging the handle; the drag uses pointer
 * events because the desktop webview swallows HTML drag and drop. While a
 * row is dragged, a line marks the gap it would drop into.
 */
export function SectionRows({ editor, dispatch, errors }: Props) {
  const { sections, readOnly } = editor;
  const list = useRef<HTMLOListElement>(null);
  // The control to focus once the next render is on screen, by its
  // data-focus value: the moved row's button, or a new row's label.
  const pendingFocus = useRef<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Where the dragging pointer last was, for the line to follow rows that
  // move under a still pointer.
  const pointerY = useRef(0);
  const unused = unusedRows(editor);
  // A drag ends with its row, and its gap is only shown over the rows it
  // was measured in, not for the moment the rows have changed under it.
  const dragging =
    drag !== null && sections.some((s) => s.id === drag.row) ? drag : null;
  const gap = dragging?.sections === sections ? dragging.gap : null;
  const dragRow = drag?.row;
  const dragPointer = drag?.pointerId;

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    list.current?.parentElement
      ?.querySelector<HTMLElement>(`[data-focus="${target}"]`)
      ?.focus();
  });

  // A drag is followed on the window, not the handle: moving the row in the
  // page, as a Move button pressed mid-drag can, takes the pointer from the
  // handle. The line is measured again on every frame, so it follows the
  // pointer and whatever moves the rows under it: a scroll, a resize, a
  // change of the rows or of what is above them. The release, anywhere,
  // drops the row where the line shows, both being measured the same way.
  useEffect(() => {
    if (dragRow === undefined) return;
    const row = dragRow;
    function follow() {
      const { from, to } = landing(
        list.current,
        sections,
        row,
        pointerY.current,
      );
      const gap = from === -1 ? null : dropGap(from, to);
      setDrag((d) =>
        d === null || from === -1
          ? null
          : d.gap === gap && d.sections === sections
            ? d
            : { ...d, gap, sections },
      );
    }
    function drop(y: number) {
      setDrag(null);
      const { from, to } = landing(list.current, sections, row, y);
      if (from !== -1 && to !== from) {
        dispatch({ type: "sectionMoved", row, to });
      }
    }
    // The main button let go while another is held comes as a move, not a
    // release, and drops. A move without the main button held otherwise, or
    // the window losing focus, means the release was missed: the drag ends
    // without a drop, so a later click can't drop the row.
    function moved(event: globalThis.PointerEvent) {
      if (event.pointerId !== dragPointer) return;
      if ((event.buttons & 1) === 0) {
        if (event.button === 0) drop(event.clientY);
        else setDrag(null);
        return;
      }
      pointerY.current = event.clientY;
    }
    function abandoned() {
      setDrag(null);
    }
    function released(event: globalThis.PointerEvent) {
      if (event.pointerId === dragPointer && event.button === 0) {
        drop(event.clientY);
      }
    }
    function cancelled(event: globalThis.PointerEvent) {
      if (event.pointerId === dragPointer) setDrag(null);
    }
    let frame = requestAnimationFrame(function tick() {
      follow();
      frame = requestAnimationFrame(tick);
    });
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", released);
    window.addEventListener("pointercancel", cancelled);
    window.addEventListener("blur", abandoned);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", released);
      window.removeEventListener("pointercancel", cancelled);
      window.removeEventListener("blur", abandoned);
    };
  }, [dragRow, dragPointer, sections, dispatch]);

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

  const dragHandle = (row: number) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      // A second finger leaves a drag alone. Any other press while a drag
      // is going means that drag missed its end: this one starts afresh.
      if (dragging !== null && !event.isPrimary) return;
      event.preventDefault();
      // Keeps the press from reaching what the pointer passes over.
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerY.current = event.clientY;
      setDrag({ row, pointerId: event.pointerId, gap: null, sections });
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
            dragging={dragging?.row === section.id}
            dropLine={lineAt(gap, index, sections.length)}
            first={index === 0}
            last={index === sections.length - 1}
            dispatch={dispatch}
            onMoveUp={() => move(section.id, index - 1, "up")}
            onMoveDown={() => move(section.id, index + 1, "down")}
            onRemove={() => remove(index)}
            dragHandle={dragHandle(section.id)}
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
  /** A line in the gap above or below the row, where a dragged row lands. */
  dropLine: "before" | "after" | null;
  first: boolean;
  last: boolean;
  dispatch: Dispatch<EditorAction>;
  onMoveUp(): void;
  onMoveDown(): void;
  onRemove(): void;
  dragHandle: {
    onPointerDown(event: PointerEvent<HTMLElement>): void;
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
  dropLine,
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
      className={`relative flex gap-2 rounded-md border bg-white p-3 dark:bg-slate-900 ${
        dragging
          ? "border-sky-500 opacity-70 dark:border-sky-400"
          : "border-slate-200 dark:border-slate-700"
      }`}
    >
      {dropLine && (
        // Centred in the 12px gap between rows, measured from inside the
        // row's 1px border.
        <div
          aria-hidden="true"
          data-drop-line={dropLine}
          className={`pointer-events-none absolute -inset-x-px h-0.5 rounded-full bg-sky-500 dark:bg-sky-400 ${
            dropLine === "before" ? "-top-2" : "-bottom-2"
          }`}
        />
      )}
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
