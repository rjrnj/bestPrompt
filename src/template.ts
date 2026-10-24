import { sectionBlock } from "./frameworks/autoTemplate";
import type { Section } from "./bindings/Section";

// Prompt templates: `{{key}}` inserts a section's value, and
// `{{#key}} … {{/key}}` wraps text that is dropped when that value is blank.
// `\{{` is a literal `{{` and `\\{{` is a backslash followed by a tag; a
// backslash anywhere else is ordinary text.

export type TemplateNode =
  | { type: "text"; value: string }
  | { type: "placeholder"; key: string; offset: number }
  | { type: "block"; key: string; offset: number; children: TemplateNode[] };

export type TemplateError = { message: string; offset: number };

export type ParseResult =
  { ok: true; nodes: TemplateNode[] } | { ok: false; errors: TemplateError[] };

export class TemplateSyntaxError extends Error {
  readonly errors: TemplateError[];

  constructor(errors: TemplateError[]) {
    super(errors.map((e) => e.message).join("; "));
    this.name = "TemplateSyntaxError";
    this.errors = errors;
  }
}

const OPEN = "{{";
const CLOSE = "}}";

type Tag =
  | { kind: "placeholder" | "open" | "close"; key: string; offset: number }
  | { kind: "error"; error: TemplateError };

/** Reads the tag that starts at `start` (where `{{` is) and returns it with the offset just past its `}}`. */
function readTag(src: string, start: number): { tag: Tag; next: number } {
  const close = src.indexOf(CLOSE, start + OPEN.length);
  if (close === -1) {
    const error = { message: "Tag is missing its closing }}", offset: start };
    return { tag: { kind: "error", error }, next: src.length };
  }
  const next = close + CLOSE.length;
  let body = src.slice(start + OPEN.length, close).trim();
  let kind: "placeholder" | "open" | "close" = "placeholder";
  if (body.startsWith("#")) {
    kind = "open";
    body = body.slice(1).trim();
  } else if (body.startsWith("/")) {
    kind = "close";
    body = body.slice(1).trim();
  }
  if (body === "") {
    const error = { message: "Tag has no key", offset: start };
    return { tag: { kind: "error", error }, next };
  }
  if (/[\s{}]/.test(body)) {
    const error = { message: `Invalid key "${body}"`, offset: start };
    return { tag: { kind: "error", error }, next };
  }
  return { tag: { kind, key: body, offset: start }, next };
}

export function parseTemplate(src: string): ParseResult {
  return parse(src);
}

/** Parses `src`; when `ends` is given, it receives the offset just past each tag or block. */
function parse(src: string, ends?: Map<TemplateNode, number>): ParseResult {
  const root: TemplateNode[] = [];
  const stack: Extract<TemplateNode, { type: "block" }>[] = [];
  let current = root;
  let text = "";
  const flushText = () => {
    if (text !== "") {
      current.push({ type: "text", value: text });
      text = "";
    }
  };

  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf(OPEN, pos);
    if (open === -1) {
      text += src.slice(pos);
      break;
    }
    // Backslashes right before `{{`: each pair is one literal backslash, and
    // an odd one out makes the `{{` literal text instead of a tag.
    let slashes = 0;
    while (open - slashes > pos && src[open - slashes - 1] === "\\") {
      slashes++;
    }
    text += src.slice(pos, open - slashes) + "\\".repeat(slashes >> 1);
    if (slashes % 2 === 1) {
      text += OPEN;
      pos = open + OPEN.length;
      continue;
    }
    const { tag, next } = readTag(src, open);
    pos = next;
    if (tag.kind === "error") {
      return { ok: false, errors: [tag.error] };
    }
    flushText();
    if (tag.kind === "placeholder") {
      const node: TemplateNode = {
        type: "placeholder",
        key: tag.key,
        offset: tag.offset,
      };
      current.push(node);
      ends?.set(node, next);
    } else if (tag.kind === "open") {
      const block = {
        type: "block" as const,
        key: tag.key,
        offset: tag.offset,
        children: [] as TemplateNode[],
      };
      current.push(block);
      stack.push(block);
      current = block.children;
    } else {
      const block = stack.pop();
      if (block === undefined) {
        const message = `{{/${tag.key}}} has no matching {{#${tag.key}}}`;
        return { ok: false, errors: [{ message, offset: tag.offset }] };
      }
      if (block.key !== tag.key) {
        const message = `{{/${tag.key}}} closes {{#${block.key}}}; expected {{/${block.key}}}`;
        return { ok: false, errors: [{ message, offset: tag.offset }] };
      }
      ends?.set(block, next);
      current = stack.length > 0 ? stack[stack.length - 1].children : root;
    }
  }
  flushText();

  const unclosed = stack[0];
  if (unclosed !== undefined) {
    const message = `Block {{#${unclosed.key}}} is never closed`;
    return { ok: false, errors: [{ message, offset: unclosed.offset }] };
  }
  return { ok: true, nodes: root };
}

