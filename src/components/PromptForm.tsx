import { useAppDispatch, useAppState } from "../state/AppState";
import { currentDraft, selectedFramework } from "../state/reducer";
import { SectionField } from "./SectionField";

/**
 * One field per section of the selected framework, bound to its draft.
 * Renders nothing until a framework is selected.
 */
export function PromptForm() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const framework = selectedFramework(state);
  if (framework === null) return null;
  const draft = currentDraft(state);

  // Keyed by framework so a switch mounts fresh fields: section keys repeat
  // across frameworks (`role` in three built-ins), and a reused textarea
  // would carry its dragged height, scroll offset and undo stack along.
  return (
    <div key={framework.id} className="flex flex-col gap-4">
      {framework.sections.map((section) => (
        <SectionField
          key={section.key}
          section={section}
          value={draft[section.key]}
          onChange={(value) =>
            dispatch({ type: "editSection", key: section.key, value })
          }
        />
      ))}
    </div>
  );
}
