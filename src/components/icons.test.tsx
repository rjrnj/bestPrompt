import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Arrow, Check, Chevron, Cross, Gear, Grip, Lock } from "./icons";

const icons: [string, () => ReactNode][] = [
  ["Chevron", () => <Chevron />],
  ["Check", () => <Check />],
  ["Lock", () => <Lock />],
  ["Arrow", () => <Arrow direction="up" />],
  ["Grip", () => <Grip />],
  ["Cross", () => <Cross />],
  ["Gear", () => <Gear />],
];

describe("icons", () => {
  // The icons only repeat what a label or the text beside them says, so
  // screen readers skip them wherever they are used.
  it.each(icons)("decorative_icons_are_hidden: %s", (_, icon) => {
    const { container } = render(icon());
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
