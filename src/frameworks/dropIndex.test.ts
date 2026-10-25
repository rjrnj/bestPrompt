import { describe, expect, it } from "vitest";
import { dropIndex } from "./dropIndex";

// Three rows, 10 high, one under the other: middles at 5, 15 and 25.
const rows = [
  { top: 0, bottom: 10 },
  { top: 10, bottom: 20 },
  { top: 20, bottom: 30 },
];

describe("dropIndex", () => {
  it("above_every_row_is_the_top", () => {
    expect(dropIndex(rows, 2, -5)).toBe(0);
  });

  it("below_every_row_is_the_bottom", () => {
    expect(dropIndex(rows, 0, 100)).toBe(2);
  });

  it("lands_after_the_rows_whose_middle_is_passed", () => {
    expect(dropIndex(rows, 0, 14)).toBe(0);
    expect(dropIndex(rows, 0, 16)).toBe(1);
    expect(dropIndex(rows, 0, 26)).toBe(2);
    expect(dropIndex(rows, 2, 6)).toBe(1);
  });

  it("ignores_the_dragged_row_itself", () => {
    expect(dropIndex(rows, 1, 16)).toBe(1);
    expect(dropIndex(rows, 1, 14)).toBe(1);
    expect(dropIndex(rows, 1, 4)).toBe(0);
  });
});