/** Lists every key the template refers to that is not one of `sectionKeys`. */
function unknownKeys(
  nodes: TemplateNode[],
  known: Set<string>,
  errors: TemplateError[],
): void {
  for (const node of nodes) {
    if (node.type === "text") continue;
    if (!known.has(node.key)) {
      errors.push({
        message: `Unknown key "${node.key}"`,
        offset: node.offset,
      });
    }
    if (node.type === "block") {
      unknownKeys(node.children, known, errors);
    }
  }
}

/**
 * Checks a template against the keys of the sections it will be rendered
 * with. An empty result means the template parses and uses only known keys.
 */
export function validateTemplate(
  template: string,
  sectionKeys: string[],
): TemplateError[] {
  const parsed = parseTemplate(template);
  if (!parsed.ok) {
    return parsed.errors;
  }
  const errors: TemplateError[] = [];
  unknownKeys(parsed.nodes, new Set(sectionKeys), errors);
  return errors;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/** Drops leading blank lines and trailing whitespace, keeping the first line's indentation. */
function trimValue(value: string): string {
  return value.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}

function renderNodes(
  nodes: TemplateNode[],
  values: Record<string, string>,
): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "placeholder":
        out += trimValue(values[node.key] ?? "");
        break;
      case "block":
        if (!isBlank(values[node.key])) {
          out += renderNodes(node.children, values);
        }
        break;
    }
  }
  return out;
}

/**
 * Renders a template with the given section values. Line endings are
 * normalized to LF, each value loses its leading blank lines and trailing
 * whitespace, runs of three or more newlines (typically left by a dropped
 * block) collapse to two, and the result has no leading or trailing
 * whitespace.
 *
 * @throws {TemplateSyntaxError} if the template does not parse.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  const parsed = parseTemplate(normalizeNewlines(template));
  if (!parsed.ok) {
    throw new TemplateSyntaxError(parsed.errors);
  }
  // No prototype, so a key such as `constructor` or `__proto__` is looked up
  // like any other and finds only what the caller supplied.
  const normalized: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    normalized[key] = normalizeNewlines(value);
  }
  return renderNodes(parsed.nodes, normalized)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectUsed(nodes: TemplateNode[], used: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "placeholder") {
      used.add(node.key);
    } else if (node.type === "block") {
      collectUsed(node.children, used);
    }
  }
}

/** The keys of the `{{key}}` placeholders at any depth; empty if the template does not parse. */
export function usedKeys(template: string): Set<string> {
  const used = new Set<string>();
  const parsed = parseTemplate(template);
  if (parsed.ok) {
    collectUsed(parsed.nodes, used);
  }
  return used;
}

type Removal = { start: number; end: number; spot: boolean };

function collectRemovals(
  nodes: TemplateNode[],
  key: string,
  ends: Map<TemplateNode, number>,
  out: Removal[],
): void {
  for (const node of nodes) {
    if (node.type === "text") continue;
    const end = ends.get(node) ?? node.offset;
    if (node.key === key) {
      out.push({ start: node.offset, end, spot: node.type === "placeholder" });
    } else if (node.type === "block") {
      collectRemovals(node.children, key, ends, out);
    }
  }
}

/**
 * Drops a section from a template. Its generated block goes with the blank
 * line that separated it from a neighbour; any other `{{#key}}…{{/key}}` block
 * of the section goes whole, and so does every remaining `{{key}}`
 * placeholder. `spots` lists, in ascending order, where in the returned
 * template each placeholder stood that was not inside a block of the
 * section's own, so the caller can point at text that may now read oddly.
 * A template that does not parse is returned unchanged.
 */
export function removeSectionFromTemplate(
  template: string,
  section: Section,
): { template: string; spots: number[] } {
  const unchanged = { template, spots: [] };
  if (!parseTemplate(template).ok) return unchanged;

  let text = template;
  const block = sectionBlock(section);
  const at = text.indexOf(block);
  if (at !== -1) {
    const sep = "\n\n";
    if (at >= sep.length && text.startsWith(sep, at - sep.length)) {
      text = text.slice(0, at - sep.length) + text.slice(at + block.length);
    } else if (at === 0 && text.startsWith(sep, block.length)) {
      text = text.slice(0, at) + text.slice(at + block.length + sep.length);
    } else {
      text = text.slice(0, at) + text.slice(at + block.length);
    }
  }

  const ends = new Map<TemplateNode, number>();
  const parsed = parse(text, ends);
  if (!parsed.ok) return unchanged;
  const removals: Removal[] = [];
  collectRemovals(parsed.nodes, section.key, ends, removals);

  let out = "";
  let last = 0;
  const spots: number[] = [];
  for (const { start, end, spot } of removals) {
    out += text.slice(last, start);
    if (spot) spots.push(out.length);
    last = end;
  }
  out += text.slice(last);
  return { template: out, spots };
}
