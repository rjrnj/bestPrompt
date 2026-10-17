import * as Select from "@radix-ui/react-select";
import { useId } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import { selectedFramework } from "../state/reducer";
import { Check, Chevron } from "./icons";
import {
  selectContent,
  selectItem,
  selectLabel,
  selectTrigger,
} from "./styles";

/**
 * The framework dropdown in the header and the selected framework's
 * description. Renders nothing until the frameworks are loaded; the shell
 * shows the loading or error view instead.
 */
export function FrameworkPicker() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const labelId = useId();
  const descriptionId = useId();
  const selected = selectedFramework(state);
  if (state.frameworks.status !== "ready" || selected === null) return null;
  const hasDescription = selected.description.trim() !== "";

  // A fragment, so the description is an item of the header's own wrapping
  // row: it goes last, after the project picker, and takes a line of its
  // own unless the window is wide enough to keep it beside the pickers.
  return (
    <>
      <div className="flex items-center gap-3">
        {/* A span, not a <label>: Radix's trigger ignores the synthetic click a
            label forwards once a mouse has been used, so a label would open the
            list only sometimes. aria-labelledby gives the same accessible name. */}
        <span id={labelId} className={selectLabel}>
          Framework
        </span>
        <Select.Root
          value={selected.id}
          onValueChange={(id) => dispatch({ type: "selectFramework", id })}
        >
          <Select.Trigger
            aria-labelledby={labelId}
            aria-describedby={hasDescription ? descriptionId : undefined}
            className={selectTrigger}
          >
            <Select.Value />
            <Select.Icon>
              <Chevron />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className={selectContent}
            >
              <Select.Viewport>
                {state.frameworks.items.map((framework) => (
                  <Select.Item
                    key={framework.id}
                    value={framework.id}
                    className={selectItem}
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
      </div>
      {hasDescription && (
        <p
          id={descriptionId}
          className="order-last min-w-0 flex-1 basis-80 text-sm text-slate-600 dark:text-slate-400"
        >
          {selected.description}
        </p>
      )}
    </>
  );
}
