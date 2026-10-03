/**
 * bd-5rz1v.12 — the new UI's design tokens, in ONE place.
 *
 * Direction B, option 2 ("indigo menu bar"): light screens, big rows, one
 * bottom action button, and indigo framing the screen top and bottom. Values
 * come from the chosen mockups (NIETE Portal Coaching,
 * versions/v5_direction-b-brand/direction-b.html, then
 * versions/v6_deep-screens/deep-screens.html for the final colour rule).
 *
 * THE COLOUR RULE (operator, 2026-10-03 — "still too much colour"):
 *   indigo  the frame (heading band, menu bar) and anything SELECTED
 *   green   every primary button, every progress bar, and "done"
 *   amber   waiting / warning        red   errors and destructive actions
 *   feature colour  ONLY the small icon in the page heading, on a soft white tile
 *   everything else neutral grey — row icons, subject icons, badges, scores, values
 *
 * tailwind.config.ts builds the `nu-*` colours from `tailwindColors` below, so a
 * class such as `bg-nu-ink` and the hex here cannot drift apart. DESIGN.md next
 * to this file has the rules and the spacing in full.
 *
 * Plain hex on purpose: the existing theme is HSL CSS variables shared with the
 * old UI, and nothing here may change a page that is not on the new UI.
 */

/** The NIETE logo colours and the action button. */
export const BRAND = {
  /** Logo indigo — the frame and the selection. */
  ink: '#333748',
  /** Lighter tints of the indigo. */
  ink2: '#454a60',
  inkLight: '#e8e9f0',
  inkXLight: '#f3f3f7',
  /** Shadow under an indigo button. */
  inkEdge: '#1d2030',
  /** Logo green — the active menu icon and progress. */
  leaf: '#48b078',
  leafLight: '#e2f3e9',
  /** The primary action button, and its 3D edge. */
  button: '#2e7d57',
  buttonEdge: '#1e5c3f',
  /** Keyboard focus ring — visible on indigo and on white. */
  focus: '#fdb022',
} as const;

/** The indigo menu bar (bottom on a phone, top on a desktop). */
export const NAV = {
  background: BRAND.ink,
  /** Labels and icons of the items she is not on. */
  label: '#b9bccb',
  /** The item she is on: white label… */
  active: '#ffffff',
  /** …and its icon in logo green (never its feature colour), in a translucent pill. */
  activeIcon: BRAND.leaf,
} as const;

/** The light screen the content sits on. */
export const SURFACE = {
  page: '#f4f5f8',
  card: '#ffffff',
  /** Body text, and every VALUE in a row. */
  text: '#141826',
  muted: '#666b80',
  line: '#e3e5ec',
  /** The chevron at the end of a row, and a sheet's grab handle. */
  chevron: '#a0a4b4',
  handle: '#c9ccd6',
} as const;

/** INDIGO, part 1 — the frame: the page-heading band and the menu bar, white on indigo. */
export const FRAME = {
  background: BRAND.ink,
  text: '#ffffff',
  /** Back button, context chips, and the active menu item's pill. */
  translucent: 'rgba(255,255,255,0.14)',
  /** The heading band's bottom corners, in px. The menu bar's corners are square. */
  headingRadius: 24,
} as const;

/**
 * INDIGO, part 2 — anything selected: a picked grade number, a quiz answer, a
 * toggle, a selected filter chip, the current row.
 */
export const SELECTION = { colour: BRAND.ink, tint: BRAND.inkLight, text: '#ffffff' } as const;

/**
 * GREEN, AMBER, RED — the same buttons in every feature. Every primary action is
 * the button green; a feature colour never changes it. Secondary is a white
 * outline button; warning amber; destructive red.
 */
export const BUTTON = {
  primary: { background: BRAND.button, edge: BRAND.buttonEdge, text: '#ffffff' },
  secondary: { background: '#ffffff', border: SURFACE.line, text: SURFACE.text },
  warning: { background: '#b54708', edge: '#7a2e04', text: '#ffffff' },
  destructive: { background: '#c8331f', edge: '#8a1f12', text: '#ffffff' },
  disabled: { background: '#d7d9e0', text: '#8c90a0' },
} as const;

/** GREEN — every progress bar (on an indigo-light track). */
export const PROGRESS = { bar: BRAND.leaf, track: BRAND.inkLight } as const;

/** GREEN — a "done" icon (a check on a row). */
export const DONE = { icon: BRAND.button, background: BRAND.leafLight } as const;

/**
 * Status chips carry MEANING, never a feature colour: green done/sent/ready,
 * amber waiting/warning ("3 min", "Writing", "24h wait"), red error, grey info.
 */
export const STATUS = {
  done: { text: BRAND.buttonEdge, background: BRAND.leafLight },
  warning: { text: BUTTON.warning.background, background: '#fef0c7' },
  error: { text: BUTTON.destructive.background, background: '#fde6e2' },
  info: { text: BRAND.ink, background: BRAND.inkLight },
} as const;

