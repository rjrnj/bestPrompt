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
