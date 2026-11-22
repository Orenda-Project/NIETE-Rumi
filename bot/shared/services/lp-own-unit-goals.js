'use strict';
/**
 * bd-snkn32.59.4 (queue #165, phase 2) — "A whole unit" from her LEARNING GOALS, with no textbook behind it. Amena,
 * 20 Nov: "learning goals wont be related to the textbook, it could be any few goals that need a plan, pls dont link
 * the textbook for learning goals". Her 2-8 goals (picked from the skill list or typed, any order) are the whole
 * source: no chapter, page or book day is read or stored. Pure (no I/O).
 *
 *   parseUnitGoals(raw)                       → { ok, goals: [{ kind: outcome|topic, text, code? }] } | { ok: false, error }
 *   buildGoalOutline({ goals, pace, period }) → { ok, days } | { ok: false, error }
 *   goalPaceCounts({ goals, period })         → { recommended, slower, faster|null }
 *   goalsOfDay(day, texts)                    → the goal texts a day works on
 *
 * A day has the book outline's shape, so her ⋯ menu and the server's outline check (lp-own-unit-edit) are the same:
 * `lesson_ids` are GOAL KEYS here (goal_1 … goal_8, review_N, check), never book days; `chapter` is always 1, so the
 * check day closes the unit; a review or check day says which goals it `covers` ([first, last], 1-based).
 *  - recommended: one day per goal; a review day after every 3 goals (when more follow); then a review of all
 *    and a check day built from the same goals.
 *  - slower: one practice day after each goal.  - faster: no review in the middle (none to drop = 'no_faster').
 */
const { parseGoal } = require('./lp612-own-goal');
const { hasBlockedWord } = require('./lp-own-goal-guard');

const MIN_GOALS = 2;
const MAX_GOALS = 8;
const REVIEW_EVERY = 3;
const PACES = ['recommended', 'slower', 'faster'];
const PERIODS = { min: 20, max: 90 };
/** An official SLO code (M-03-AD-02); anything else (a lesson id, a page) is never kept. */
const CODE = /^[A-Z]{1,3}-\d{2}-[A-Z]{2,3}-\d{2,3}[A-Za-z0-9-]{0,8}$/;

const fail = (error) => ({ ok: false, error });

function parseUnitGoals(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_GOALS * 2) return fail('goals_count');
  const out = [];
  const seen = new Set();
  for (const g of raw) {
    const p = parseGoal(g);
    if (!p.ok) return fail(p.error);
    if (hasBlockedWord(p.goal.text)) return fail('goal.text is not a school topic');
    const key = p.goal.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const code = p.goal.kind === 'outcome' && typeof g.code === 'string' && CODE.test(g.code) ? g.code : null;
    out.push({ kind: p.goal.kind, text: p.goal.text, ...(code ? { code } : {}) });
  }
  if (out.length < MIN_GOALS || out.length > MAX_GOALS) return fail('goals_count');
  return { ok: true, goals: out };
}

const lessonDay = (kind, i, goals) => ({ kind, chapter: 1, lesson_ids: [`goal_${i + 1}`], topic: goals[i].text });

function buildGoalOutline({ goals, pace, period } = {}) {
  if (!Array.isArray(goals) || goals.length < MIN_GOALS || goals.length > MAX_GOALS) return fail('goals_count');
  if (!PACES.includes(pace)) return fail('bad_pace');
  const p = Number(period);
  if (!Number.isFinite(p) || p < PERIODS.min || p > PERIODS.max) return fail('bad_period');
  const n = goals.length;
  const days = [];
  let reviews = 0;
  let midReviews = 0;
  goals.forEach((_, i) => {
    days.push(lessonDay('lesson', i, goals));
    if (pace === 'slower') days.push(lessonDay('practice', i, goals));
    if ((i + 1) % REVIEW_EVERY === 0 && i + 1 < n) {
      midReviews += 1;
      if (pace !== 'faster') {
        reviews += 1;
        days.push({ kind: 'review', chapter: 1, lesson_ids: [`review_${reviews}`], topic: '', covers: [i + 2 - REVIEW_EVERY, i + 1] });
      }
    }
  });
  if (pace === 'faster' && !midReviews) return fail('no_faster');
  days.push({ kind: 'review', chapter: 1, lesson_ids: [`review_${reviews + 1}`], topic: '', covers: [1, n] });
  days.push({ kind: 'test', chapter: 1, lesson_ids: ['check'], topic: '', covers: [1, n] });
  return { ok: true, days };
}

function goalPaceCounts({ goals, period } = {}) {
  const count = (pace) => { const o = buildGoalOutline({ goals, pace, period }); return o.ok ? o.days.length : null; };
  return { recommended: count('recommended'), slower: count('slower'), faster: count('faster') };
}

function goalsOfDay(day, texts) {
  if (!day || !Array.isArray(texts)) return [];
  if (Array.isArray(day.covers)) return texts.slice(day.covers[0] - 1, day.covers[1]);
  return (day.lesson_ids || []).map((k) => /^goal_(\d+)$/.exec(k)).filter(Boolean).map((m) => texts[Number(m[1]) - 1]).filter(Boolean);
}

module.exports = { parseUnitGoals, buildGoalOutline, goalPaceCounts, goalsOfDay, MIN_GOALS, MAX_GOALS };
