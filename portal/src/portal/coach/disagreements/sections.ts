import type { Card, Indicator, Item, Move } from "./api";

/**
 * bd-tbprit.9 — the sums behind Rifat's "Where to look", kept apart from the screen.
 *
 * Moves count as the grader credits them (fidelity-scorer.js): executed or substituted 1, partial ½, not done 0,
 * not adjudicable (not recorded) left out. Steps keep the plan's order.
 *
 * The part to play: nothing stores where a step starts or ends, so a step's part runs from just before its first
 * timed move to just after its last; a step with nothing timed (all missed) is the gap between the steps around
 * it. No plan: the DC's own evidence times (Rifat's rule). Always cut to the recording and to ten minutes.
 */

export type Mark = "yes" | "partial" | "no" | "unknown";
export type Step = { name: string; moves: Move[]; got: number; of: number };
export type Window = { from: number; to: number };

const LEAD = 15;
const TAIL = 45;
const MAX_PART = 600;
export const SHORT_SEC = 900;
const CREDIT: Record<Mark, number> = { yes: 1, partial: 0.5, no: 0, unknown: 0 };

export function markOf(verdict: string | null): Mark {
  if (verdict === "executed" || verdict === "substituted_equivalent" || verdict === "substituted_better") return "yes";
  if (verdict === "partial") return "partial";
  if (verdict === "not_done") return "no";
  return "unknown";
}

export function stepsOf(moves: Move[]): Step[] {
  const steps: Step[] = [];
  for (const m of moves) {
    const name = m.phase ?? "—";
    let step = steps.find((s) => s.name === name);
    if (!step) steps.push((step = { name, moves: [], got: 0, of: 0 }));
    step.moves.push(m);
    const mark = markOf(m.verdict);
    if (mark !== "unknown") {
      step.of += 1;
      step.got += CREDIT[mark];
    }
  }
  return steps;
}

/** The step with the most left undone; null when nothing was missed. */
export function mostMissed(steps: Step[]): Step | null {
  let worst: Step | null = null;
  for (const s of steps) if (s.of - s.got > 0 && (!worst || s.of - s.got > worst.of - worst.got)) worst = s;
  return worst;
}

export function moveTotals(moves: Move[]) {
  const n = { yes: 0, partial: 0, no: 0, unknown: 0 };
  for (const m of moves) n[markOf(m.verdict)] += 1;
  const total = n.yes + n.partial + n.no;
  const done = n.yes + n.partial / 2;
  return { total, done, pct: total ? Math.round((done / total) * 100) : null, ...n };
}

export const halves = (n: number) => {
  const whole = Math.floor(n);
  if (n === whole) return String(whole);
  return whole ? `${whole}½` : "½";
};

/** "n FICO indicators · a at 3 · …": how many at each score, and how many the report gives no score. */
export function indicatorCounts(items: Item[]) {
  const at: Record<number, number> = { 4: 0, 3: 0, 2: 0, 1: 0 };
  let none = 0;
  for (const i of items) if (i.score == null) none += 1; else at[i.score] = (at[i.score] ?? 0) + 1;
  return { n: items.length, at, none };
}

const pctOf = (ind: Indicator) => (ind.score == null || !ind.max ? null : ind.score / ind.max);

export function lowestKey(indicators: Indicator[]): string | null {
  let low: Indicator | null = null;
  for (const ind of indicators) {
    const p = pctOf(ind);
    if (!ind.counted || p == null) continue;
    if (!low || p < (pctOf(low) as number)) low = ind;
  }
  return low ? low.key : null;
}

/** The sections holding what her reasons point at: the grader items she disputes, and the plan if moves were missed. */
export function disputedKeys(card: Card): Set<string> {
  const keys = new Set<string>();
  for (const e of card.evidence) {
    if (e.code !== "score" && e.code !== "missed") continue;
    if (e.code === "missed" && e.moves.length) keys.add("lesson_plan_fidelity");
    for (const item of e.items) {
      const home = card.indicators.find((ind) => ind.items.some((i) => i.id === item.id));
      if (home) keys.add(home.key);
    }
  }
  return keys;
}

export const isShort = (sec: number | null) => sec != null && sec > 0 && sec < SHORT_SEC;

const times = (moves: { at: number | null }[]) => moves.map((m) => m.at).filter((a): a is number => a != null);
const around = (ats: number[]): Window | null =>
  ats.length ? { from: Math.max(0, Math.min(...ats) - LEAD), to: Math.max(...ats) + TAIL } : null;

export function stepWindow(steps: Step[], i: number): Window | null {
  const own = around(times(steps[i].moves));
  if (own) return own;
  const before = times(steps.slice(0, i).flatMap((s) => s.moves));
  const after = times(steps.slice(i + 1).flatMap((s) => s.moves));
  if (!before.length && !after.length) return null;
  const from = before.length ? Math.max(...before) : 0;
  return { from, to: after.length ? Math.min(...after) : from + MAX_PART };
}

export const itemsWindow = (items: Item[]) => around(times(items));

export function fitToRecording(w: Window, durationSec: number | null): Window | "notRecorded" {
  if (durationSec != null && durationSec > 0 && w.from >= durationSec) return "notRecorded";
  const end = durationSec != null && durationSec > 0 ? Math.min(w.to, durationSec) : w.to;
  return { from: w.from, to: Math.min(end, w.from + MAX_PART) };
}

export type Part = { step: string | null; listenFor: string | null; part: Window | "notRecorded" | null };
const fit = (w: Window | null, card: Card) => (w ? fitToRecording(w, card.durationSec ?? null) : null);

/** The one part to play: the plan's most-missed step, else the DC's evidence for her reasons. */
export function problemPart(card: Card): Part {
  const steps = card.moves?.length ? stepsOf(card.moves) : [];
  const worst = mostMissed(steps);
  if (worst) {
    // what to listen for: a key move she skipped, then a key move half done, then any skipped, then any half done
    const rank = (m: Move) => (markOf(m.verdict) === "no" ? 0 : 1) + (m.mustHappen ? 0 : 2);
    const missed = worst.moves.filter((m) => markOf(m.verdict) === "no" || markOf(m.verdict) === "partial");
    const pick = [...missed].sort((a, b) => rank(a) - rank(b))[0];
    return { step: worst.name, listenFor: pick?.text ?? null, part: fit(stepWindow(steps, steps.indexOf(worst)), card) };
  }
  const items = card.evidence.flatMap((e) => (e.code === "score" || e.code === "missed" ? e.items : []));
  const scored = items.filter((i) => i.score != null).sort((a, b) => (a.score as number) - (b.score as number));
  return { step: null, listenFor: scored[0]?.name ?? null, part: fit(itemsWindow(items), card) };
}
