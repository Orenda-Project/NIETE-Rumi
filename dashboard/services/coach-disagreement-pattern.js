'use strict';
/**
 * bd-tbprit.10 — Rifat's "3. Is this a pattern?" as numbers: her last lessons up to this one (oldest first), her
 * average and best, how often she records against the ICT average, the step she missed in this lesson counted over
 * her last 5 plan-checked lessons, and how often she disagreed before. Pure: the caller fetches, this only counts.
 * Nothing is filled in — a lesson without a score is left off the line, and no plan checked is null, never a guess.
 */

const ICT_PER_WEEK = 1.52; // ICT-wide recordings a teacher a week (Rifat's prototype)
const MISSED = new Set(['not_done', 'partial']);
const DAY = 86400000;

const missedSteps = (moves) => new Set(moves.filter((m) => MISSED.has(m.verdict)).map((m) => m.phase));

function trendOf(lessons) {
  const scored = lessons.filter((l) => l.pct != null);
  if (!scored.length) return { points: [], avg: null, best: null, now: null };
  const best = scored.reduce((b, l) => (l.pct > b.pct ? l : b));
  return {
    points: scored.map((l) => ({ pct: Math.round(l.pct), date: l.createdAt })),
    avg: Math.round(scored.reduce((s, l) => s + l.pct, 0) / scored.length),
    best: { pct: Math.round(best.pct), date: best.createdAt },
    now: Math.round(scored[scored.length - 1].pct),
  };
}

function rateOf(lessons, recordingLess) {
  if (lessons.length < 2) return { perWeek: null, level: null };
  const days = (Date.parse(lessons[lessons.length - 1].createdAt) - Date.parse(lessons[0].createdAt)) / DAY;
  const perWeek = Math.round((lessons.length / Math.max(1, days / 7)) * 10) / 10;
  const level = recordingLess ? 'atRisk' : perWeek >= 2 ? 'active' : 'steady';
  return { perWeek, level };
}

function missedOf(lessons) {
  const last = lessons[lessons.length - 1];
  if (!last || !last.moves) return null;
  const checked = lessons.filter((l) => l.moves).slice(-5);
  const counts = new Map();
  for (const m of last.moves) if (MISSED.has(m.verdict)) counts.set(m.phase, (counts.get(m.phase) || 0) + 1);
  let step = null;
  for (const [phase, n] of counts) if (step == null || n > counts.get(step)) step = phase; // Map keeps plan order
  if (step == null) return { step: null, n: 0, of: checked.length };
  return { step, n: checked.filter((l) => missedSteps(l.moves).has(step)).length, of: checked.length };
}

function patternOf({ lessons, earlier, recordingLess }) {
  return {
    ...trendOf(lessons),
    count: lessons.length,
    ...rateOf(lessons, recordingLess),
    ictAvg: ICT_PER_WEEK,
    firstDate: lessons.length ? lessons[0].createdAt : null,
    lastDate: lessons.length ? lessons[lessons.length - 1].createdAt : null,
    missed: missedOf(lessons),
    earlier,
  };
}

module.exports = { patternOf, ICT_PER_WEEK };
