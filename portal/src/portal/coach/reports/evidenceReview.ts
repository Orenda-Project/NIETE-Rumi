import type { EvidenceReview, V6Indicator } from "../../services/api";

/**
 * bd-o15qnr.31 (#188, 21 Nov ~10:05: LOCKED, evidence option B with editing) — the coach's check of the NIETE Teaching
 * Assistant's evidence for one indicator, as the v7 Feedback Form holds it:
 *
 *   summary      the assistant's one line (`rumiEvidence.because`), edited in place by the coach
 *   rows         each of the assistant's {time, quote}: kept, removed (Undo), or edited (the time stays); then the
 *                coach's own lines ("Add evidence": what you saw, an optional mm:ss time)
 *
 * What is saved is TODAY's text plus a record:
 *   ev_<code>        one text, as the server reads it today: the summary · each kept or edited quote as `MM:SS "quote"`
 *                    · each of the coach's lines as `MM:SS text` (evText). An indicator whose evidence the coach left as
 *                    it came keeps the server's own ev_ text untouched (FeedbackForm), so nothing changes for it.
 *   evidence_review  { summary: {rumi, coach}, items: [...] } beside it (reviewOut), for every indicator that has the
 *                    assistant's list, so kept / removed / edited / added can be counted.
 *
 * No `rumiEvidence` (an older bot): no review; the form shows today's one evidence box.
 */

export type RumiRow = { key: string; source: "rumi"; time: string | null; quote: string; status: "kept" | "removed" | "edited"; coachText?: string };
export type CoachRow = { key: string; source: "coach"; time: string | null; text: string };
export type ReviewRow = RumiRow | CoachRow;
export type Review = { rumi: string; summary: string; rows: ReviewRow[] };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The review an indicator starts from: the one last saved, else the assistant's list as it came; null without one. */
export function initialReview(ind: V6Indicator): Review | null {
  if (ind.kind !== "dc" || !ind.rumiEvidence || typeof ind.rumiEvidence !== "object") return null;
  const ev = ind.rumiEvidence;
  const because = str(ev.because);
  const saved = ind.evidenceReview;
  if (saved && typeof saved === "object" && Array.isArray(saved.items)) {
    const rows: ReviewRow[] = [];
    saved.items.forEach((it, i) => {
      if (!it || typeof it !== "object") return;
      if (it.source === "coach") {
        if (str(it.text).trim()) rows.push({ key: `c${i}`, source: "coach", time: str(it.time) || null, text: str(it.text) });
        return;
      }
      if (!str(it.quote)) return;
      const status = it.status === "removed" || it.status === "edited" ? it.status : "kept";
      const row: RumiRow = { key: `r${i}`, source: "rumi", time: str(it.time) || null, quote: str(it.quote), status };
      if (status === "edited") row.coachText = str(it.coach_text) || row.quote;
      rows.push(row);
    });
    return { rumi: str(saved.summary?.rumi) || because, summary: typeof saved.summary?.coach === "string" ? saved.summary.coach : because, rows };
  }
  const rows: ReviewRow[] = (Array.isArray(ev.items) ? ev.items : [])
    .filter((it) => it && str(it.quote).trim())
    .map((it, i) => ({ key: `r${i}`, source: "rumi" as const, time: str(it.time) || null, quote: str(it.quote), status: "kept" as const }));
  return { rumi: because, summary: because, rows };
}

/** What is sent as this indicator's `evidence_review`. */
export function reviewOut(r: Review): EvidenceReview {
  return {
    summary: { rumi: r.rumi, coach: r.summary },
    items: r.rows.map((row) => (row.source === "coach"
      ? { source: "coach" as const, time: row.time, text: row.text }
      : { source: "rumi" as const, time: row.time, quote: row.quote, status: row.status, ...(row.status === "edited" ? { coach_text: row.coachText ?? row.quote } : {}) })),
  };
}

/** The ev_<code> text a review makes: summary · MM:SS "quote" (kept or edited) · MM:SS the coach's line. */
export function evText(r: Review): string {
  const parts: string[] = [];
  if (r.summary.trim()) parts.push(r.summary.trim());
  for (const row of r.rows) {
    const at = row.time ? `${row.time} ` : "";
    if (row.source === "rumi") {
      if (row.status === "removed") continue;
      const q = (row.status === "edited" ? row.coachText ?? row.quote : row.quote).trim();
      if (q) parts.push(`${at}"${q}"`);
    } else if (row.text.trim()) {
      parts.push(`${at}${row.text.trim()}`);
    }
  }
  return parts.join(" · ");
}

