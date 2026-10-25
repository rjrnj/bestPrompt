import { describe, expect, it } from "vitest";
import { dropGap, dropIndex, lineAt } from "./dropIndex";

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

describe("dropGap", () => {
  it("a_row_landing_where_it_is_has_no_gap", () => {
    expect(dropGap(0, 0)).toBeNull();
    expect(dropGap(2, 2)).toBeNull();
  });

  it("moving_up_drops_into_the_gap_above_the_row_it_lands_on", () => {
    expect(dropGap(2, 0)).toBe(0);
    expect(dropGap(2, 1)).toBe(1);
  });

  it("moving_down_drops_into_the_gap_below_the_row_it_passes", () => {
    expect(dropGap(0, 1)).toBe(2);
    expect(dropGap(0, 2)).toBe(3);
  });
});

describe("lineAt", () => {
  it("marks_the_row_below_the_gap", () => {
    expect(lineAt(0, 0, 3)).toBe("before");
    expect(lineAt(2, 2, 3)).toBe("before");
    expect(lineAt(2, 1, 3)).toBeNull();
  });

  it("marks_the_gap_under_every_row_on_the_last_row", () => {
    expect(lineAt(3, 2, 3)).toBe("after");
    expect(lineAt(3, 1, 3)).toBeNull();
  });

  it("marks_nothing_without_a_gap", () => {
    expect(lineAt(null, 0, 3)).toBeNull();
  });
});
