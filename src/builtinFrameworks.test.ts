import { describe, expect, it } from "vitest";
import frameworks from "../src-tauri/builtins/frameworks.json";
import { renderTemplate, validateTemplate } from "./template";

// The built-ins the app seeds at startup. This checks every template against
// its own sections, so a wording change in the JSON can't ship a broken prompt.

describe.each(frameworks)("built-in framework $id", (framework) => {
  const keys = framework.sections.map((section) => section.key);

  it("has a summaryKey that is one of its sections", () => {
    expect(keys).toContain(framework.summaryKey);
  });

  it("has a template that validates against its section keys", () => {
    expect(validateTemplate(framework.template, keys)).toEqual([]);
  });

  it("references every section in its template", () => {
    for (const key of keys) {
      expect(framework.template).toContain(`{{${key}}}`);
    }
  });

  it("renders every label and value when all sections are filled", () => {
    const values = Object.fromEntries(keys.map((key) => [key, `<${key}>`]));

    const prompt = renderTemplate(framework.template, values);

    for (const section of framework.sections) {
      expect(prompt).toContain(`# ${section.label}\n<${section.key}>`);
    }
    expect(prompt).not.toMatch(/\n{3,}/);
  });

  it("renders nothing when all sections are empty", () => {
    const values = Object.fromEntries(keys.map((key) => [key, ""]));

    expect(renderTemplate(framework.template, values)).toBe("");
  });

  it("drops only the first section's heading when it alone is empty", () => {
    const [first, second] = framework.sections;
    const values = Object.fromEntries(
      keys.filter((key) => key !== first.key).map((key) => [key, "filled"]),
    );

    const prompt = renderTemplate(framework.template, values);

    expect(prompt).not.toContain(`# ${first.label}`);
    expect(prompt.startsWith(`# ${second.label}\nfilled`)).toBe(true);
  });
});
