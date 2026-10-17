import { describe, expect, it } from "vitest";
import { dangerButton, primaryButton } from "./styles";

const classes = (list: string) => list.split(/\s+/);

describe("filled buttons", () => {
  it.each([
    ["primary", primaryButton, "sky"],
    ["danger", dangerButton, "red"],
  ])(
    "the %s button states its dark colours, at rest and on hover",
    (_, list, hue) => {
      expect(classes(list)).toEqual(
        expect.arrayContaining([
          `dark:bg-${hue}-700`,
          "dark:text-white",
          `dark:not-aria-disabled:hover:bg-${hue}-800`,
        ]),
      );
    },
  );
});
