/**
 * `name` as framework names are compared: trimmed, with full Unicode
 * lowercasing, as the backend's name check uses (Rust's `to_lowercase`), not
 * SQLite's ASCII-only NOCASE.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Returns `base`, or `base (2)`, `base (3)`, … — the first not in `taken`, ignoring case. */
export function uniqueName(base: string, taken: string[]): string {
  const keys = new Set(taken.map(nameKey));
  let name = base;
  for (let n = 2; keys.has(nameKey(name)); n++) {
    name = `${base} (${n})`;
  }
  return name;
}
