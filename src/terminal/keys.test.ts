import { describe, expect, it } from "vitest";
import {
  currentPlatform,
  keyAction,
  type KeyAction,
  type Platform,
} from "./keys";

type Row = {
  name: string;
  key: string;
  ctrl: boolean;
  shift: boolean;
  selection: boolean;
  expected: KeyAction;
};

function row(
  name: string,
  key: string,
  mods: "" | "ctrl" | "ctrl+shift" | "shift",
  selection: boolean,
  expected: KeyAction,
): Row {
  return {
    name,
    key,
    ctrl: mods.includes("ctrl"),
    shift: mods.includes("shift"),
    selection,
    expected,
  };
}

function rows(platform: Platform): Row[] {
  const win = platform === "windows";
  return [
    row("Ctrl+V", "v", "ctrl", false, win ? "paste" : "pass"),
    row("Ctrl+V upper case", "V", "ctrl", false, win ? "paste" : "pass"),
    row("Ctrl+Shift+V", "V", "ctrl+shift", false, "paste"),
    row("Ctrl+C with a selection", "c", "ctrl", true, win ? "copy" : "pass"),
    row("Ctrl+C without a selection", "c", "ctrl", false, "pass"),
    row("Ctrl+Shift+C with a selection", "C", "ctrl+shift", true, "copy"),
    row("Ctrl+Shift+C without a selection", "C", "ctrl+shift", false, "pass"),
    row("Shift+Enter", "Enter", "shift", false, "newline"),
    row("Enter", "Enter", "", false, "pass"),
    row("Ctrl+Enter", "Enter", "ctrl", false, "pass"),
    row("a letter", "a", "", false, "pass"),
  ];
}

describe.each(["windows", "linux"] as const)("keyAction on %s", (platform) => {
  it.each(rows(platform))("$name is $expected", (r) => {
    const e = {
      key: r.key,
      ctrlKey: r.ctrl,
      shiftKey: r.shift,
      altKey: false,
      type: "keydown",
    };
    expect(keyAction(e, platform, r.selection)).toBe(r.expected);
  });

  it("passes anything but a keydown", () => {
    for (const type of ["keyup", "keypress"]) {
      const e = {
        key: "v",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        type,
      };
      expect(keyAction(e, platform, true)).toBe("pass");
    }
  });

  it("passes every combination that includes Alt", () => {
    for (const r of rows(platform)) {
      const e = {
        key: r.key,
        ctrlKey: r.ctrl,
        shiftKey: r.shift,
        altKey: true,
        type: "keydown",
      };
      expect(keyAction(e, platform, r.selection)).toBe("pass");
    }
  });
});

describe("currentPlatform", () => {
  it("is linux when the user agent is not Windows", () => {
    // jsdom's user agent names no Windows.
    expect(currentPlatform()).toBe("linux");
  });
});
