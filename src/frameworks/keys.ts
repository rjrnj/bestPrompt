// Section keys are generated from labels: lowercase ASCII letters, digits and
// underscores only, which is what the template parser and the backend accept.

/**
 * Turns a label into a section key that is not in `taken`. Accents are
 * stripped, every run of other characters becomes one `_`, and a label with
 * nothing usable (such as "目的" or "???") becomes `section`. A clash adds
 * `_2`, `_3`, … until the key is free.
 */
export function keyFromLabel(
  label: string,
  taken: ReadonlySet<string>,
): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "section";
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    key = `${base}_${n}`;
  }
  return key;
}
