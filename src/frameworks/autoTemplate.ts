import type { Section } from "../bindings/Section";

// The automatic template: each section is an optional block holding its label
// as a heading and its value. Labels are not template text, so a label can't
// contain `{{`; the editor rejects such labels.

/** The template text for one section: `{{#k}}# Label\n{{k}}{{/k}}`. */
export function sectionBlock(section: Section): string {
  const { key, label } = section;
  return `{{#${key}}}# ${label}\n{{${key}}}{{/${key}}}`;
}

/** The template for `sections`: one block each, separated by a blank line. */
export function autoTemplate(sections: Section[]): string {
  return sections.map(sectionBlock).join("\n\n");
}

/** Whether `template` is exactly what `autoTemplate` would generate. */
export function isAutomatic(template: string, sections: Section[]): boolean {
  return template === autoTemplate(sections);
}
