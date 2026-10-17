import { describe, expect, it } from "vitest";
import type { PromptEntry } from "../bindings/PromptEntry";
import { groupByDay } from "./groupByDay";

function at(date: Date, id = "e"): PromptEntry {
  return {
    id,
    frameworkId: null,
    frameworkSnapshot: {
      name: "F",
      template: "",
      summaryKey: null,
      sections: [],
    },
    sectionValues: {},
    renderedPrompt: "",
    title: null,
    projectId: null,
    createdAt: date.getTime(),
  };
}

const shortDate = (d: Date) =>
  d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = (d: Date) =>
  d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const now = new Date(2026, 9, 16, 15, 0);

describe("groupByDay", () => {
  it("groups_today_yesterday_and_older_days", () => {
    const older = new Date(2026, 9, 12, 9, 0);
    const groups = groupByDay(
      [
        at(new Date(2026, 9, 16, 14, 0), "a"),
        at(new Date(2026, 9, 15, 23, 0), "b"),
        at(older, "c"),
      ],
      now,
    );
    expect(groups.map((g) => g.heading)).toEqual([
      "Today",
      "Yesterday",
      shortDate(older),
    ]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("adds_the_year_for_other_years", () => {
    const old = new Date(2025, 11, 31, 12, 0);
    const groups = groupByDay([at(old)], now);
    expect(groups[0].heading).toBe(longDate(old));
  });

  it("keeps_order_within_a_day", () => {
    const groups = groupByDay(
      [
        at(new Date(2026, 9, 16, 14, 0), "a"),
        at(new Date(2026, 9, 16, 9, 0), "b"),
        at(new Date(2026, 9, 16, 1, 0), "c"),
      ],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("splits_at_local_midnight", () => {
    const groups = groupByDay(
      [
        at(new Date(2026, 9, 16, 0, 0), "a"),
        at(new Date(2026, 9, 15, 23, 59, 59, 999), "b"),
      ],
      now,
    );
    expect(groups.map((g) => g.heading)).toEqual(["Today", "Yesterday"]);
  });

  it("treats_yesterday_across_a_month_boundary", () => {
    const groups = groupByDay(
      [at(new Date(2026, 9, 31, 10, 0))],
      new Date(2026, 10, 1, 8, 0),
    );
    expect(groups[0].heading).toBe("Yesterday");
  });

  it("returns_no_groups_for_no_entries", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
