// Runs before every Vitest file: jest-dom matchers and React Testing Library
// cleanup (automatic only when Vitest globals are on, which they are not).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom lacks what Radix Select uses to open and position its list: pointer
// capture, scrollIntoView and ResizeObserver, and what xterm.js needs to open
// a terminal: matchMedia. None of them affect what the tests assert, so
// no-ops suffice (matchMedia answers "no match", the light scheme).
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }) as unknown as MediaQueryList;
