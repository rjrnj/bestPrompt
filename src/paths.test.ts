import { describe, expect, it } from "vitest";
import { shortenPath } from "./paths";

const loneSurrogate =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("shortenPath", () => {
  it("returns a path that fits unchanged", () => {
    expect(shortenPath("C:\\work\\api", 11)).toBe("C:\\work\\api");
    expect(shortenPath("/home/me", 48)).toBe("/home/me");
  });

  it("shortens a long Windows path in the middle", () => {
    const path = "C:\\Users\\someone\\Documents\\Projects\\clients\\acme\\api";
    const out = shortenPath(path, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.startsWith("C:\\Users")).toBe(true);
    expect(out.endsWith("\\api")).toBe(true);
    expect(out).toContain("…");
  });

  it("shortens a long Unix path in the middle", () => {
    const path = "/home/someone/projects/clients/acme/services/billing-api";
    const out = shortenPath(path, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.startsWith("/home")).toBe(true);
    expect(out.endsWith("/billing-api")).toBe(true);
    expect(out).toContain("…");
  });

  it("cuts a last segment that is longer than max", () => {
    const path = "/home/me/" + "x".repeat(100);
    const out = shortenPath(path, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toContain("…");
  });

  it("never splits a surrogate pair", () => {
    for (let max = 8; max < 24; max++) {
      const path = "/a😀😀😀😀😀/b😀😀😀😀😀/c😀😀😀😀😀/d😀😀😀😀😀";
      const out = shortenPath(path, max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out).not.toMatch(loneSurrogate);
      const long = shortenPath("😀".repeat(40), max);
      expect(long.length).toBeLessThanOrEqual(max);
      expect(long).not.toMatch(loneSurrogate);
    }
  });

  it("never returns more than max, even for a tiny max", () => {
    const path = "/home/someone/projects";
    expect(shortenPath(path, 0)).toBe("");
    expect(shortenPath(path, -3)).toBe("");
    for (let max = 1; max <= 6; max++) {
      expect(shortenPath(path, max).length).toBeLessThanOrEqual(max);
    }
    expect(shortenPath(path, 1)).toBe("…");
  });

  it("keeps a last folder that fits exactly", () => {
    // "…" plus "/billing" is 9 characters.
    const out = shortenPath("/home/someone/projects/billing", 9);
    expect(out).toBe("…/billing");
  });

  it("keeps the last folder's name despite a trailing separator", () => {
    const win = shortenPath(
      "C:\\Users\\someone\\Documents\\clients\\api\\",
      20,
    );
    expect(win.length).toBeLessThanOrEqual(20);
    expect(win).toContain("api");
    const unix = shortenPath("/home/someone/projects/clients/api/", 20);
    expect(unix.length).toBeLessThanOrEqual(20);
    expect(unix).toContain("api");
  });
});
