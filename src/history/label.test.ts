import { describe, expect, it } from "vitest";
import type { Framework } from "../bindings/Framework";
import type { PromptEntry } from "../bindings/PromptEntry";
import type { Section } from "../bindings/Section";
import { entryLabel } from "./label";

const section = (key: string): Section => ({ key, label: key, helpText: "" });

function entry(
  values: Record<string, string>,
  opts: {
    title?: string | null;
    summaryKey?: string | null;
    keys?: string[];
    frameworkId?: string | null;
  } = {},
): PromptEntry {
  return {
    id: "e1",
    frameworkId: opts.frameworkId === undefined ? "fw" : opts.frameworkId,
    frameworkSnapshot: {
      name: "Framework",
      template: "",
      summaryKey: opts.summaryKey ?? null,
      sections: (opts.keys ?? Object.keys(values)).map(section),
    },
    sectionValues: values,
    renderedPrompt: "",
    title: opts.title ?? null,
    projectId: null,
    createdAt: 0,
    version: 0,
  };
}

function framework(id: string, summaryKey: string | null): Framework {
  return {
    id,
    name: "Framework",
    description: "",
    template: "",
    summaryKey,
    isCustom: false,
    deletedAt: null,
    sections: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("entryLabel", () => {
  it("reads_only_the_entry's_own_section_values", () => {
    const e = entry(
      { a: "body" },
      { summaryKey: "constructor", keys: ["constructor", "toString", "a"] },
    );
    expect(entryLabel(e, [])).toBe("body");

    const named = entry(
      { constructor: "Built it" },
      { summaryKey: "constructor" },
    );
    expect(entryLabel(named, [])).toBe("Built it");
  });

  it("uses_the_title", () => {
    const e = entry({ a: "body" }, { title: "  My title  " });
    expect(entryLabel(e, [])).toBe("My title");
  });

  it("ignores_a_blank_title", () => {
    const e = entry({ a: "body" }, { title: "   " });
    expect(entryLabel(e, [])).toBe("body");
  });

  it("uses_the_first_line_of_the_summary_section", () => {
    const e = entry(
      { role: "Senior dev", objective: "  Ship it\nsecond line" },
      { summaryKey: "objective" },
    );
    expect(entryLabel(e, [])).toBe("Ship it");
  });

  it("skips_blank_lines_and_whitespace_only_summaries", () => {
    const multi = entry(
      { role: "Senior dev", objective: "\n  \n Real line\nmore" },
      { summaryKey: "objective" },
    );
    expect(entryLabel(multi, [])).toBe("Real line");

    const blank = entry(
      { role: "Senior dev", objective: " \n\t\n" },
      { summaryKey: "objective" },
    );
    expect(entryLabel(blank, [])).toBe("Senior dev");
  });

  it("falls_back_to_the_current_frameworks_summary_key_for_old_snapshots", () => {
    const e = entry({ role: "Senior dev", objective: "Ship it" });
    expect(entryLabel(e, [framework("fw", "objective")])).toBe("Ship it");
    expect(entryLabel(e, [framework("other", "objective")])).toBe("Senior dev");
    expect(entryLabel(e, [framework("fw", null)])).toBe("Senior dev");
  });

  it("falls_back_to_the_first_non_blank_section", () => {
    const e = entry(
      { a: "", b: "  ", c: "\nThird\nmore", d: "Fourth" },
      { keys: ["a", "b", "c", "d"] },
    );
    expect(entryLabel(e, [])).toBe("Third");
  });

  it("follows_snapshot_order_not_value_order", () => {
    const e = entry({ b: "Second", a: "First" }, { keys: ["a", "b"] });
    expect(entryLabel(e, [])).toBe("First");
  });

  it("labels_an_all_blank_entry_untitled", () => {
    const e = entry({ a: "", b: " \n " });
    expect(entryLabel(e, [])).toBe("Untitled prompt");
  });

  it("returns_a_long_single_line_whole", () => {
    const long = "x".repeat(500);
    expect(entryLabel(entry({ a: long }), [])).toBe(long);
  });

  it("handles_windows_line_endings", () => {
    const e = entry({ a: "\r\nFirst\r\nSecond" });
    expect(entryLabel(e, [])).toBe("First");
  });
});
