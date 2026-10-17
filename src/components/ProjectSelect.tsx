import * as Select from "@radix-ui/react-select";
import { useId, useRef, type Ref } from "react";
import type { Project } from "../bindings/Project";
import { Check, Chevron } from "./icons";
import {
  selectContent,
  selectItem,
  selectLabel,
  selectSeparator,
  selectTrigger,
} from "./styles";

/** A command offered after the projects, such as "New project…". */
export type ExtraItem = { value: string; label: string; onSelect(): void };

type Props = {
  projects: Project[];
  /** The selected project's id, or null for No project. */
  value: string | null;
  /** Shown for a `value` that isn't among `projects`, which lists no item for it. */
  unlistedLabel?: string;
  onChange(id: string | null): void;
  /** Runs as the list opens. */
  onOpen?(): void;
  label: string;
  /** Listed after a separator; choosing one runs it and keeps the value. */
  extraItems?: ExtraItem[];
  ref?: Ref<HTMLButtonElement>;
};

// Radix Select can't hold an empty value, so No project has an item value of
// its own. Project ids are UUIDs, so it can't collide with one, and neither
// can the extra items' values.
const NONE = "none";

/** A labelled dropdown of the projects, by name, then No project. */
export function ProjectSelect({
  projects,
  value,
  unlistedLabel,
  onChange,
  onOpen,
  label,
  extraItems = [],
  ref,
}: Props) {
  const unlisted =
    value !== null && !projects.some((project) => project.id === value);
  const labelId = useId();
  // Set when an extra item is chosen. Its action usually opens a dialog,
  // which takes focus as it mounts; the closing list would otherwise move
  // focus back to the trigger a moment later, out of the dialog.
  const skipFocusReturn = useRef(false);

  return (
    <div className="flex items-center gap-3">
      {/* A span, not a <label>, as in the framework picker: Radix's trigger
          ignores the click a label forwards once a mouse has been used. */}
      <span id={labelId} className={selectLabel}>
        {label}
      </span>
      <Select.Root
        value={value ?? NONE}
        onValueChange={(next) => {
          const extra = extraItems.find((item) => item.value === next);
          if (extra !== undefined) {
            skipFocusReturn.current = true;
            extra.onSelect();
          } else {
            onChange(next === NONE ? null : next);
          }
        }}
        onOpenChange={(open) => {
          if (open) onOpen?.();
        }}
      >
        <Select.Trigger
          ref={ref}
          aria-labelledby={labelId}
          className={`max-w-60 ${selectTrigger}`}
        >
          <span className="min-w-0 truncate">
            <Select.Value>{unlisted ? unlistedLabel : undefined}</Select.Value>
          </span>
          <Select.Icon>
            <Chevron />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className={selectContent}
            onCloseAutoFocus={(event) => {
              if (skipFocusReturn.current) {
                skipFocusReturn.current = false;
                event.preventDefault();
              }
            }}
          >
            <Select.Viewport>
              {projects.map((project) => (
                <Item key={project.id} value={project.id} text={project.name} />
              ))}
              <Item value={NONE} text="No project" />
              {extraItems.length > 0 && (
                <Select.Separator className={selectSeparator} />
              )}
              {extraItems.map((item) => (
                <Item key={item.value} value={item.value} text={item.label} />
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

function Item({ value, text }: { value: string; text: string }) {
  return (
    <Select.Item value={value} className={selectItem}>
      <Select.ItemIndicator className="absolute left-2">
        <Check />
      </Select.ItemIndicator>
      <Select.ItemText>{text}</Select.ItemText>
    </Select.Item>
  );
}
