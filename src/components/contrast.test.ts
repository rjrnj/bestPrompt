import theme from "tailwindcss/theme.css?raw";
import { describe, expect, it } from "vitest";

// Tailwind v4 states its colours in OKLCH; they are read from its theme file
// and converted to sRGB, so the pairs are checked against the real values.

type Rgb = [number, number, number];

function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  });
  return gamma as Rgb;
}

function rgbOf(name: string): Rgb {
  if (name === "white") return [1, 1, 1];
  if (name === "black") return [0, 0, 0];
  const line = new RegExp(
    String.raw`--color-${name}: oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)`,
  ).exec(theme);
  if (line === null) throw new Error(`No colour ${name} in the theme`);
  return oklchToRgb(Number(line[1]) / 100, Number(line[2]), Number(line[3]));
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(rgbOf(fg));
  const b = luminance(rgbOf(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const UI = 3;

// The rows name the colours styles.ts and the components use: change a row
// whenever its class changes.
// Each pair is a colour from styles.ts or the app shell, on the background
// it sits on. Text needs 4.5 (WCAG 1.4.3); focus rings and component
// boundaries need 3 (1.4.11).
const pairs: { name: string; fg: string; bg: string; min: number }[] = [
  { name: "body text, light", fg: "slate-900", bg: "white", min: TEXT },
  { name: "body text, dark", fg: "slate-100", bg: "slate-950", min: TEXT },
  {
    name: "body text, dark drawer",
    fg: "slate-100",
    bg: "slate-900",
    min: TEXT,
  },
  { name: "field label, light", fg: "slate-700", bg: "white", min: TEXT },
  { name: "field label, dark", fg: "slate-300", bg: "slate-950", min: TEXT },
  { name: "field help, light", fg: "slate-600", bg: "white", min: TEXT },
  { name: "field help, dark", fg: "slate-400", bg: "slate-950", min: TEXT },
  {
    name: "dialog description, light",
    fg: "slate-600",
    bg: "white",
    min: TEXT,
  },
  {
    name: "dialog description, dark",
    fg: "slate-400",
    bg: "slate-900",
    min: TEXT,
  },
  { name: "loading text, light", fg: "slate-500", bg: "white", min: TEXT },
  { name: "loading text, dark", fg: "slate-400", bg: "slate-950", min: TEXT },
  { name: "drawer message, light", fg: "slate-600", bg: "white", min: TEXT },
  { name: "drawer message, dark", fg: "slate-400", bg: "slate-900", min: TEXT },
  {
    name: "drawer folder line, light",
    fg: "slate-700",
    bg: "white",
    min: TEXT,
  },
  {
    name: "drawer folder line, dark",
    fg: "slate-300",
    bg: "slate-900",
    min: TEXT,
  },
  { name: "drawer F6 hint, light", fg: "slate-600", bg: "white", min: TEXT },
  { name: "drawer F6 hint, dark", fg: "slate-400", bg: "slate-900", min: TEXT },
  { name: "error text, light", fg: "red-700", bg: "white", min: TEXT },
  { name: "error text, dark", fg: "red-400", bg: "slate-950", min: TEXT },
  {
    name: "error text, dark dialog",
    fg: "red-400",
    bg: "slate-900",
    min: TEXT,
  },
  { name: "link button, light", fg: "sky-700", bg: "white", min: TEXT },
  { name: "link button, light hover", fg: "sky-900", bg: "white", min: TEXT },
  { name: "link button, dark", fg: "sky-400", bg: "slate-950", min: TEXT },
  {
    name: "link button, dark drawer",
    fg: "sky-400",
    bg: "slate-900",
    min: TEXT,
  },
  {
    name: "link button, dark hover",
    fg: "sky-200",
    bg: "slate-900",
    min: TEXT,
  },
  { name: "primary button", fg: "white", bg: "sky-700", min: TEXT },
  { name: "primary button hover", fg: "white", bg: "sky-800", min: TEXT },
  { name: "danger button", fg: "white", bg: "red-700", min: TEXT },
  { name: "danger button hover", fg: "white", bg: "red-800", min: TEXT },
  { name: "secondary button, light", fg: "slate-900", bg: "white", min: TEXT },
  {
    name: "secondary button, light hover",
    fg: "slate-900",
    bg: "slate-100",
    min: TEXT,
  },
  {
    name: "secondary button, dark",
    fg: "slate-100",
    bg: "slate-800",
    min: TEXT,
  },
  {
    name: "secondary button, dark hover",
    fg: "slate-100",
    bg: "slate-700",
    min: TEXT,
  },
  { name: "selected tab, light", fg: "sky-900", bg: "sky-100", min: TEXT },
  { name: "selected tab, dark", fg: "sky-100", bg: "sky-900", min: TEXT },
  { name: "tab, light", fg: "slate-600", bg: "white", min: TEXT },
  { name: "tab, dark", fg: "slate-400", bg: "slate-950", min: TEXT },
  { name: "waiting note, light", fg: "sky-950", bg: "sky-50", min: TEXT },
  { name: "waiting note, dark", fg: "sky-100", bg: "sky-950", min: TEXT },
  { name: "waiting note close, light", fg: "sky-900", bg: "sky-50", min: TEXT },
  { name: "waiting note close, dark", fg: "sky-100", bg: "sky-950", min: TEXT },
  { name: "focus ring on light", fg: "sky-600", bg: "white", min: UI },
  { name: "focus ring on dark page", fg: "sky-500", bg: "slate-950", min: UI },
  {
    name: "focus ring on dark drawer",
    fg: "sky-500",
    bg: "slate-900",
    min: UI,
  },
  { name: "input border, light", fg: "slate-500", bg: "white", min: UI },
  { name: "input border, dark", fg: "slate-500", bg: "slate-800", min: UI },
];

describe("contrast", () => {
  it.each(pairs)("styles_meet_aa_contrast: $name", ({ fg, bg, min }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("matches known ratios", () => {
    expect(contrast("black", "white")).toBeCloseTo(21, 1);
    expect(contrast("slate-900", "white")).toBeGreaterThan(15);
  });
});
