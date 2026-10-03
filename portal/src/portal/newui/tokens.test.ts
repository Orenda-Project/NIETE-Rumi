import { describe, it, expect } from "vitest";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../../tailwind.config";
import * as tokens from "./tokens";
import { BRAND, BUTTON, DONE, FEATURE_HUE, FEATURE_ICON, FRAME, INNER_BAR, NAV, NEUTRAL, PROGRESS, SELECTION, SHADOW, STATUS, SURFACE, TAP_MIN_PX, tailwindColors, tailwindShadows } from "./tokens";

/**
 * bd-5rz1v.12 — the new UI's colours live in ONE place (tokens.ts) and the
 * Tailwind theme is built from it, so a class like `bg-nu-ink` and the hex in
 * DESIGN.md can never disagree. Values from the chosen mockup, Direction B
 * option 2 (versions/v5_direction-b-brand/direction-b.html: `--f-*`, `F`).
 */

describe("new UI tokens", () => {
  it("has the NIETE logo colours and the button green", () => {
    expect(BRAND).toMatchObject({
      ink: "#333748",
      ink2: "#454a60",
      inkLight: "#e8e9f0",
      inkXLight: "#f3f3f7",
      leaf: "#48b078",
      leafLight: "#e2f3e9",
      button: "#2e7d57",
      buttonEdge: "#1e5c3f",
    });
  });

  // Final colour rule (operator, 2026-10-03, "still too much colour"); values from
  // versions/v6_deep-screens/deep-screens.html.
  it("indigo is the frame (heading band + menu bar) and the selection", () => {
    // Flat: the main-page heading band and the menu bar both have square corners.
    expect(FRAME).toMatchObject({ background: "#333748", text: "#ffffff", translucent: "rgba(255,255,255,0.14)" });
    expect(SELECTION).toEqual({ colour: "#333748", tint: "#e8e9f0", text: "#ffffff" });
  });

  it("green is every primary button, every progress bar and 'done'", () => {
    expect(BUTTON.primary).toEqual({ background: "#2e7d57", edge: "#1e5c3f", text: "#ffffff" });
    expect(PROGRESS).toEqual({ bar: "#48b078", track: "#e8e9f0" });
    expect(DONE).toEqual({ icon: "#2e7d57", background: "#e2f3e9" });
    expect(STATUS.done).toEqual({ text: "#1e5c3f", background: "#e2f3e9" });
  });

  it("amber is waiting/warning, red is errors and destructive actions", () => {
    expect(STATUS.warning).toEqual({ text: "#b54708", background: "#fef0c7" });
    expect(STATUS.error).toEqual({ text: "#c8331f", background: "#fde6e2" });
    expect(BUTTON.warning).toEqual({ background: "#b54708", edge: "#7a2e04", text: "#ffffff" });
    expect(BUTTON.destructive).toEqual({ background: "#c8331f", edge: "#8a1f12", text: "#ffffff" });
  });

  it("the other buttons are the same in every feature", () => {
    expect(BUTTON.secondary).toEqual({ background: "#ffffff", border: "#e3e5ec", text: "#141826" });
    expect(BUTTON.disabled).toEqual({ background: "#d7d9e0", text: "#8c90a0" });
    expect(BUTTON.primary.background).toBe(BRAND.button);
  });

  it("a feature colour is ONLY its own icon: light tint on the indigo band, its hue in a light bar's breadcrumb", () => {
    expect(FEATURE_ICON).toEqual({
      tile: "rgba(255,255,255,0.12)",
      onIndigo: { lessonPlans: "#7fd6a6", training: "#8bb8f7", assessment: "#b8a8f8" },
      // bd-5rz1v.19 — Home's tiles and crumb (deep-screens.html `FC`, `FEAT.home`): Home and
      // Coaching draw in indigo, attendance (My Classes) in its orange.
      onLight: {
        lessonPlans: "#2e7d57", training: "#1d6fd8", assessment: "#6e52e0",
        myClasses: "#d9530b", coaching: "#333748", home: "#333748",
      },
    });
    // The breadcrumb colour IS the feature's hue — one source, not a second copy.
    expect(FEATURE_ICON.onLight.training).toBe(FEATURE_HUE.training.colour);
    expect(FEATURE_ICON.onLight.myClasses).toBe(FEATURE_HUE.myClasses.colour);
  });

  it("the band's own controls and chips, and the sheet's scrim, are tokens too (bd-5rz1v.19)", () => {
    // deep-screens.html: `.band .chip` text #e9eaf2; `.rangebtn` rgba(255,255,255,.12) with a
    // rgba(255,255,255,.3) border; `.scrim` rgba(20,24,38,.5); `.tog .box` border #c7cad6.
    expect(FRAME).toMatchObject({ chip: "#e9eaf2", control: "rgba(255,255,255,0.12)", controlBorder: "rgba(255,255,255,0.3)" });
    expect(SURFACE).toMatchObject({ scrim: "rgba(20,24,38,0.5)", box: "#c7cad6" });
  });

  it("the button edges and the menu bar's shadow are tokens, built from the button colours (bd-5rz1v.19)", () => {
    // `.cta` box-shadow: 0 4px 0 <edge>, 0 8px 16px rgba(46,125,87,.22); pressed 0 1px 0 <edge>.
    expect(SHADOW).toEqual({
      button: "0 4px 0 #1e5c3f, 0 8px 16px rgba(46,125,87,0.22)",
      buttonPressed: "0 1px 0 #1e5c3f",
      warning: "0 4px 0 #7a2e04",
      warningPressed: "0 1px 0 #7a2e04",
      destructive: "0 4px 0 #8a1f12",
      destructivePressed: "0 1px 0 #8a1f12",
      nav: "0 -6px 18px rgba(20,22,29,0.18)",
      // bd-5rz1v.26 — the recording bar floating in a desktop corner.
      float: "0 6px 16px rgba(20,24,38,0.16)",
    });
    expect(SHADOW.button.startsWith(`0 4px 0 ${BUTTON.primary.edge}`)).toBe(true);
  });

  it("pages inside a flow get a light bar: white, 1px bottom line, soft indigo back button, muted breadcrumb", () => {
    expect(INNER_BAR).toEqual({ background: "#ffffff", border: "#e3e5ec", back: "#f3f3f7", backIcon: "#333748", crumb: "#666b80" });
  });

  it("everything else is neutral grey: row icons, subject icons, badges, scores, values; info chips too", () => {
    expect(NEUTRAL).toEqual({ tile: "#f3f3f7", icon: "#333748", quietTile: "#f1f2f5", quietIcon: "#666b80" });
    expect(STATUS.info).toEqual({ text: "#333748", background: "#e8e9f0" });
    expect(tokens).not.toHaveProperty("SUBJECT");
    expect(tokens).not.toHaveProperty("FEATURE");
  });

  it("keeps each feature's hue on record (Tests is now Assessment) — not drawn on screen", () => {
    expect(FEATURE_HUE).toEqual({
      lessonPlans: { colour: "#2e7d57", tint: "#e2f3e9" },
      training: { colour: "#1d6fd8", tint: "#e1edfd" },
      myClasses: { colour: "#d9530b", tint: "#ffeadb" },
      assessment: { colour: "#6e52e0", tint: "#ece8fd" },
      results: { colour: "#0b8a7c", tint: "#d3f6ee" },
      certificates: { colour: "#b54708", tint: "#fef0c7" },
    });
  });

  it("has the menu bar colours: indigo, muted labels, white + green for the active item", () => {
    expect(NAV).toEqual({ background: "#333748", label: "#b9bccb", active: "#ffffff", activeIcon: "#48b078" });
  });

  it("has the light screen surfaces", () => {
    expect(SURFACE).toMatchObject({ page: "#f4f5f8", card: "#ffffff", text: "#141826" });
  });

  it("says every tap target is at least 56px", () => {
    expect(TAP_MIN_PX).toBe(56);
  });
});

