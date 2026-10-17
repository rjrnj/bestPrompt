import { afterEach, describe, expect, it, vi } from "vitest";
import { markOverlayScrollbars } from "./scrollbars";

// jsdom does no layout, so the probe's sizes are stubbed: a classic
// scrollbar makes clientWidth smaller than offsetWidth, an overlay one
// leaves them equal.
function stubScrollbarWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    100 - width,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.overlayScrollbars;
});

describe("markOverlayScrollbars", () => {
  it("marks the page when scrollbars take no width", () => {
    stubScrollbarWidth(0);

    markOverlayScrollbars();

    expect(document.documentElement).toHaveAttribute("data-overlay-scrollbars");
  });

  it("leaves the page unmarked when scrollbars take width", () => {
    stubScrollbarWidth(17);

    markOverlayScrollbars();

    expect(document.documentElement).not.toHaveAttribute(
      "data-overlay-scrollbars",
    );
  });

  it("removes its probe element", () => {
    stubScrollbarWidth(0);
    const before = document.body.childElementCount;

    markOverlayScrollbars();

    expect(document.body.childElementCount).toBe(before);
  });
});
