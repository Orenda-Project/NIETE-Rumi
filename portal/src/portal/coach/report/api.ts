/**
 * Coach reports in the app — what the page and the Home card read and write (dashboard/routes/portal.routes.js,
 * services/coach-report.service.js). Every route is the coach's own: the server reads the session user, never an id
 * sent from here, and another coach's report is a 403.
 */
import api from "../../services/api";

export type Both = { en: string | null; ur: string | null };

export interface CoachReport {
  id: string;
  header: { teacher: string | null; grade: string | null; subject: string | null; topic: string | null; at: string | null };
  harmful: boolean;
  concern: { what_happened: string | null; why_it_matters: string | null; instead: string | null } | null;
  marks: { key: string; done: boolean; name: Both }[];
  done: number;
  total: number;
  respectHeld: boolean | null;
  did: { key: string; name: Both; line: string | null }[];
  missed: { key: string; name: Both; line: string | null; why: Both }[];
  focus: { key: string; move: string | null; why: string | null; tryLine: { en: string; ur: string } | null } | null;
}

export interface ReadyDebrief {
  kind: "debrief";
  id: string;
  at: string | null;
  teacher: string | null;
  subject: string | null;
  grade: string | null;
}

/** Phase 3: her week, ready from Friday 16:00 (id = its Monday). */
export interface ReadyWeek {
  kind: "week";
  id: string;
  monday: string;
  friday: string;
  at: string;
  debriefs: number;
}

export type ReadyReport = ReadyDebrief | ReadyWeek;

type Count = { done: number; of: number };
export interface CoachWeek {
  monday: string;
  friday: string;
  target: number;
  complete: number;
  debriefs: number;
  small: boolean;
  /** No debrief before this week at all (bd-enec2e.5): only then is a week with no last week "her first week". */
  firstWeek?: boolean;
  respectAll: boolean;
  /** Queue #186: the week's ONE Coach Training module (the focus's, else the top miss to keep in mind's), or none. */
  training: number | null;
  focus: {
    key: string; name: Both; why: Both;
    week: Count; last: Count | null; days: { date: string; items: boolean[] }[];
    last10: Count; doneAt: number; reached: boolean;
    next: string | null; nextName: Both | null;
    steps: { en: string[]; ur: string[]; reviewed: boolean } | null;
  } | null;
  strengths: (Count & { key: string; name: Both })[];
  keepInMind: (Count & { key: string; name: Both; why: Both })[];
  table: { key: string; name: Both; week: Count; last: Count | null }[];
}

/** Why a report could not be shown, from the route's status. */
export type ReportProblem = "not_ready" | "not_yours" | "failed";

export async function getCoachReport(id: string): Promise<CoachReport> {
  const res = await api.get(`/coach/report/${encodeURIComponent(id)}`);
  return res.data.report as CoachReport;
}

export function problemOf(err: unknown): ReportProblem {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 409) return "not_ready";
  if (status === 403 || status === 404) return "not_yours";
  return "failed";
}

/** She opened it (the page calls this once it has drawn the report). Never throws. */
export async function markOpened(id: string): Promise<void> {
  try { await api.post(`/coach/report/${encodeURIComponent(id)}/opened`); } catch { /* a missed stamp only means one WhatsApp link may follow */ }
}

/** She closed the Home card with ✕: seen, so no WhatsApp follows. Never throws. */
export async function markSeen(id: string): Promise<void> {
  try { await api.post(`/coach/report/${encodeURIComponent(id)}/seen`); } catch { /* the card is gone either way */ }
}

export async function getReadyReports(): Promise<ReadyReport[]> {
  const res = await api.get("/coach/reports/ready");
  return (res.data.reports || []) as ReadyReport[];
}

export const coachReportPath = (id: string) => `/portal/coach/report/${encodeURIComponent(id)}`;
export const coachWeekPath = (monday: string) => `/portal/coach/week/${encodeURIComponent(monday)}`;

export async function getCoachWeek(monday: string): Promise<CoachWeek> {
  const res = await api.get(`/coach/week/${encodeURIComponent(monday)}`);
  return res.data.week as CoachWeek;
}

/** She opened her week (once it has drawn), or closed its card: the week's one row. Never throws. */
export async function markWeek(monday: string, what: "opened" | "seen"): Promise<void> {
  try { await api.post(`/coach/week/${encodeURIComponent(monday)}/${what}`); } catch { /* a missed stamp only means one WhatsApp link may follow */ }
}

/**
 * bd-o15qnr.28.1 (queue #204, v7) — My progress (GET /api/portal/coach/progress, services/coach-progress.service.js):
 * the session coach's own, read-only, counts only. `weeks` is null when her week page does not open for her.
 */
export interface CoachProgress {
  week: { monday: string; friday: string; complete: number; target: number };
  focus: { key: string; name: Both; last10: Count; doneAt: number; window: number } | null;
  /** Her 8 behaviours over the last `window` debriefs, most seen first. */
  behaviours: (Count & { key: string; name: Both })[];
  window: number;
  /** Respect held in every one of those debriefs (the must-pass check, not one of the 8). */
  respectAll: boolean;
  /** The 3 most recent; `step` is coach-v2's (analysing · draft · talk · report · sent); `debrief` once there is one. */
  observations: { id: string; at: string | null; teacher: string | null; step: string; debrief: { done: number; total: number } | null }[];
  weeks: { monday: string; friday: string; complete: number; target: number }[] | null;
}

export async function getCoachProgress(): Promise<CoachProgress> {
  const res = await api.get("/coach/progress");
  return res.data.progress as CoachProgress;
}

export const COACH_PROGRESS_PATH = "/portal/coach/progress";
