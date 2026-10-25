import { describe, expect, it } from "vitest";
import frameworks from "../../src-tauri/builtins/frameworks.json";
import type { Section } from "../bindings/Section";
import { parseTemplate, validateTemplate } from "../template";
import { autoTemplate, isAutomatic, sectionBlock } from "./autoTemplate";

const sections: Section[] = [
  { key: "role", label: "Role", helpText: "" },
  { key: "task", label: "Task", helpText: "" },
];

describe("sectionBlock", () => {
  it("wraps a heading and placeholder in an optional block", () => {
    expect(sectionBlock(sections[0])).toBe(
      "{{#role}}# Role\n{{role}}{{/role}}",
    );
  });
});

describe("autoTemplate", () => {
  it("joins blocks with a blank line", () => {
    expect(autoTemplate(sections)).toBe(
      "{{#role}}# Role\n{{role}}{{/role}}\n\n{{#task}}# Task\n{{task}}{{/task}}",
    );
  });

  it("is empty for no sections", () => {
    expect(autoTemplate([])).toBe("");
  });

  it.each(frameworks)("equals the built-in template of $id", (framework) => {
    expect(autoTemplate(framework.sections)).toBe(framework.template);
  });

  it("autoTemplate_of_valid_sections_always_parses", () => {
    const odd: Section[] = [
      { key: "a", label: "# Hash", helpText: "{{ braces }}" },
      { key: "b", label: 'Say "hi" it\'s', helpText: "" },
      { key: "c", label: "目的 ✓ é", helpText: "" },
      { key: "d", label: "ends with a backslash\\", helpText: "" },
      { key: "e", label: "a { lone", helpText: "" },
      { key: "f", label: "a } lone", helpText: "" },
      { key: "g", label: "}}", helpText: "" },
      { key: "h", label: "{ }", helpText: "" },
    ];
    const keys = odd.map((section) => section.key);
    expect(parseTemplate(autoTemplate(odd)).ok).toBe(true);
    expect(validateTemplate(autoTemplate(odd), keys)).toEqual([]);
  });
});

describe("isAutomatic", () => {
  it("is true for the generated template", () => {
    expect(isAutomatic(autoTemplate(sections), sections)).toBe(true);
  });

  it("is false after any edit", () => {
    const edited = autoTemplate(sections) + " ";
    expect(isAutomatic(edited, sections)).toBe(false);
    expect(isAutomatic(autoTemplate(sections), [sections[0]])).toBe(false);
  });
});
