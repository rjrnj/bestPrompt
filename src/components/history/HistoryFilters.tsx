import * as Select from "@radix-ui/react-select";
import { useId } from "react";
import type { ProjectFilter } from "../../bindings/ProjectFilter";
import { useAppState } from "../../state/AppState";
import { useHistory } from "../../state/HistoryState";
import { Check, Chevron } from "../icons";
import {
  selectContent,
  selectItem,
  selectLabel,
  selectSeparator,
  selectTrigger,
  textInput,
} from "../styles";

// Radix Select can't hold an empty value, so "everything" and "no project"
// have values of their own. Project and framework ids can't equal them.
const ALL = "all";
const NONE = "none";

function projectValue(filter: ProjectFilter): string {
  if (filter.kind === "any") return ALL;
  return filter.kind === "unassigned" ? NONE : filter.id;
}

function projectFilter(value: string): ProjectFilter {
  if (value === ALL) return { kind: "any" };
  if (value === NONE) return { kind: "unassigned" };
  return { kind: "project", id: value };
}

type Option = { value: string; text: string };

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: Option[];
}) {
  const labelId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className={selectLabel}>
        {label}
      </span>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger
          aria-labelledby={labelId}
          className={`w-full min-w-0 ${selectTrigger}`}
        >
          <span className="min-w-0 truncate">
            <Select.Value />
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
          >
            <Select.Viewport>
              {options.map((option, index) => (
                <div key={option.value}>
                  {index === 1 && (
                    <Select.Separator className={selectSeparator} />
                  )}
                  <Select.Item value={option.value} className={selectItem}>
                    <Select.ItemIndicator className="absolute left-2">
                      <Check />
                    </Select.ItemIndicator>
                    <Select.ItemText>{option.text}</Select.ItemText>
                  </Select.Item>
                </div>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

/** The search box and the project and framework filters above the list. */
export function HistoryFilters() {
  const { projects, frameworks } = useAppState();
  const { state, setFilters } = useHistory();
  const { filters } = state;
  const searchId = useId();

  const projectOptions: Option[] = [
    { value: ALL, text: "All projects" },
    ...(projects.status === "ready" ? projects.items : []).map((p) => ({
      value: p.id,
      text: p.name,
    })),
    { value: NONE, text: "No project" },
  ];
  const frameworkOptions: Option[] = [
    { value: ALL, text: "All frameworks" },
    // A deleted framework stays while it has prompts, and a new one may
    // reuse its name, so it is marked.
    ...(frameworks.status === "ready" ? frameworks.items : []).map((f) => ({
      value: f.id,
      text: f.deletedAt === null ? f.name : `${f.name} (deleted)`,
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={searchId} className={selectLabel}>
          Search prompts
        </label>
        <input
          id={searchId}
          type="search"
          value={filters.search}
          onChange={(event) => setFilters({ search: event.target.value })}
          className={textInput}
        />
      </div>
      <FilterSelect
        label="Project"
        value={projectValue(filters.project)}
        onChange={(value) => setFilters({ project: projectFilter(value) })}
        options={projectOptions}
      />
      <FilterSelect
        label="Framework"
        value={filters.frameworkId ?? ALL}
        onChange={(value) =>
          setFilters({ frameworkId: value === ALL ? null : value })
        }
        options={frameworkOptions}
      />
    </div>
  );
}
