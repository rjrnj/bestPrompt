/** A row's vertical extent on screen, as from getBoundingClientRect. */
export type RowBounds = { top: number; bottom: number };

/**
 * Where the row at `from` lands when dropped at height `y`: after every other
 * row whose middle is above `y`. The result is the row's index once moved.
 */
export function dropIndex(rows: RowBounds[], from: number, y: number): number {
  return rows.filter((row, i) => i !== from && (row.top + row.bottom) / 2 < y)
    .length;
}

/**
 * The gap the row at `from` would be dropped into, counted in the rows'
 * order before the move: 0 is above the first row, n below the n-th. Null
 * when it would land where it already is.
 */
export function dropGap(from: number, to: number): number | null {
  if (to === from) return null;
  return to < from ? to : to + 1;
}

/**
 * Where the line marking `gap` goes on the row at `index` of `count`: above
 * it, below it (the last row only, for the gap under every row), or not.
 */
export function lineAt(
  gap: number | null,
  index: number,
  count: number,
): "before" | "after" | null {
  if (gap === index) return "before";
  if (gap === count && index === count - 1) return "after";
  return null;
}