/**
 * NEUTRAL GREY — everything else: row icons, subject icons, provider badges,
 * trophies, scores. `quiet` is for a secondary, muted tile.
 */
export const NEUTRAL = { tile: BRAND.inkXLight, icon: BRAND.ink, quietTile: '#f1f2f5', quietIcon: SURFACE.muted } as const;

/**
 * FEATURE COLOUR — ONLY the small icon in the page heading, drawn in a light
 * tint on a soft white tile over the indigo band. Nowhere else: not on buttons,
 * values, chips, rows, the menu, or icons inside the feature. The mockup sets
 * three; My Classes, Results and Certificates get theirs when their screens move.
 */
export const FEATURE_ICON = {
  tile: 'rgba(255,255,255,0.12)',
  lessonPlans: '#7fd6a6',
  training: '#8bb8f7',
  assessment: '#b8a8f8',
} as const;

/**
 * The hue each feature owns, kept ON RECORD only (Direction B's first pass). It
 * is NOT drawn on screen under the colour rule above — it is what a feature's
 * heading-icon tint is picked from. Deliberately not exported to Tailwind.
 * "Tests" / "Assessment Generator" is called Assessment.
 */
export const FEATURE_HUE = {
  lessonPlans: { colour: BRAND.button, tint: BRAND.leafLight },
  training: { colour: '#1d6fd8', tint: '#e1edfd' },
  myClasses: { colour: '#d9530b', tint: '#ffeadb' },
  assessment: { colour: '#6e52e0', tint: '#ece8fd' },
  results: { colour: '#0b8a7c', tint: '#d3f6ee' },
  certificates: { colour: '#b54708', tint: '#fef0c7' },
} as const;

/** Every tap target is at least this tall and wide (DESIGN.md rule 3). */
export const TAP_MIN_PX = 56;

const chip = (c: { text: string; background: string }) => ({ DEFAULT: c.text, bg: c.background });

/**
 * The Tailwind palette, under `nu` (new UI): `bg-nu-ink`, `text-nu-leaf`,
 * `text-nu-nav-label`, `bg-nu-neutral-tile`, … Built from the objects above;
 * do not add a hex here that is not one of them.
 */
export const tailwindColors = {
  ink: { DEFAULT: BRAND.ink, 2: BRAND.ink2, light: BRAND.inkLight, xlight: BRAND.inkXLight, edge: BRAND.inkEdge },
  leaf: { DEFAULT: BRAND.leaf, light: BRAND.leafLight },
  // bg-nu-button (+ its edge as a shadow); bg-nu-button-warning, -destructive, … (BUTTON)
  button: {
    DEFAULT: BUTTON.primary.background,
    edge: BUTTON.primary.edge,
    secondary: BUTTON.secondary.background,
    'secondary-border': BUTTON.secondary.border,
    warning: BUTTON.warning.background,
    'warning-edge': BUTTON.warning.edge,
    destructive: BUTTON.destructive.background,
    'destructive-edge': BUTTON.destructive.edge,
    disabled: BUTTON.disabled.background,
    'disabled-text': BUTTON.disabled.text,
  },
  // border-nu-select / bg-nu-select-tint (SELECTION)
  select: { DEFAULT: SELECTION.colour, tint: SELECTION.tint },
  // text-nu-chip-done + bg-nu-chip-done-bg, … (STATUS; `selected` = a picked filter chip)
  chip: {
    done: chip(STATUS.done), warning: chip(STATUS.warning), error: chip(STATUS.error), info: chip(STATUS.info),
    selected: { DEFAULT: SELECTION.text, bg: SELECTION.colour },
  },
  // bg-nu-progress on bg-nu-progress-track (PROGRESS)
  progress: { DEFAULT: PROGRESS.bar, track: PROGRESS.track },
  // text-nu-done on bg-nu-done-bg (DONE)
  done: { DEFAULT: DONE.icon, bg: DONE.background },
  // bg-nu-neutral-tile + text-nu-neutral-icon (NEUTRAL)
  neutral: { tile: NEUTRAL.tile, icon: NEUTRAL.icon, quiet: NEUTRAL.quietTile, 'quiet-icon': NEUTRAL.quietIcon },
  // bg-nu-f-tile + text-nu-f-training: the page-heading icon ONLY (FEATURE_ICON)
  f: {
    tile: FEATURE_ICON.tile,
    'lesson-plans': FEATURE_ICON.lessonPlans,
    training: FEATURE_ICON.training,
    assessment: FEATURE_ICON.assessment,
  },
  // bg-nu-frame-translucent: back button, context chips, the active menu pill (FRAME)
  frame: { translucent: FRAME.translucent },
  focus: BRAND.focus,
  'nav-label': NAV.label,
  surface: {
    DEFAULT: SURFACE.page, card: SURFACE.card, text: SURFACE.text, muted: SURFACE.muted, line: SURFACE.line,
    chevron: SURFACE.chevron, handle: SURFACE.handle,
  },
};