/** The same check: nothing the coach did is left (an Undo, or a change typed back, counts as none). */
export function sameReview(a: Review | null | undefined, b: Review | null | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(reviewOut(a)) === JSON.stringify(reviewOut(b));
}

/** The visible rows: every one the coach has not removed. */
export const shownRows = (r: Review): ReviewRow[] => r.rows.filter((row) => row.source === "coach" || row.status !== "removed");

/* ── the coach's changes ──────────────────────────────────────────────────────────────────────────────────────── */

export function setSummary(r: Review, text: string): Review {
  return { ...r, summary: text };
}

/** Remove a row: the assistant's is marked removed (its words stay in the record); the coach's own goes. */
export function removeRow(r: Review, key: string): Review {
  return {
    ...r,
    rows: r.rows.flatMap((row) => {
      if (row.key !== key) return [row];
      if (row.source === "coach") return [];
      const { coachText: _drop, ...rest } = row;
      return [{ ...rest, status: "removed" as const }];
    }),
  };
}

/** Edit a row in place; the assistant's row is "edited" unless the words are typed back to its own. */
export function editRow(r: Review, key: string, text: string): Review {
  return {
    ...r,
    rows: r.rows.map((row) => {
      if (row.key !== key) return row;
      if (row.source === "coach") return { ...row, text };
      if (text.trim() === row.quote.trim()) { const { coachText: _drop, ...rest } = row; return { ...rest, status: "kept" as const }; }
      return { ...row, status: "edited" as const, coachText: text };
    }),
  };
}

export function addRow(r: Review, text: string, time: string | null): Review {
  const n = r.rows.reduce((m, row) => Math.max(m, Number(row.key.slice(1)) || 0), 0) + 1;
  return { ...r, rows: [...r.rows, { key: `c${n}`, source: "coach", time, text }] };
}

/* ── the lesson clock ─────────────────────────────────────────────────────────────────────────────────────────── */

const CLOCK = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/;

/** "04:30" → 270 seconds; "1:02:05" → 3725; null for anything else. */
export function clockSeconds(t: string | null | undefined): number | null {
  const m = CLOCK.exec(String(t ?? "").trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/** A typed time as the assistant writes them (MM:SS, H:MM:SS); null when it is not a time. Digits only, Latin. */
export function normClock(raw: string): string | null {
  const t = raw.trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٫.]/g, ":");
  const m = CLOCK.exec(t);
  if (!m) return null;
  return m[1] ? `${Number(m[1])}:${m[2].padStart(2, "0")}:${m[3]}` : `${m[2].padStart(2, "0")}:${m[3]}`;
}

/* ── kept on this phone (as formKeep.ts keeps the values) ─────────────────────────────────────────────────────── */

export type KeptV7 = { checked: string[]; reviews: Record<string, Review>; at: number };
const PREFIX = "niete-fico-form-v7:";
const KEEP_DAYS = 14;

export function keepV7(id: string, checked: Iterable<string>, reviews: Record<string, Review>): void {
  if (!id) return;
  try {
    window.localStorage.setItem(`${PREFIX}${id}`, JSON.stringify({ checked: [...checked], reviews, at: Date.now() }));
  } catch { /* storage full or blocked: the form still works */ }
}

export function heldV7(id: string): KeptV7 | null {
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${id}`);
    if (!raw) return null;
    const k = JSON.parse(raw) as Partial<KeptV7>;
    if (!k || typeof k !== "object") return null;
    if (typeof k.at === "number" && Date.now() - k.at > KEEP_DAYS * 86_400_000) { dropV7(id); return null; }
    const checked = Array.isArray(k.checked) ? k.checked.filter((c): c is string => typeof c === "string") : [];
    const reviews: Record<string, Review> = {};
    for (const [code, r] of Object.entries(k.reviews && typeof k.reviews === "object" ? k.reviews : {})) {
      if (r && typeof r === "object" && Array.isArray((r as Review).rows) && typeof (r as Review).summary === "string") reviews[code] = r as Review;
    }
    return { checked, reviews, at: typeof k.at === "number" ? k.at : 0 };
  } catch {
    return null;
  }
}

export function dropV7(id: string): void {
  if (!id) return;
  try { window.localStorage.removeItem(`${PREFIX}${id}`); } catch { /* nothing to drop */ }
}
