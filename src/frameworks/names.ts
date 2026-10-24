/** Returns `base`, or `base (2)`, `base (3)`, … — the first not in `taken`, ignoring case. */
export function uniqueName(base: string, taken: string[]): string {
  const lowered = new Set(taken.map((name) => name.toLowerCase()));
  let name = base;
  for (let n = 2; lowered.has(name.toLowerCase()); n++) {
    name = `${base} (${n})`;
  }
  return name;
}
