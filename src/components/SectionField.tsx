import { useId } from "react";
import type { Section } from "../bindings/Section";

type Props = {
  section: Section;
  value: string;
  onChange: (value: string) => void;
  /** True when the framework's template never outputs this section's text. */
  unused: boolean;
};

/**
 * One section of the form: label, help text, a growing textarea and, for a
 * section the template leaves out, a note saying so.
 */
export function SectionField({ section, value, onChange, unused }: Props) {
  const inputId = useId();
  const helpId = useId();
  const unusedId = useId();
  const hasHelp = section.helpText.trim() !== "";

  const describedBy =
    [hasHelp ? helpId : null, unused ? unusedId : null]
      .filter((id) => id !== null)
      .join(" ") || undefined;

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {section.label}
      </label>
      {hasHelp && (
        <p
          id={helpId}
          className="mt-0.5 text-xs text-slate-600 dark:text-slate-400"
        >
          {section.helpText}
        </p>
      )}
      {/* field-sizing-content grows the box with its text where the webview
          supports it, and there `rows` is ignored, so the minimum height of
          three lines plus padding is set explicitly. `rows` covers a webview
          without field-sizing, where the box stays at three rows. */}
      <textarea
        id={inputId}
        aria-describedby={describedBy}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 block max-h-80 min-h-[calc(3lh+1rem)] w-full resize-y rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 field-sizing-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100"
      />
      {unused && (
        <p
          id={unusedId}
          className="mt-1 text-xs text-slate-600 dark:text-slate-400"
        >
          Not in this framework's template, so this text won't appear in the
          prompt.
        </p>
      )}
    </div>
  );
}
