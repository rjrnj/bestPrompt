import { describe, expect, it } from "vitest";
import { nameKey, uniqueName } from "./names";

describe("uniqueName", () => {
  it("returns the base when it is free", () => {
    expect(uniqueName("My framework", ["Other"])).toBe("My framework");
  });

  it("adds a counter when the base is taken, ignoring case", () => {
    expect(uniqueName("CO-STAR (copy)", ["co-star (copy)"])).toBe(
      "CO-STAR (copy) (2)",
    );
  });

  it("skips counters that are also taken", () => {
    expect(uniqueName("A", ["a", "A (2)", "a (3)"])).toBe("A (4)");
  });
});

describe("nameKey", () => {
  it("trims and lowercases beyond ASCII", () => {
    expect(nameKey("  Ärger Δ ")).toBe("ärger δ");
  });
});
