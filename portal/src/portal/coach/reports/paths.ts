/**
 * bd-4404s7.5 — where the Reports screens live. The observation page is /portal/coach/observation/:id; the four
 * screens of one observation hang off it, so Back from any of them is the observation page.
 */
export type ObservationScreen = "form" | "debrief" | "feedback" | "send";

/**
 * bd-ewbzns.4.1 (queue #54) — one count everywhere: FOUR steps, the same four as the Reports list card (Analysed,
 * Feedback Form, Debrief, Sent). Reading her own feedback is not a job, so it sits inside Debrief. Every screen's crumb
 * and the observation page's "Step n of 4" read from here.
 */
export const OBSERVATION_STEPS = 4;
export const SCREEN_STEP: Record<ObservationScreen, number> = { form: 2, debrief: 3, feedback: 3, send: 4 };

export const REPORTS_PATH = "/portal/coach/reports";
export const REPORTS_ALL_PATH = "/portal/coach/reports/all";

export function observationPath(id: string, screen?: ObservationScreen): string {
  const base = `/portal/coach/observation/${encodeURIComponent(id)}`;
  return screen ? `${base}/${screen}` : base;
}
