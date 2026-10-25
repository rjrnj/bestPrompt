import { useId, type Ref } from "react";
import type { Framework } from "../../bindings/Framework";
import { Lock } from "../icons";
import { secondaryButton } from "../styles";

type Props = {
  /** The live frameworks, in list order. */
  frameworks: Framework[];
  /** The framework open in the editor; null for none or an unsaved one. */
  selectedId: string | null;
  /** `from` is the button pressed, for focus to return to. */
  onSelect(framework: Framework, from: HTMLElement): void;
  onNew(from: HTMLElement): void;
  newButtonRef?: Ref<HTMLButtonElement>;
  /** Nothing can be opened, as while a save runs. */
  disabled?: boolean;
};

const heading =
  "px-3 pb-1 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400";
const row =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 aria-pressed:bg-sky-100 dark:text-slate-100 dark:hover:bg-slate-800 dark:aria-pressed:bg-sky-900";

/** New framework, then the built-ins (each with a lock) and the user's own. */
export function FrameworkList({
  frameworks,
  selectedId,
  onSelect,
  onNew,
  newButtonRef,
  disabled = false,
}: Props) {
  const builtInId = useId();
  const yoursId = useId();
  const builtIns = frameworks.filter((f) => !f.isCustom);
  const yours = frameworks.filter((f) => f.isCustom);

  const item = (framework: Framework) => (
    <li key={framework.id}>
      <button
        type="button"
        aria-pressed={framework.id === selectedId}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (!disabled) onSelect(framework, event.currentTarget);
        }}
        className={row}
      >
        <span className="min-w-0 flex-1 truncate">{framework.name}</span>
        {!framework.isCustom && (
          <span
            aria-hidden="true"
            className="shrink-0 text-slate-500 dark:text-slate-400"
          >
            <Lock />
          </span>
        )}
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <button
        ref={newButtonRef}
        type="button"
        className={`${secondaryButton} self-start`}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (!disabled) onNew(event.currentTarget);
        }}
      >
        <span aria-hidden="true">+ </span>New framework
      </button>
      <section>
        <h2 id={builtInId} className={heading}>
          Built-in
        </h2>
        <ul aria-labelledby={builtInId} className="flex flex-col">
          {builtIns.map(item)}
        </ul>
      </section>
      <section>
        <h2 id={yoursId} className={heading}>
          Yours
        </h2>
        {yours.length === 0 ? (
          <p className="px-3 text-sm text-slate-600 dark:text-slate-400">
            None yet.
          </p>
        ) : (
          <ul aria-labelledby={yoursId} className="flex flex-col">
            {yours.map(item)}
          </ul>
        )}
      </section>
    </div>
  );
}
