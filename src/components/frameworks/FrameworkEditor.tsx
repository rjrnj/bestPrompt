import { useEffect, useId, useRef, type Dispatch, type ReactNode } from "react";
import type {
  EditorAction,
  EditorErrors,
  EditorState,
} from "../../frameworks/frameworkEditor";
import {
  fieldHelp,
  fieldLabel,
  primaryButton,
  secondaryButton,
  textInput,
} from "../styles";
import { SectionRows } from "./SectionRows";
import { TemplateEditor } from "./TemplateEditor";

type Props = {
  editor: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Shown once Save has been tried; null before. */
  errors: EditorErrors | null;
  /** Put focus in Name on opening: for a new framework or a copy. */
  focusName: boolean;
  saving: boolean;
  /** `from` is the button pressed, for focus to return to. */
  onSave(from: HTMLElement): void;
  /** Absent for an unsaved framework, which has nothing stored to copy. */
  onCopy?(from: HTMLElement): void;
  /** The Delete button, for a saved custom framework. */
  deleteButton: ReactNode;
};

const errorText = "text-xs text-red-700 dark:text-red-400";
const sectionHeading =
  "text-sm font-semibold text-slate-900 dark:text-slate-100";

/**
 * One framework's name, description, sections and template, with Save,
 * Copy and Delete above them. A built-in opens read-only, with Make a copy
 * as its only action.
 */
export function FrameworkEditor({
  editor,
  dispatch,
  errors,
  focusName,
  saving,
  onSave,
  onCopy,
  deleteButton,
}: Props) {
  const nameId = useId();
  const nameErrorId = useId();
  const descriptionId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const { readOnly } = editor;

  // Mounted afresh for each framework opened, so this runs once per opening.
  useEffect(() => {
    if (focusName) nameField.current?.focus();
  }, [focusName]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 basis-40 truncate text-lg font-semibold">
            {editor.saved?.name ?? "New framework"}
          </h2>
          {readOnly ? (
            onCopy && (
              <button
                type="button"
                className={primaryButton}
                onClick={(event) => onCopy(event.currentTarget)}
              >
                Make a copy
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                className={primaryButton}
                aria-disabled={saving || undefined}
                onClick={(event) => onSave(event.currentTarget)}
              >
                Save
              </button>
              {onCopy && (
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={(event) => onCopy(event.currentTarget)}
                >
                  Copy
                </button>
              )}
              {deleteButton}
            </>
          )}
        </div>
        {readOnly && (
          <p className={fieldHelp}>
            Built-in frameworks can&apos;t be changed. Make a copy to adapt one.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className={fieldLabel}>
            Name
          </label>
          <input
            ref={nameField}
            id={nameId}
            value={editor.name}
            readOnly={readOnly}
            aria-invalid={errors?.name ? true : undefined}
            aria-describedby={errors?.name ? nameErrorId : undefined}
            onChange={(event) =>
              dispatch({ type: "nameChanged", value: event.target.value })
            }
            className={textInput}
          />
          {errors?.name && (
            <p id={nameErrorId} className={errorText}>
              {errors.name}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={descriptionId} className={fieldLabel}>
            Description
          </label>
          <textarea
            id={descriptionId}
            rows={2}
            value={editor.description}
            readOnly={readOnly}
            onChange={(event) =>
              dispatch({
                type: "descriptionChanged",
                value: event.target.value,
              })
            }
            className={`${textInput} resize-y`}
          />
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className={sectionHeading}>Sections</h3>
        <SectionRows editor={editor} dispatch={dispatch} errors={errors} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={sectionHeading}>Template</h3>
        <TemplateEditor editor={editor} dispatch={dispatch} />
      </section>
    </div>
  );
}
