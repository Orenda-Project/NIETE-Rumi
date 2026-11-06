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
  missed: { key: string; name: Both; line: string | null; why: Both; module: number | null }[];
  focus: { key: string; move: string | null; why: string | null; module: number | null; tryLine: { en: string; ur: string } | null } | null;
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
  respectAll: boolean;
  focus: {
    key: string; module: number | null; name: Both; why: Both;
    week: Count; last: Count | null; days: { date: string; items: boolean[] }[];
    last10: Count; doneAt: number; reached: boolean;
    next: string | null; nextName: Both | null; nextModule: number | null;
    steps: { en: string[]; ur: string[]; reviewed: boolean } | null;
  } | null;
  strengths: (Count & { key: string; name: Both })[];
  keepInMind: (Count & { key: string; name: Both; why: Both; module: number | null })[];
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
