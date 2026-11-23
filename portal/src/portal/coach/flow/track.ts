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
 *   home.today_start         Start recording on the Home's next-visit card
 *   observe.start            Start an observation (Concept 1's big button on Observe)
 *   observe.schedule         bd-o15qnr.27 (v6): Schedule an observation on Observe
 *   observe.booked_open      All booked opened on Observe
 *   schedule.now_record      Schedule for Now → Start recording
 *   schedule.now_upload      Schedule for Now → Upload recording
 *   schedule.later           Schedule for Later → booked
 *   home.focus               the Home Focus card's button
 *   form.save_slow           bd-o15qnr.38: the v7 Feedback Form's save has had no answer for SAVE_SLOW_MS
 *   form.save_retry          a save try was lost (no answer in SAVE_TRY_MS, or none at all): sent once more
 *   form.save_lost           both tries lost: the form said "Not saved" and the answers stayed on the phone
 *
 * Fire-and-forget: it never throws, never waits, never decides anything.
 */
export type FlowAction = "schedule.cancel_tap" | "schedule.cancel_confirm" | "schedule.start" | "new_visit.level" | "home.today_start" | "observe.start"
  | "observe.schedule" | "observe.booked_open" | "schedule.now_record" | "schedule.now_upload" | "schedule.later" | "home.focus"
  | "form.save_slow" | "form.save_retry" | "form.save_lost";
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
