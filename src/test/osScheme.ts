import { vi } from "vitest";

/**
 * Stubs matchMedia with an OS colour scheme the test can flip, and reports
 * the change listeners registered on it.
 */
export function osScheme(initial: "light" | "dark") {
  let dark = initial === "dark";
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return dark;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return {
    flip(to: "light" | "dark") {
      dark = to === "dark";
      listeners.forEach((fn) => fn());
    },
    listeners,
  };
}
