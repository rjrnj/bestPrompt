import * as Select from "@radix-ui/react-select";
import { useId } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import { selectedFramework } from "../state/reducer";

/**
 * The framework dropdown in the header, with the selected framework's
 * description beside it. Renders nothing until the frameworks are loaded;
 * the shell shows the loading or error view instead.
 */
export function FrameworkPicker() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const labelId = useId();
  const descriptionId = useId();
  const selected = selectedFramework(state);
  if (state.frameworks.status !== "ready" || selected === null) return null;
  const hasDescription = selected.description.trim() !== "";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* A span, not a <label>: Radix's trigger ignores the synthetic click a
          label forwards once a mouse has been used, so a label would open the
          list only sometimes. aria-labelledby gives the same accessible name. */}
      <span
        id={labelId}
        className="text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        Framework
      </span>
      <Select.Root
        value={selected.id}
        onValueChange={(id) => dispatch({ type: "selectFramework", id })}
      >
        <Select.Trigger
          aria-labelledby={labelId}
          aria-describedby={hasDescription ? descriptionId : undefined}
          className="inline-flex min-w-40 items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <Select.Value />
          <Select.Icon>
            <Chevron />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          {/* In popper mode Radix leaves the height to us; without the cap a
              long list (custom frameworks, Phase 4) would run off the window. */}
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <Select.Viewport>
              {state.frameworks.items.map((framework) => (
                <Select.Item
                  key={framework.id}
                  value={framework.id}
                  className="relative flex cursor-default items-center rounded py-1.5 pr-2 pl-7 text-sm text-slate-900 outline-none select-none data-highlighted:bg-sky-100 data-highlighted:text-sky-900 dark:text-slate-100 dark:data-highlighted:bg-sky-900 dark:data-highlighted:text-sky-100"
                >
                  <Select.ItemIndicator className="absolute left-2">
                    <Check />
                  </Select.ItemIndicator>
                  <Select.ItemText>{framework.name}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {hasDescription && (
        <p
          id={descriptionId}
          className="text-sm text-slate-600 dark:text-slate-400"
        >
          {selected.description}
        </p>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2.5 6.5 5 9l4.5-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
