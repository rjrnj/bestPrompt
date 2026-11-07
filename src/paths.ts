/** How many characters of a folder path a dialog line shows. */
export const FOLDER_MAX_CHARS = 48;

/** The longest prefix of `chars` (code points) that fits `budget` UTF-16 units. */
function takeStart(chars: string[], budget: number): string {
  let out = "";
  for (const c of chars) {
    if (out.length + c.length > budget) break;
    out += c;
  }
  return out;
}

/** The longest suffix of `chars` that fits `budget` UTF-16 units. */
function takeEnd(chars: string[], budget: number): string {
  let out = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    if (out.length + chars[i].length > budget) break;
    out = chars[i] + out;
  }
  return out;
}

/**
 * Shortens a path to at most `max` characters by replacing its middle with
 * "…", keeping the start (drive or root) and the last folder's name. A last
 * folder too long to fit is cut as well. Whole code points are kept, so an
 * emoji is never split.
 */
export function shortenPath(path: string, max: number): string {
  if (max < 1) return "";
  if (path.length <= max) return path;
  const budget = max - 1;
  const chars = Array.from(path);
  // Trailing separators don't count: "/a/b/" ends in the folder "b".
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  const body = end === 0 ? path : path.slice(0, end);
  const lastSep = Math.max(body.lastIndexOf("/"), body.lastIndexOf("\\"));
  const tail = Array.from(body.slice(lastSep < 0 ? 0 : lastSep));
  const tailWidth = tail.join("").length;
  if (tailWidth <= budget) {
    return takeStart(chars, budget - tailWidth) + "…" + tail.join("");
  }
  const headBudget = Math.floor(budget / 2);
  const head = takeStart(chars, headBudget);
  return head + "…" + takeEnd(tail, budget - head.length);
}
