// The Claude Code drawer's height, as a share of the Builder area: 0 is
// nothing, 1 the whole area. Pure, so the pointer and keyboard maths are
// tested without layout.

import type { State } from "../../state/reducer";

/** The share the drawer takes until the user picks one. */
export const DEFAULT_SHARE = 0.4;
/** The fewest pixels the drawer shrinks to: its header and a few rows. */
export const MIN_PX = 120;
/** How close to the top of the area, as a share, a drag snaps to full. */
const SNAP_SHARE = 0.01;
/** How far an arrow key moves the drawer. */
const STEP = 0.05;

/** The smallest share an area `areaHeight` pixels tall allows. */
export function minShare(areaHeight: number): number {
  if (areaHeight <= 0) return 0;
  return Math.min(1, MIN_PX / areaHeight);
}

function clamp(share: number, areaHeight: number): number {
  return Math.min(1, Math.max(minShare(areaHeight), share));
}

/**
 * The share for a drag whose pointer is at `pointerY`, for an area whose
 * top is at `areaTop`: the drawer runs from the pointer to the bottom of
 * the area. Within 1% of the top it fills the area.
 */
export function heightFor(
  pointerY: number,
  areaTop: number,
  areaHeight: number,
): number {
  if (areaHeight <= 0) return 1;
  const fromTop = pointerY - areaTop;
  if (fromTop <= areaHeight * SNAP_SHARE) return 1;
  return clamp((areaHeight - fromTop) / areaHeight, areaHeight);
}

/** `share` moved one step up (1) or down (-1), within bounds. */
export function steppedShare(
  share: number,
  direction: 1 | -1,
  areaHeight: number,
): number {
  return clamp(share + direction * STEP, areaHeight);
}

/** The share the drawer shows: the whole area when maximized. */
export function drawerShare(
  drawer: State["drawer"],
  areaHeight: number,
): number {
  if (drawer.maximized) return 1;
  return clamp(drawer.height ?? DEFAULT_SHARE, areaHeight);
}
