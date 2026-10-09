import { pkDayOf } from "../../teacher/lessons/days";
import type { CoachReport, ReportStep } from "../types";

/**
 * bd-4404s7.5 — the Reports lists' arithmetic, from the rows GET /api/portal/coach/reports gives and nothing else:
 * the Pakistan day a report falls on, the period it counts in, and the numbers on the All page. A number with no
 * rows behind it is null, never a zero.
 */

const PK_MS = 5 * 3_600_000;

/** The instant on Pakistan's clock as "HH:MM" (24-hour: TimeStamp makes the AM/PM), or null. */
export function pkTime(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + PK_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export type DayGroup = { day: string; items: CoachReport[] };

/** By Pakistan day, in the order given (newest first from the server). A report with no date has no day. */
export function dayGroups(items: readonly CoachReport[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of items) {
    const day = pkDayOf(r.createdAt);
    if (!day) continue;
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(r);
    else {
      const seen = out.find((g) => g.day === day);
      if (seen) seen.items.push(r); else out.push({ day, items: [r] });
    }
  }
  return out;
}

/** Inside [from, to] on Pakistan days, both ends included; a null end is open. */
export function inSpan(r: CoachReport, from: string | null, to: string | null): boolean {
  const day = pkDayOf(r.createdAt);
  if (!day) return false;
  return (from == null || day >= from) && (to == null || day <= to);
}

export type Span = { from: string | null; to: string; prevFrom: string | null; prevTo: string | null };
export type Kpi = { value: number | null; delta: number | null };

const mean = (rows: readonly CoachReport[]): number | null => {
  const s = rows.map((r) => r.score).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : null;
};

/**
 * Observations, Avg. HITL Score, Waiting for you and Sent. `waiting` is what waits on her now (the page's own
 * waiting list), so it is not a period number and has no change. The others change against the same stretch
 * one step back; All time has none.
 */
export function kpiNumbers(items: readonly CoachReport[], span: Span, waiting: number): Record<"observations" | "avg" | "sent" | "waiting", Kpi> {
  const now = items.filter((r) => inSpan(r, span.from, span.to));
  const hasPrev = span.prevFrom != null && span.prevTo != null;
  const prev = hasPrev ? items.filter((r) => inSpan(r, span.prevFrom, span.prevTo)) : [];
  const sent = (rows: readonly CoachReport[]) => rows.filter((r) => r.step === "sent").length;
  const avgNow = mean(now);
  const avgPrev = hasPrev ? mean(prev) : null;
  return {
    observations: { value: now.length, delta: hasPrev ? now.length - prev.length : null },
    avg: { value: avgNow, delta: avgNow != null && avgPrev != null ? Math.round((avgNow - avgPrev) * 10) / 10 : null },
    sent: { value: sent(now), delta: hasPrev ? sent(now) - sent(prev) : null },
    waiting: { value: waiting, delta: null },
  };
}

/**
 * The list is newest first, a page at a time. The numbers need the range and the period before it, so the page keeps
 * asking for the next page while the oldest row it has is still inside that period (or, for All time, until every
 * row is in).
 */
export function shouldLoadMore(items: readonly CoachReport[], total: number, span: Span): boolean {
  if (items.length >= total) return false;
  if (span.prevFrom == null) return true;
  const oldest = items.map((r) => pkDayOf(r.createdAt)).filter((d): d is string => !!d).sort()[0];
  return !oldest || oldest >= span.prevFrom;
}

const STEP_INDEX: Record<ReportStep, number> = { analysing: 0, draft: 1, talk: 2, report: 3, sent: 4 };

/** Where a report is on the four labelled segments (Analysed, Feedback Form, Debrief, Sent); 4 = all done. */
export function stepIndex(step: ReportStep | string | undefined): number {
  return STEP_INDEX[step as ReportStep] ?? 0;
}
