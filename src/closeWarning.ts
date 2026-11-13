import { hasOwn } from "./hasOwn";
import type { State } from "./state/reducer";
import { renderPrompt } from "./state/reducer";

/** What closing the window would lose; see `closeWarning`. */
export type CloseWarning = {
  /** Claude Code sessions that would end, counting starts under way. */
  sessions: number;
  /** Whether a Builder draft has changes that are not saved. */
  drafts: boolean;
  /** The framework with unsaved edits in the Frameworks tab, if any. */
  frameworkEdits: { name: string } | null;
};

/**
 * What the user would lose by closing now, or null when nothing. A start
 * under way counts as a session, and a key with both a running session and a
 * start (a restart) counts once.
 */
export function closeWarning(
  state: State,
  startingKeys: ReadonlySet<string>,
): CloseWarning | null {
  const keys = new Set(startingKeys);
  for (const [key, session] of Object.entries(state.sessions)) {
    if (session.state === "running") keys.add(key);
  }

  let drafts = false;
  if (state.frameworks.status === "ready") {
    for (const framework of state.frameworks.items) {
      if (!hasOwn(state.drafts, framework.id)) continue;
      const draft = state.drafts[framework.id];
      if (!Object.values(draft).some((value) => value.trim() !== "")) continue;
      const saved = hasOwn(state.lastSaved, framework.id)
        ? state.lastSaved[framework.id]
        : null;
      if (renderPrompt(framework, draft) !== saved) {
        drafts = true;
        break;
      }
    }
  }

  const frameworkEdits = state.editingFramework?.dirty
    ? { name: state.editingFramework.name }
    : null;

  if (keys.size === 0 && !drafts && frameworkEdits === null) return null;
  return { sessions: keys.size, drafts, frameworkEdits };
}
