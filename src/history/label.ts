import type { Framework } from "../bindings/Framework";
import type { PromptEntry } from "../bindings/PromptEntry";

const UNTITLED = "Untitled prompt";

/** The first line of `text` that has anything on it, trimmed. */
function firstLine(text: string | undefined): string | null {
  if (text === undefined) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return null;
}

/**
 * The one-line text a history row shows: the title if there is one, else the
 * first line of the framework's summary section, else the first line of any
 * section in form order.
 */
export function entryLabel(
  entry: PromptEntry,
  frameworks: Framework[],
): string {
  const title = entry.title?.trim();
  if (title) return title;

  const summaryKey =
    entry.frameworkSnapshot.summaryKey ??
    frameworks.find((f) => f.id === entry.frameworkId)?.summaryKey ??
    null;
  if (summaryKey !== null) {
    const summary = firstLine(entry.sectionValues[summaryKey]);
    if (summary !== null) return summary;
  }

  for (const section of entry.frameworkSnapshot.sections) {
    const line = firstLine(entry.sectionValues[section.key]);
    if (line !== null) return line;
  }
  return UNTITLED;
}
