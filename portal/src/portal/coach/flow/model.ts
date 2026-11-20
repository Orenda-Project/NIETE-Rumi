import { karachiDay } from "../time";
import type { CoachReport, CoachVisit } from "../types";

/**
 * bd-o15qnr.27 (queue #204, v6) — the coach flow's lists from the two reads it makes (GET /coach/schedule and the first
 * GET /coach/reports page), shared by Observe and the Home's Focus card so the two can never disagree.
 */

const slotKey = (v: CoachVisit) => (/^\d{2}:\d{2}$/.test(v.scheduledSlot || "") ? (v.scheduledSlot as string) : "~");
const byTime = (a: CoachVisit, b: CoachVisit) => {
  const da = a.scheduledFor || "";
  const db = b.scheduledFor || "";
  if (da !== db) return da < db ? -1 : 1;
  const sa = slotKey(a);
  const sb = slotKey(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
};

export type Booked = { today: CoachVisit[]; late: CoachVisit[]; coming: CoachVisit[] };

/**
 * Visits still to do (status upcoming), each once: today's by time, the late ones (before today, oldest first) and the
 * ones coming up (after today, soonest first). Done and cancelled visits are History's, not here; `gone` = cancelled
 * on this screen a moment ago.
 */
export function groupBooked(
  data: { visits?: CoachVisit[]; overdue?: CoachVisit[] } | null | undefined, today: string, gone: ReadonlySet<string> = new Set(),
): Booked {
  const seen = new Set<string>();
  const open: CoachVisit[] = [];
  for (const v of [...(data?.overdue || []), ...(data?.visits || [])]) {
    if (seen.has(v.id) || gone.has(v.id) || v.status !== "upcoming") continue;
    seen.add(v.id);
    open.push(v);
  }
  open.sort(byTime);
  return {
    today: open.filter((v) => v.scheduledFor === today),
    late: open.filter((v) => (v.scheduledFor || "") < today),
    coming: open.filter((v) => (v.scheduledFor || "") > today),
  };
}

/** Observations waiting on her, the one waiting longest first. */
export function oldestFirst(waiting: CoachReport[] | null | undefined): CoachReport[] {
  return [...(waiting || [])].sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? -1 : (a.createdAt || "") > (b.createdAt || "") ? 1 : 0));
}

/** Whole Pakistan days an observation has waited (0 = since today). */
export function waitedDays(r: Pick<CoachReport, "createdAt">, today: string = karachiDay()): number {
  if (!r.createdAt) return 0;
  const from = karachiDay(new Date(r.createdAt));
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));
}
