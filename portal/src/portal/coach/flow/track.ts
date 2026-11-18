import { browserEnv, getApiBaseUrl } from "@/lib/runtime";

/**
 * bd-o15qnr.26 — what a coach does on the visit flow v2, for the funnel: POST /funnel/coach-flow
 * (dashboard/routes/app-funnel.routes.js) logs app_funnel.coach_flow { action, level } to Axiom. The coach and her journey
 * come from the SESSION on the server; the page sends only an action from the list below (and a level for the chips).
 *
 *   schedule.cancel_tap      she tapped Cancel visit on a Schedule row (the tray opened)
 *   schedule.cancel_confirm  she confirmed it in the tray
 *   schedule.start           Start recording on a Schedule row
 *   new_visit.level          a teaching-level chip on New visit (level: all / primary / middle / high)
 *   home.today_start         Start recording on the Home's Today card
 *
 * Fire-and-forget: it never throws, never waits, never decides anything.
 */
export type FlowAction = "schedule.cancel_tap" | "schedule.cancel_confirm" | "schedule.start" | "new_visit.level" | "home.today_start";
export type FlowLevel = "all" | "primary" | "middle" | "high";

export function trackFlow(a: FlowAction, level?: FlowLevel): void {
  try {
    const body = JSON.stringify({ a, ...(level ? { level } : {}), b: browserEnv() });
    void fetch(`${getApiBaseUrl()}/funnel/coach-flow`, {
      method: "POST", body, headers: { "Content-Type": "text/plain;charset=UTF-8" }, credentials: "include", keepalive: true,
    }).catch(() => {});
  } catch {
    /* the report never decides anything */
  }
}
