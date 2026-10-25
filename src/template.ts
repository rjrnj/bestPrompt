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

/**
 * A `{{` in a template, with the run of backslashes right before it and the
 * offset where the text after it resumes: past the tag's `}}`, or past the
 * `{{` itself when `tag` is null because an odd run makes it literal.
 */
type Opening = { open: number; slashes: number; tag: Tag | null; next: number };

/** Every `{{` in `src` as `parse` reads them, in order. */
function* openings(src: string): Generator<Opening> {
  let pos = 0;
  for (;;) {
    const open = src.indexOf(OPEN, pos);
    if (open === -1) return;
    // Backslashes right before `{{`: each pair is one literal backslash, and
    // an odd one out makes the `{{` literal text instead of a tag.
    const slashes = slashesBefore(src, open, pos);
    if (slashes % 2 === 1) {
      pos = open + OPEN.length;
      yield { open, slashes, tag: null, next: pos };
    } else {
      const { tag, next } = readTag(src, open);
      pos = next;
      yield { open, slashes, tag, next };
    }
  }
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
  for (const { open, slashes, tag, next } of openings(src)) {
    text += src.slice(pos, open - slashes) + "\\".repeat(slashes >> 1);
    pos = next;
    if (tag === null) {
      text += OPEN;
      continue;
    }
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
  text += src.slice(pos);
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

/** Adds the keys of the placeholders at any depth to `keys`, and of the blocks too with `blocks`. */
function collectKeys(
  nodes: TemplateNode[],
  keys: Set<string>,
  blocks: boolean,
): void {
  for (const node of nodes) {
    if (node.type === "text") continue;
    if (node.type === "placeholder" || blocks) keys.add(node.key);
    if (node.type === "block") {
      collectKeys(node.children, keys, blocks);
    }
  }
}

/** The keys `collectKeys` finds in `template`; empty if it does not parse. */
function keysIn(template: string, blocks: boolean): Set<string> {
  const keys = new Set<string>();
  const parsed = parseTemplate(template);
  if (parsed.ok) {
    collectKeys(parsed.nodes, keys, blocks);
  }
  return keys;
}

/** The keys of the `{{key}}` placeholders at any depth; empty if the template does not parse. */
export function usedKeys(template: string): Set<string> {
  return keysIn(template, false);
}

/** The keys of every placeholder and block at any depth; empty if the template does not parse. */
export function referencedKeys(template: string): Set<string> {
  return keysIn(template, true);
}

/**
 * The keys among `keys` with no `{{key}}` placeholder in the template: their
 * sections' text never reaches the prompt. None when the template does not
 * parse, since which ones it leaves out can't be told then.
 */
export function unusedKeys(template: string, keys: string[]): string[] {
  const parsed = parseTemplate(template);
  if (!parsed.ok) return [];
  const used = new Set<string>();
  collectKeys(parsed.nodes, used, false);
  return keys.filter((key) => !used.has(key));
}

/** A section's `{{key}}` placeholder or `{{#key}}…{{/key}}` block, from `start` to `end`. */
type Piece = {
  start: number;
  end: number;
  kind: "placeholder" | "generated" | "block";
};

/**
 * Whether `block` has the shape of a generated one,
 * `{{#k}}# Heading\n{{k}}{{/k}}`, whatever its heading says: the section may
 * have been renamed since.
 */
function isGenerated(block: Extract<TemplateNode, { type: "block" }>): boolean {
  const [heading, value, ...rest] = block.children;
  return (
    rest.length === 0 &&
    heading?.type === "text" &&
    /^# [^\n]*\n$/.test(heading.value) &&
    value?.type === "placeholder" &&
    value.key === block.key
  );
}

/** The first placeholder or block of `key`, at any depth, in `nodes`. */
function firstPiece(
  nodes: TemplateNode[],
  key: string,
  ends: Map<TemplateNode, number>,
): Piece | undefined {
  for (const node of nodes) {
    if (node.type === "text") continue;
    if (node.key === key) {
      const end = ends.get(node) ?? node.offset;
      if (node.type === "placeholder") {
        return { start: node.offset, end, kind: "placeholder" };
      }
      const kind = isGenerated(node) ? "generated" : "block";
      return { start: node.offset, end, kind };
    }
    if (node.type === "block") {
      const inside = firstPiece(node.children, key, ends);
      if (inside !== undefined) return inside;
    }
  }
  return undefined;
}

function trailingNewlines(text: string): number {
  return text.length - text.replace(/\n+$/, "").length;
}

function leadingNewlines(text: string): number {
  return text.length - text.replace(/^\n+/, "").length;
}

/** `offsets` sorted, without repeats. */
function ascending(offsets: number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => a - b);
}

/** How many backslashes run up to `end` in `text`, not reaching back past `floor`. */
function slashesBefore(text: string, end: number, floor = 0): number {
  let count = 0;
  while (end - count > floor && text[end - count - 1] === "\\") count++;
  return count;
}

/** How many backslashes run from `start` in `text`. */
function slashesFrom(text: string, start: number): number {
  let count = 0;
  while (text[start + count] === "\\") count++;
  return count;
}

/**
 * `src` without `src[start, end)`. `carry` lists offsets in `src` that move
 * with the text before them; one strictly inside the cut is dropped, and one
 * at its start lands where the cut now stands. Returns the new text and,
 * ascending, where the carried offsets, and the cut if `mark`, now stand.
 *
 * Only a run of backslashes right before `{{` is special (see `parse`), so
 * the backslashes on either side of the cut, which now meet, could change
 * meaning. The run before the cut is read as the backslashes it showed: half
 * of it if the cut started at a tag, all of it otherwise. The text after the
 * cut is left as it is, so the run is written out again for it: doubled if
 * that text reaches `{{` past any backslashes of its own, which then keep
 * their meaning too, and as shown otherwise.
 */
function cutOut(
  src: string,
  start: number,
  end: number,
  mark: boolean,
  carry: number[],
): { template: string; spots: number[] } {
  const before = src.slice(0, start);
  const run = slashesBefore(before, start);
  const shown = src.startsWith(OPEN, start) ? run >> 1 : run;
  const opens = src.startsWith(OPEN, end + slashesFrom(src, end));
  const at = start - run;
  const kept = before.slice(0, at) + "\\".repeat(opens ? 2 * shown : shown);
  // Anything inside the rewritten run now stands at its start.
  const spots = carry.flatMap((offset) => {
    if (offset <= start) return [Math.min(offset, at)];
    return offset < end ? [] : [offset - end + kept.length];
  });
  if (mark) spots.push(at);
  return { template: kept + src.slice(end), spots: ascending(spots) };
}

/**
 * Takes one piece out of `text`, with the newlines around it tidied by one
 * rule: at the start of the template the run after it goes too, at the end
 * the run before it, and elsewhere the two runs join into the longer of
 * them, or a blank line where each is a single newline. So no blank line is
 * added or lost, and text on the piece's line stays on it.
 */
function cutPiece(
  text: string,
  { start, end, kind }: Piece,
  carry: number[],
): { template: string; spots: number[] } {
  const left = trailingNewlines(text.slice(0, start));
  const right = leadingNewlines(text.slice(end));
  let from = start;
  let to = end;
  if (start === 0) {
    to += right;
  } else if (end === text.length) {
    from -= left;
  } else {
    to += left + right - Math.min(left + right, Math.max(left, right, 2));
  }
  const sameLine =
    (start > 0 && left === 0) || (end < text.length && right === 0);
  const mark = kind === "placeholder" || (kind === "generated" && sameLine);
  return cutOut(text, from, to, mark, carry);
}

/**
 * Drops the section `key` from a template: every `{{key}}` placeholder and
 * `{{#key}}…{{/key}}` block goes, one at a time, with the newlines around it
 * tidied (see `cutPiece`). What stays renders as it did with the section left
 * blank. `spots` lists, in ascending order, where in the returned template
 * each placeholder stood that was not inside a block of the section's own,
 * and where a generated block stood (see `isGenerated`) that had text on its
 * line, so the caller can point at text that may now read oddly; a
 * hand-written block leaves none. `carry` lists offsets in `template` from an
 * earlier removal: each moves with the text before it, and one strictly
 * inside text that goes is dropped; they are merged into `spots`. A template
 * that does not parse is returned unchanged.
 */
export function removeSectionFromTemplate(
  template: string,
  key: string,
  carry: number[] = [],
): { template: string; spots: number[] } {
  const unchanged = { template, spots: ascending(carry) };
  let result = unchanged;
  for (;;) {
    const ends = new Map<TemplateNode, number>();
    const parsed = parse(result.template, ends);
    if (!parsed.ok) return unchanged;
    const piece = firstPiece(parsed.nodes, key, ends);
    if (piece === undefined) return result;
    result = cutPiece(result.template, piece, result.spots);
  }
}

/**
 * `at`, moved out of anything that text put there would split: past the tag
 * it is inside, or to the start of the run of backslashes right before a
 * `{{` when it is inside or at the end of that run, or inside a literal or
 * unclosed `{{`.
 */
function outsideTags(template: string, at: number): number {
  for (const { open, slashes, tag, next } of openings(template)) {
    if (at <= open - slashes) break;
    // An unclosed `{{` swallows no text: nothing after it is inside a tag.
    const unclosed =
      tag?.kind === "error" && !template.includes(CLOSE, open + OPEN.length);
    const inBraces = (tag === null || unclosed) && at < open + OPEN.length;
    if (at <= open || inBraces) return open - slashes;
    if (unclosed) break;
    if (at < next) return next;
  }
  return at;
}

/** Whether `at` is just past a literal `{{`, whose braces are not ones a tag could join. */
function afterEscape(template: string, at: number): boolean {
  for (const { tag, next } of openings(template)) {
    if (next >= at) return tag === null && next === at;
  }
  return false;
}

/**
 * Puts `{{key}}` in place of `template[start, end)`, and says where the
 * cursor goes after it. It never lands inside a tag, inside a literal or
 * unclosed `{{`, or between a `{{` and the backslashes before it that decide
 * what it is: a cursor inside a tag moves past it, and one inside such a run
 * of backslashes, at its end, or inside a literal or unclosed `{{` moves to
 * the run's start. A selection with either end in such a place replaces nothing,
 * and the tag goes where its end moves to. Backslashes right before the tag
 * are written doubled, so they stay backslashes rather than escaping it, and
 * a `{` before it (other than a literal `{{`'s) is parted from it by a space,
 * as it would join the tag's braces; a `}` after it needs none, since a tag
 * ends at the first `}}`. So when nothing is replaced and `template` parses,
 * the result parses, uses every key `template` did, and renders as it did
 * with `key` blank, apart from that space.
 */
export function insertPlaceholder(
  template: string,
  start: number,
  end: number,
  key: string,
): { template: string; cursor: number } {
  const from = outsideTags(template, start);
  const to = outsideTags(template, end);
  const moved = from !== start || to !== end;
  const at = moved ? to : start;
  let before = template.slice(0, at);
  const after = template.slice(to);
  if (before.endsWith("{")) {
    if (!afterEscape(template, at)) before += " ";
  } else {
    const run = slashesBefore(before, before.length);
    before += "\\".repeat(run);
  }
  const tag = `${OPEN}${key}${CLOSE}`;
  return {
    template: before + tag + after,
    cursor: before.length + tag.length,
  };
}
