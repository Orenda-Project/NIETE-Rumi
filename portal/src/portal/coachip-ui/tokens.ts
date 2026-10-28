/**
 * bd-sex15q.42 — the COACHIP design system v1 (design/r6/DESIGN_SYSTEM.md) as constants: the same values as
 * tokens.css, for inline SVG, the Tailwind `cp` colours and tests. Keep the two in step.
 */
export const CP_COLOURS = {
  green: "#47BA7D",
  "green-ink": "#237A4C",
  "green-tint": "#E3F4EA",
  navy: "#333748",
  "navy-deep": "#262937",
  "navy-tint": "#ECEEF3",
  ink: "#1F2230",
  "ink-2": "#5C6170",
  "ink-3": "#8A8F9C",
  hairline: "#E6E8EC",
  track: "#C9CDD3",
  ground: "#F6F8F7",
  surface: "#FFFFFF",
  "grey-fill": "#ECEEF1",
  trend: "#4F46E5",
} as const;

export type CpColour = keyof typeof CP_COLOURS;

/** `theme.extend.colors.cp`: each colour through its variable, so `text-cp-green-ink` only means something under `.cp`. */
export const tailwindCpColours: Record<CpColour, string> = Object.fromEntries(
  Object.keys(CP_COLOURS).map((k) => [k, `var(--cp-${k})`]),
) as Record<CpColour, string>;

/** Ring sizes (DESIGN_SYSTEM §5): the band's hero, a card's headline, a row. Stroke follows the size. */
export const RING = {
  hero: { size: 104, stroke: 10 },
  card: { size: 64, stroke: 7 },
  row: { size: 56, stroke: 6 },
} as const;

export type RingSize = keyof typeof RING;

/** The laptop breakpoint: the rail, the 720 + 320 columns and the band-as-page-head start here. */
export const LAPTOP_MIN_PX = 1024;
export const LAPTOP_QUERY = `(min-width: ${LAPTOP_MIN_PX}px)`;
