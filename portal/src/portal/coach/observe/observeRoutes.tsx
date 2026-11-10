import { createContext, useContext } from "react";
import { coach } from "../../services/api";
import type { CoachVisit } from "../types";
import { observationPath, REPORTS_PATH, type ObservationScreen } from "../reports/paths";

/**
 * bd-33wxxi.4 — where the Observe screens (record, upload, Check and send, Sending) and one observation's screens
 * (the observation page, Feedback Form, Debrief, Your feedback, Send) take their visit and their links from.
 *
 * The coach app is the default, and its values are exactly the paths these screens always used, so a coach's screens
 * are unchanged. The principal app (teacher/principal) gives its own: no coach gate (the teacher app's TeacherGate
 * already ran), the teacher she picked instead of a scheduled visit (no observation_schedules row, so no visit notice
 * goes to the teacher), and its own paths under the teacher app.
 */
export interface ObserveRoutes {
  /** The coach app's screens sit behind CoachGate; the principal app's do not (TeacherGate). */
  coachGate: boolean;
  /**
   * bd-33wxxi.6 — whether one observation's screens show its AI score and coach score (the score ring, "Coach score
   * N%", the Send preview's score header). The coach app: yes. The principal app: no (#55, the operator, 10 Nov on Q1:
   * "Lets start with hiding the scores … on the report for Principals"); everything else on those screens stays.
   */
  showScores: boolean;
  /** The visit a screen is for: the coach's scheduled visit, or the principal's picked teacher shaped as one. */
  loadVisit: (id: string) => Promise<{ visit?: CoachVisit | null }>;
  /** Where Back goes from the recording screens (the coach's visit page; the principal's Pick the teacher). */
  visit: (id: string) => string;
  record: (id: string) => string;
  attach: (id: string) => string;
  check: (id: string) => string;
  sending: (id: string) => string;
  observation: (id: string, screen?: ObservationScreen) => string;
  /** The list of her observations (the coach's Reports; the principal's Observations). */
  reports: string;
}

export const COACH_OBSERVE_ROUTES: ObserveRoutes = {
  coachGate: true,
  showScores: true,
  loadVisit: (id) => coach.getVisit(id),
  visit: (id) => `/portal/coach/visit/${id}`,
  record: (id) => `/portal/coach/visit/${id}/record`,
  attach: (id) => `/portal/coach/visit/${id}/attach`,
  check: (id) => `/portal/coach/visit/${id}/check`,
  sending: (id) => `/portal/coach/visit/${id}/sending`,
  observation: observationPath,
  reports: REPORTS_PATH,
};

const ObserveRoutesContext = createContext<ObserveRoutes>(COACH_OBSERVE_ROUTES);

export const ObserveRoutesProvider = ObserveRoutesContext.Provider;

/** The Observe screens' visit source and links (the coach app's unless a provider says otherwise). */
export function useObserveRoutes(): ObserveRoutes {
  return useContext(ObserveRoutesContext);
}
