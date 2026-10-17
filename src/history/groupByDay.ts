import type { PromptEntry } from "../bindings/PromptEntry";

export type DayGroup = { heading: string; entries: PromptEntry[] };

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function heading(day: Date, today: Date): string {
  if (day.getTime() === today.getTime()) return "Today";
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  if (day.getTime() === yesterday.getTime()) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(day.getFullYear() !== today.getFullYear() && { year: "numeric" }),
  });
}

/**
 * Splits entries (already newest first) into runs that share a local calendar
 * day, headed "Today", "Yesterday" or the date.
 */
export function groupByDay(entries: PromptEntry[], now: Date): DayGroup[] {
  const today = startOfDay(now);
  const groups: DayGroup[] = [];
  let currentDay = Number.NaN;
  for (const entry of entries) {
    const day = startOfDay(new Date(entry.createdAt));
    if (day.getTime() !== currentDay) {
      currentDay = day.getTime();
      groups.push({ heading: heading(day, today), entries: [] });
    }
    groups[groups.length - 1].entries.push(entry);
  }
  return groups;
}
