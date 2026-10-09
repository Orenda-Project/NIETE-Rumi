/**
 * bd-4404s7.5 — where the Reports screens live. The observation page is /portal/coach/observation/:id; the four
 * screens of one observation hang off it, so Back from any of them is the observation page.
 */
export type ObservationScreen = "form" | "debrief" | "feedback" | "send";

export const REPORTS_PATH = "/portal/coach/reports";
export const REPORTS_ALL_PATH = "/portal/coach/reports/all";

export function observationPath(id: string, screen?: ObservationScreen): string {
  const base = `/portal/coach/observation/${encodeURIComponent(id)}`;
  return screen ? `${base}/${screen}` : base;
}
