import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../public/theme-init.js?raw";
import { osScheme } from "./test/osScheme";
import { windowMock } from "./test/tauriWindow";
import { applyTheme, resetWindowThemeForTests, THEME_CACHE_KEY } from "./theme";

const { setTheme } = windowMock;

const html = document.documentElement;

beforeEach(() => {
  resetWindowThemeForTests();
  setTheme.mockReset();
  setTheme.mockResolvedValue(undefined);
  localStorage.clear();
  delete html.dataset.theme;
  html.style.colorScheme = "";
});
afterEach(() => {
  applyTheme("light");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("applyTheme", () => {
  it("sets the theme, the colour scheme, the cache and the window", () => {
    osScheme("light");
    applyTheme("dark");
    expect(html.dataset.theme).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("keeps one listener, and only while the choice is system", () => {
    const os = osScheme("light");
    applyTheme("system");
    applyTheme("system");
    expect(os.listeners.size).toBe(1);
    expect(setTheme).not.toHaveBeenCalled();
    os.flip("dark");
    expect(html.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(os.listeners.size).toBe(0);
    os.flip("light");
    os.flip("dark");
    expect(html.dataset.theme).toBe("light");
  });

  it("the_first_system_apply_leaves_the_window_theme_alone", () => {
    osScheme("dark");
    applyTheme("system");
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("sets_the_window_theme_back_to_null_after_a_pinned_choice", () => {
    osScheme("light");
    applyTheme("dark");
    applyTheme("system");
    expect(setTheme.mock.calls).toEqual([["dark"], [null]]);
  });

  it("applying_the_same_choice_twice_calls_the_window_once", () => {
    osScheme("light");
    applyTheme("dark");
    applyTheme("dark");
    expect(setTheme).toHaveBeenCalledTimes(1);
  });

  it("survives a rejected setTheme and a throwing localStorage", async () => {
    osScheme("dark");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setTheme.mockRejectedValue(new Error("unsupported"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => applyTheme("dark")).not.toThrow();
    await Promise.resolve();
    expect(html.dataset.theme).toBe("dark");
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("survives the window API throwing outright", () => {
    osScheme("light");
    setTheme.mockImplementation(() => {
      throw new Error("no bridge");
    });
    expect(() => applyTheme("dark")).not.toThrow();
    expect(html.dataset.theme).toBe("dark");
  });
});

describe("the first paint script", () => {
  const run = () => new Function(source)();

  it("applies a cached dark or light choice over the OS", () => {
    osScheme("light");
    localStorage.setItem(THEME_CACHE_KEY, "dark");
    run();
    expect(html.dataset.theme).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");

    osScheme("dark");
    localStorage.setItem(THEME_CACHE_KEY, "light");
    run();
    expect(html.dataset.theme).toBe("light");
    expect(html.style.colorScheme).toBe("light");
  });

  it("follows the OS for a cached system, a missing or a garbage value", () => {
    osScheme("dark");
    for (const cached of ["system", null, "purple"]) {
      delete html.dataset.theme;
      if (cached === null) localStorage.removeItem(THEME_CACHE_KEY);
      else localStorage.setItem(THEME_CACHE_KEY, cached);
      run();
      expect(html.dataset.theme).toBe("dark");
    }
  });

  it("follows the OS when localStorage throws", () => {
    osScheme("dark");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(run).not.toThrow();
    expect(html.dataset.theme).toBe("dark");
  });
});
