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
 *   feature colour  ONLY the feature's own icon (heading tile / breadcrumb)
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
  /** The border of an unticked toggle's box (bd-5rz1v.19; mockup `.tog .box`). */
  box: '#c7cad6',
  /** The dimmed page behind a sheet (bd-5rz1v.19; mockup `.scrim`). */
  scrim: 'rgba(20,24,38,0.5)',
} as const;

/**
 * INDIGO, part 1 — the frame: the flat heading band of a feature's MAIN page
 * and the menu bar, white on indigo, square corners on both.
 */
export const FRAME = {
  background: BRAND.ink,
  text: '#ffffff',
  /** Context chips on the band, and the active menu item's pill. */
  translucent: 'rgba(255,255,255,0.14)',
  /** The text of a context chip on the band (bd-5rz1v.19; mockup `.band .chip`). */
  chip: '#e9eaf2',
  /** A control ON the band — the date-range button — and its border (mockup `.rangebtn`). */
  control: 'rgba(255,255,255,0.12)',
  controlBorder: 'rgba(255,255,255,0.3)',
} as const;

/**
 * bd-5rz1v.18 — the PULL-UP MENU (deep-screens.html, "Menu bar · pull up"): a grab mark on top of
 * the teacher's indigo bar (`.nav.handle`), and the indigo panel that rises from it (`.pullup`)
 * with a 3-column grid of tiles (`.ptile`). Indigo is FRAME.background; the who row's school and
 * role are the menu's label grey (NAV.label).
 */
export const PULLUP = {
  /** The grab mark, on the bar and on the panel (38×4). */
  grab: 'rgba(255,255,255,0.4)',
  /** A tile's fill, and the line between the panel and the menu row. */
  tile: 'rgba(255,255,255,0.08)',
  /** A tile's icon. */
  icon: '#dfe1ea',
  /** Logout: light red on indigo (`.ptile.out`). */
  out: '#ffb4a8',
} as const;

/**
 * Pages INSIDE a flow get a light bar instead of the band: white with a 1px
 * bottom line, a soft indigo-tint circular back button, a small muted
 * breadcrumb ("Training · NIETE · Level 2") led by the feature's icon in its
 * hue (FEATURE_ICON.onLight), then the title.
 */
