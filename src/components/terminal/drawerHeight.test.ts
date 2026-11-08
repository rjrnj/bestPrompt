import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARE,
  drawerShare,
  heightFor,
  minShare,
  steppedShare,
} from "./drawerHeight";

// An area 1000 px tall whose top is 100 px down the window.
const top = 100;
const height = 1000;

describe("the drawer's height", () => {
  it("the_height_can_be_dragged_to_the_whole_window", () => {
    // The drawer runs from the pointer to the bottom of the area.
    expect(heightFor(700, top, height)).toBeCloseTo(0.4);
    expect(heightFor(300, top, height)).toBeCloseTo(0.8);
    expect(heightFor(top, top, height)).toBe(1);
    // Above the area it is the whole area; below, the minimum.
    expect(heightFor(0, top, height)).toBe(1);
    expect(heightFor(1500, top, height)).toBeCloseTo(0.12);
  });

  it("near_the_top_it_snaps_to_full_height", () => {
    expect(heightFor(top + 10, top, height)).toBe(1);
    expect(heightFor(top + 20, top, height)).toBeCloseTo(0.98);
  });

  it("never goes below about 120 px, or above the area", () => {
    expect(minShare(1000)).toBeCloseTo(0.12);
    expect(minShare(100)).toBe(1);
    expect(minShare(0)).toBe(0);
    expect(heightFor(1090, top, height)).toBeCloseTo(0.12);
  });

  it("steps by 5% within its bounds", () => {
    expect(steppedShare(0.4, 1, height)).toBeCloseTo(0.45);
    expect(steppedShare(0.4, -1, height)).toBeCloseTo(0.35);
    expect(steppedShare(0.98, 1, height)).toBe(1);
    expect(steppedShare(0.14, -1, height)).toBeCloseTo(0.12);
  });

  it("is 40% by default, the whole area when maximized", () => {
    const drawer = { open: true, height: null, maximized: false };
    expect(DEFAULT_SHARE).toBe(0.4);
    expect(drawerShare(drawer, height)).toBe(0.4);
    expect(drawerShare({ ...drawer, height: 0.7 }, height)).toBe(0.7);
    expect(drawerShare({ ...drawer, maximized: true }, height)).toBe(1);
    // A height chosen in a taller window still keeps the minimum.
    expect(drawerShare({ ...drawer, height: 0.05 }, height)).toBeCloseTo(0.12);
  });
});