describe("the Tailwind theme is built from the tokens", () => {
  const colors = resolveConfig(tailwindConfig).theme.colors as unknown as Record<string, Record<string, unknown>>;

  it("exposes them under `nu`", () => {
    expect(colors.nu).toEqual(tailwindColors);
  });

  it.each([
    ["ink", "#333748"],
    ["leaf", "#48b078"],
    ["button", "#2e7d57"],
    ["nav-label", "#b9bccb"],
    ["select", "#333748"],
  ])("nu-%s is %s", (name, hex) => {
    const entry = colors.nu[name] as string | { DEFAULT: string };
    expect(typeof entry === "string" ? entry : entry.DEFAULT).toBe(hex);
  });

  it("feature classes are only the heading-icon tints and their tile", () => {
    expect(colors.nu.f).toEqual({
      tile: "rgba(255,255,255,0.12)",
      "lesson-plans": { DEFAULT: "#7fd6a6", crumb: "#2e7d57" },
      training: { DEFAULT: "#8bb8f7", crumb: "#1d6fd8" },
      assessment: { DEFAULT: "#b8a8f8", crumb: "#6e52e0" },
      "my-classes": { crumb: "#d9530b" },
      coaching: { crumb: "#333748" },
      home: { crumb: "#333748" },
    });
    expect(colors.nu.frame).toEqual({
      translucent: "rgba(255,255,255,0.14)", chip: "#e9eaf2", control: "rgba(255,255,255,0.12)", "control-border": "rgba(255,255,255,0.3)",
    });
    expect(colors.nu.inner).toEqual({ DEFAULT: "#ffffff", border: "#e3e5ec", back: "#f3f3f7", "back-icon": "#333748", crumb: "#666b80" });
    expect(colors.nu).not.toHaveProperty("subject");
  });

  it("has the button, chip, progress, done and neutral families", () => {
    expect(colors.nu.button).toMatchObject({ DEFAULT: "#2e7d57", edge: "#1e5c3f", warning: "#b54708", destructive: "#c8331f" });
    expect(colors.nu.chip).toEqual({
      done: { DEFAULT: "#1e5c3f", bg: "#e2f3e9" },
      warning: { DEFAULT: "#b54708", bg: "#fef0c7" },
      error: { DEFAULT: "#c8331f", bg: "#fde6e2" },
      info: { DEFAULT: "#333748", bg: "#e8e9f0" },
      selected: { DEFAULT: "#ffffff", bg: "#333748" },
    });
    expect(colors.nu.progress).toEqual({ DEFAULT: "#48b078", track: "#e8e9f0" });
    expect(colors.nu.done).toEqual({ DEFAULT: "#2e7d57", bg: "#e2f3e9" });
    expect(colors.nu.neutral).toEqual({ tile: "#f3f3f7", icon: "#333748", quiet: "#f1f2f5", "quiet-icon": "#666b80" });
  });

  it("exposes the shadows as shadow-nu-* (bd-5rz1v.19)", () => {
    const shadows = resolveConfig(tailwindConfig).theme.boxShadow as unknown as Record<string, string>;
    expect(tailwindShadows).toEqual({
      "nu-button": SHADOW.button,
      "nu-button-pressed": SHADOW.buttonPressed,
      "nu-warning": SHADOW.warning,
      "nu-warning-pressed": SHADOW.warningPressed,
      "nu-destructive": SHADOW.destructive,
      "nu-destructive-pressed": SHADOW.destructivePressed,
      "nu-nav": SHADOW.nav,
      "nu-float": SHADOW.float,
    });
    for (const [name, value] of Object.entries(tailwindShadows)) expect(shadows[name]).toBe(value);
    // Tailwind's own shadows are still there for every old page.
    expect(shadows.md).toBeTruthy();
  });

  it("keeps the colours every existing page uses", () => {
    expect(colors.primary).toEqual({ DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" });
    expect(colors.accent).toEqual({ DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" });
  });
});