export const INNER_BAR = {
  background: '#ffffff',
  border: SURFACE.line,
  back: BRAND.inkXLight,
  backIcon: BRAND.ink,
  crumb: SURFACE.muted,
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
 * RED, the one exception to "red = errors" (bd-5rz1v.26): RECORDING. The live "Recording" chip
 * and its dot, the Record live lecture icon and the recording bar's tile. The same red as an
 * error, named for what it means here, so a screen says `recording` and never borrows `error`.
 */
export const RECORDING = { colour: BUTTON.destructive.background, background: STATUS.error.background } as const;

/**
 * NEUTRAL GREY — everything else: row icons, subject icons, provider badges,
 * trophies, scores. `quiet` is for a secondary, muted tile.
 */
export const NEUTRAL = { tile: BRAND.inkXLight, icon: BRAND.ink, quietTile: '#f1f2f5', quietIcon: SURFACE.muted } as const;

/**
 * The hue each feature owns ("Tests" / "Assessment Generator" is called
 * Assessment). Drawn ONLY as that feature's icon in a light bar's breadcrumb
 * (FEATURE_ICON.onLight); never on buttons, values, chips, rows or the menu.
 * My Classes, Results and Certificates are on record for when their screens move.
 */
export const FEATURE_HUE = {
  lessonPlans: { colour: BRAND.button, tint: BRAND.leafLight },
  training: { colour: '#1d6fd8', tint: '#e1edfd' },
  myClasses: { colour: '#d9530b', tint: '#ffeadb' },
  assessment: { colour: '#6e52e0', tint: '#ece8fd' },
  results: { colour: '#0b8a7c', tint: '#d3f6ee' },
  certificates: { colour: '#b54708', tint: '#fef0c7' },
} as const;

/**
 * FEATURE COLOUR — ONLY a feature's own icon, in one of two places:
 *   onIndigo  the 44px soft-white tile on a main page's flat indigo band, in
 *             the feature's LIGHT tint (the Dashboard shows the NIETE mark);
 *   onLight   the breadcrumb icon on a light inner-page bar, in its hue.
 * Nowhere else. The mockup sets these three; the others come with their screens.
 */
export const FEATURE_ICON = {
  tile: 'rgba(255,255,255,0.12)',
  onIndigo: { lessonPlans: '#7fd6a6', training: '#8bb8f7', assessment: '#b8a8f8' },
  /**
   * onLight is also the icon on Home's metric tiles (bd-5rz1v.19, mockup `FC`): Lesson plans
   * green, Training blue, Assessment purple, Attendance in My Classes' orange, Coaching and
   * Home itself (the breadcrumb of Home's inner pages) in the logo indigo.
   */
  onLight: {
    lessonPlans: FEATURE_HUE.lessonPlans.colour,
    training: FEATURE_HUE.training.colour,
    assessment: FEATURE_HUE.assessment.colour,
    myClasses: FEATURE_HUE.myClasses.colour,
    coaching: BRAND.ink,
    home: BRAND.ink,
  },
} as const;

/** Every tap target is at least this tall and wide (DESIGN.md rule 3). */
export const TAP_MIN_PX = 56;

/**
 * bd-5rz1v.19 — shadows, as `shadow-nu-*`. A filled button stands on a 4px edge of its own
 * darker colour and drops onto 1px of it when pressed (mockup `.cta`, `.cta:active`); the
 * menu bar casts a soft shadow upwards.
 */
export const SHADOW = {
  button: `0 4px 0 ${BUTTON.primary.edge}, 0 8px 16px rgba(46,125,87,0.22)`,
  buttonPressed: `0 1px 0 ${BUTTON.primary.edge}`,
  warning: `0 4px 0 ${BUTTON.warning.edge}`,
  warningPressed: `0 1px 0 ${BUTTON.warning.edge}`,
  destructive: `0 4px 0 ${BUTTON.destructive.edge}`,
  destructivePressed: `0 1px 0 ${BUTTON.destructive.edge}`,
  nav: '0 -6px 18px rgba(20,22,29,0.18)',
  /** bd-5rz1v.26 — something floating over the page: the recording bar in a desktop corner. */
  float: '0 6px 16px rgba(20,24,38,0.16)',
  /** bd-5rz1v.18 — the pull-up menu rising from the bar (mockup `.pullup`). */
  pullup: '0 -10px 30px rgba(0,0,0,0.25)',
} as const;

/** tailwind.config.ts adds these to `boxShadow`: shadow-nu-button, shadow-nu-nav, … */
export const tailwindShadows = {
  'nu-button': SHADOW.button,
  'nu-button-pressed': SHADOW.buttonPressed,
  'nu-warning': SHADOW.warning,
  'nu-warning-pressed': SHADOW.warningPressed,
  'nu-destructive': SHADOW.destructive,
  'nu-destructive-pressed': SHADOW.destructivePressed,
  'nu-nav': SHADOW.nav,
  'nu-float': SHADOW.float,
  'nu-pullup': SHADOW.pullup,
};

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
  // text-nu-record on bg-nu-record-bg; bg-nu-record for the live dot (RECORDING)
  record: { DEFAULT: RECORDING.colour, bg: RECORDING.background },
  // bg-nu-progress on bg-nu-progress-track (PROGRESS)
  progress: { DEFAULT: PROGRESS.bar, track: PROGRESS.track },
  // text-nu-done on bg-nu-done-bg (DONE)
  done: { DEFAULT: DONE.icon, bg: DONE.background },
  // bg-nu-neutral-tile + text-nu-neutral-icon (NEUTRAL)
  neutral: { tile: NEUTRAL.tile, icon: NEUTRAL.icon, quiet: NEUTRAL.quietTile, 'quiet-icon': NEUTRAL.quietIcon },
  // A feature's own icon ONLY (FEATURE_ICON): text-nu-f-training on bg-nu-f-tile
  // on the indigo band; text-nu-f-training-crumb in a light bar's breadcrumb.
  f: {
    tile: FEATURE_ICON.tile,
    'lesson-plans': { DEFAULT: FEATURE_ICON.onIndigo.lessonPlans, crumb: FEATURE_ICON.onLight.lessonPlans },
    training: { DEFAULT: FEATURE_ICON.onIndigo.training, crumb: FEATURE_ICON.onLight.training },
    assessment: { DEFAULT: FEATURE_ICON.onIndigo.assessment, crumb: FEATURE_ICON.onLight.assessment },
    // Light only (Home's tiles and its breadcrumb); they have no band tint yet.
    'my-classes': { crumb: FEATURE_ICON.onLight.myClasses },
    coaching: { crumb: FEATURE_ICON.onLight.coaching },
    home: { crumb: FEATURE_ICON.onLight.home },
  },
  // bg-nu-frame-translucent: context chips on the band, the active menu pill; text-nu-frame-chip;
  // bg-nu-frame-control + border-nu-frame-control-border: the date-range button on the band (FRAME)
  frame: { translucent: FRAME.translucent, chip: FRAME.chip, control: FRAME.control, 'control-border': FRAME.controlBorder },
  // bd-5rz1v.18 — the pull-up menu: bg-nu-pullup-grab, bg-nu-pullup-tile, text-nu-pullup-icon, text-nu-pullup-out (PULLUP)
  pullup: { grab: PULLUP.grab, tile: PULLUP.tile, icon: PULLUP.icon, out: PULLUP.out },
  // the light inner-page bar: bg-nu-inner, border-nu-inner-border, bg-nu-inner-back, text-nu-inner-crumb (INNER_BAR)
  inner: {
    DEFAULT: INNER_BAR.background, border: INNER_BAR.border, back: INNER_BAR.back, 'back-icon': INNER_BAR.backIcon, crumb: INNER_BAR.crumb,
  },
  focus: BRAND.focus,
  'nav-label': NAV.label,
  surface: {
    DEFAULT: SURFACE.page, card: SURFACE.card, text: SURFACE.text, muted: SURFACE.muted, line: SURFACE.line,
    chevron: SURFACE.chevron, handle: SURFACE.handle, box: SURFACE.box, scrim: SURFACE.scrim,
  },
};
