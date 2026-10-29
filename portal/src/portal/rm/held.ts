import type { CSSProperties } from "react";

/**
 * bd-sex15q.47 (R6 fix cycle 2, FIX_R6 §7.3 B8) — the RM home's band height at 390, held from the first paint to the
 * payload so the body does not drop when `/rm/home` lands (S8 CLS 0.246 EN / 0.317 UR before this). px, the band foot
 * included. Measured live on QA RM 1 (sandbox `906ece3f74`): design-qa `measure/rm1_phone_{en,ur}_rm_r6b.json`
 * pages.S8.look.r6b.band.h, the same in panel-r5 `measure/rm1_phone_{en,ur}_rm_panel4.json`. The coach's S1 values in
 * `tokens.css` (385 / 449) are a different band and must not be reused. A live band taller than this still shifts: the
 * rig's held = live assert is the alarm, this table the fix.
 */
export const RM_HELD = { en: { band: 440 }, ur: { band: 509 } } as const;

/**
 * S9's title box at 390 while the coach's read is in flight (FIX_R6 §7.3 B9): a coach label of 12–16 characters wraps to
 * two lines beside the back circle and the EN | اردو pill, so a one-line placeholder still let the bar grow (S9 cold
 * 0.034 EN / 0.069 UR). The h1's live height on QA RM 1 (ux-rm `measure/r6c` bar probe, sandbox data, branch build):
 * 58 px EN, 96 px UR (the Latin label's line boxes inside the Urdu h1). One line on a laptop.
 */
export const RM_S9_TITLE_HELD = { en: 58, ur: 96 } as const;

/** The inline variable that `.cp-band[data-cp-fixed]` and S8's held wrapper size from (inline beats the `.cp` rule). */
export function heldStyle(lang: "en" | "ur"): CSSProperties {
  return { "--cp-band-min-h": `${RM_HELD[lang].band}px` } as CSSProperties;
}
