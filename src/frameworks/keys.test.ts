import { describe, expect, it } from "vitest";
import { validateTemplate } from "../template";
import { keyFromLabel } from "./keys";

describe("keyFromLabel", () => {
  it("joins words with underscores", () => {
    expect(keyFromLabel("Steps to reproduce", new Set())).toBe(
      "steps_to_reproduce",
    );
  });

  it("strips accents", () => {
    expect(keyFromLabel("Contexte détaillé", new Set())).toBe(
      "contexte_detaille",
    );
  });

  it("falls back to section for non-Latin text", () => {
    expect(keyFromLabel("目的", new Set())).toBe("section");
  });

  it("falls back to section for only punctuation", () => {
    expect(keyFromLabel("???", new Set())).toBe("section");
  });

  it("keeps leading digits", () => {
    expect(keyFromLabel("1st draft", new Set())).toBe("1st_draft");
  });

  it("trims leading and trailing separators", () => {
    expect(keyFromLabel("  --Goal--  ", new Set())).toBe("goal");
  });

  it("adds a numeric suffix when the key is taken", () => {
    expect(keyFromLabel("Steps!", new Set(["steps"]))).toBe("steps_2");
  });

  it("keeps counting past suffixes that are also taken", () => {
    expect(
      keyFromLabel("steps?", new Set(["steps", "steps_2", "steps_3"])),
    ).toBe("steps_4");
  });

  it("numbers the fallback key too", () => {
    expect(keyFromLabel("???", new Set(["section"]))).toBe("section_2");
  });

  it("always returns a key the parser and backend accept", () => {
    for (const label of [
      "",
      "a b",
      "Ünï",
      "{{x}}",
      "😀",
      "ß",
      "Straße",
      "A_B",
      "x".repeat(5),
    ]) {
      const key = keyFromLabel(label, new Set());
      expect(key).toMatch(/^[a-z0-9_]+$/);
      expect(validateTemplate(`{{${key}}}`, [key])).toEqual([]);
    }
  });
});
