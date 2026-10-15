// Prompt templates: `{{key}}` inserts a section's value, and
// `{{#key}} … {{/key}}` wraps text that is dropped when that value is blank.
// `\{{` is a literal `{{`; every other backslash is ordinary text.

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
  const root: TemplateNode[] = [];
  const stack: { key: string; offset: number; children: TemplateNode[] }[] = [];
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
    if (open > 0 && src[open - 1] === "\\") {
      // `\{{` is a literal `{{`; the backslash is dropped.
      text += src.slice(pos, open - 1) + OPEN;
      pos = open + OPEN.length;
      continue;
    }
    text += src.slice(pos, open);
    const { tag, next } = readTag(src, open);
    pos = next;
    if (tag.kind === "error") {
      return { ok: false, errors: [tag.error] };
    }
    flushText();
    if (tag.kind === "placeholder") {
      current.push({ type: "placeholder", key: tag.key, offset: tag.offset });
    } else if (tag.kind === "open") {
      const block = {
        type: "block" as const,
        key: tag.key,
        offset: tag.offset,
        children: [],
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
        out += (values[node.key] ?? "").trim();
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
 * normalized to LF, values are trimmed, runs of three or more newlines
 * (typically left by a dropped block) collapse to two, and the result has no
 * leading or trailing whitespace.
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
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    normalized[key] = normalizeNewlines(value);
  }
  return renderNodes(parsed.nodes, normalized)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
