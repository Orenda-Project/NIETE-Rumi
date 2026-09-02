// Design tokens for the LP diagram engine.
// Kept in one place so a region/brand swap is a CONFIG edit, not a code edit.
// Palette from PLAN_lp_v8_html_2026-08-30.md §1 "Design tokens".
//
// Colours are emitted as `var(--navy, #0B2545)`. Verified in headless Chrome:
// CSS custom properties DO resolve inside SVG presentation attributes, and the
// fallback is used when the property is not defined. So one string works in both
// places we render — inside L1's lesson-plan page (inherits the LP palette) and
// standalone in the test wrapper / gallery (falls back to these literals).

const v = (name, hex) => `var(--${name}, ${hex})`;

const C = {
  ink: v("navy", "#0B2545"), // navy — primary structure, headings, axes
  accent: v("amber", "#F2A20C"), // amber — emphasis, highlights, shaded cells
  leaf: v("leaf", "#1F7A4D"), // green — positive / correct / plant
  warn: v("warn", "#9B2C2C"), // deep red — misconception, danger, negative
  cool: v("cool", "#1B6CA8"), // blue — water, secondary series
  plum: v("plum", "#6B3FA0"), // purple — tertiary series
  clay: v("clay", "#B5651D"), // terracotta — quaternary series
  teal: v("teal", "#14524F"), // deep teal — the G7 diagram-prompt palette

  text: v("ink", "#1A1A1A"),
  muted: v("mut", "#6D6D6D"),
  faint: v("faint", "#9AA3AD"),
  rule: v("line", "#D9DDE3"), // hairlines, gridlines
  panel: "#FCFCFD", // panel background — literal: must stay light in print
  wash: "#FDF6EC", // amber wash for notes
  paper: "#FFFFFF",
};

// Literal hexes, for the few places a real colour value is required (e.g. an
// opacity blend computed in JS, or a library that parses the string itself).
const HEX = {
  ink: "#0B2545",
  accent: "#F2A20C",
  leaf: "#1F7A4D",
  warn: "#9B2C2C",
  cool: "#1B6CA8",
  plum: "#6B3FA0",
  clay: "#B5651D",
  teal: "#14524F",
  text: "#1A1A1A",
  muted: "#6D6D6D",
  rule: "#D9DDE3",
};

// Deterministic series palette — index N always gives the same colour.
const SERIES = [C.ink, C.accent, C.leaf, C.cool, C.plum, C.warn, C.clay, C.teal];

const FONT = {
  latin: "Inter, 'Helvetica Neue', Arial, sans-serif",
  urdu: "'Noto Nastaliq Urdu', 'Gulzar', 'Noto Naskh Arabic', serif",
  mono: "'SF Mono', 'DejaVu Sans Mono', Consolas, monospace",
};

// Type scale in SVG *user units*. A diagram body is designed ~640 units wide and
// is rendered into a ~700 px LP content column, so 1 unit ≈ 1.09 px. L1's floor
// is 13 px at a 794 px page width, hence a 12-unit minimum here. Nothing in a
// diagram may be smaller than SIZE.tiny — test.js fails the build if it is.
const SIZE = {
  big: 22,
  title: 17,
  label: 14.5,
  caption: 13.5,
  small: 13,
  tiny: 12,
};

// Nastaliq needs ~2x the leading of Latin or ascenders/descenders collide.
// NOTE: `urdu` is used for *layout arithmetic* (reserving vertical space) only.
// The CSS we emit says `line-height: normal` — a fixed line-height clips the
// diagonal descenders of ک/گ (noto-fonts#198). Never pin an Urdu box height.
const LEADING = { latin: 1.3, urdu: 2.2 };

module.exports = { C, HEX, SERIES, FONT, SIZE, LEADING };
