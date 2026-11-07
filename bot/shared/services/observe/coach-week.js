'use strict';
/**
 * Coach reports in the app, phase 3 — the coach's WEEK, computed from her debriefs. Pure: no I/O, no logger, so the
 * portal (dashboard/services/coach-week.service.js) and the bot's Friday sweep read the same answer.
 *
 * Her design (the ICT HITL owner's 16 Oct document): complete observations against a target of 12, never red; ONE
 * focus first, as counts, day by day, against her own last week; steady strengths; at most two misses to keep in mind;
 * next week (where she is, four steps, the module, what comes next); the table of all 8 folded. Patterns only, never a
 * quote; private to the coach. Where her document is silent, the plan's rules (approved 5 Nov):
 *
 *   WEEK      Monday 00:00 to Friday 16:00 PKT; ready at Friday 16:00. A debrief is placed by when its feedback was
 *             ready; one after Friday 16:00 or at the weekend counts in the next week.
 *   FOCUS     the first behaviour, in the rubric's (= the modules') order, not yet done in 6 of her last 10 debriefs
 *             BEFORE the week (with fewer than 10, in the same share of those she has: ceil(6/10 of them)); with no
 *             earlier debrief, of this week's. It is DONE at 6 of her last 10 up to Friday 16:00; "what comes next" is
 *             the next behaviour in the same order not yet at that share.
 *   STEADY    done in more than 2/3 of the week's debriefs (never the focus).
 *   KEEP      at most two, done in fewer than half: lowest counts first, ties in module order (never the focus).
 *   SMALL     fewer than 4 debriefs: counts only (no strengths, no misses).
 * Counts come only from the judge's booleans (observe-coach-rubric), never from model text.
 */

const { pktDate, atPkt } = require('../nudges/pkt-time');
const { BEHAVIOUR_KEYS } = require('./observe-coach-rubric');
const { BEHAVIOUR_MODULE } = require('../../config/coach-training-modules');

const TARGET = 12;
const READY_HOUR = 16;
const FOCUS_DONE_AT = 6;
const FOCUS_WINDOW = 10;
const SMALL_WEEK = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ── the calendar ───────────────────────────────────────────────────────────────────────────────────────────── */

function addDays(dateStr, n) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}
function weekday(dateStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
}
const isMonday = (dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) && weekday(dateStr) === 1;

/** The Monday of the PKT calendar week `when` falls in. */
function mondayOf(when) {
  const day = pktDate(new Date(when));
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** The week a Monday names: [fromIso, toIso) = Monday 00:00 to Friday 16:00 PKT. */
function weekBounds(monday) {
  const friday = addDays(monday, 4);
  return { monday, friday, fromIso: atPkt(monday, 0).toISOString(), toIso: atPkt(friday, READY_HOUR).toISOString() };
}

/** The Monday of the week a debrief counts in (by when its feedback was ready). */
function weekOfDebrief(iso) {
  const t = Date.parse(iso);
  const m = mondayOf(t);
  return t >= Date.parse(weekBounds(m).toIso) ? addDays(m, 7) : m;
}

/** The latest week whose report is ready at `now`: this week's from Friday 16:00, else last week's. */
function latestReadyMonday(now = new Date()) {
  const m = mondayOf(now);
  return now.getTime() >= Date.parse(weekBounds(m).toIso) ? m : addDays(m, -7);
}

/* ── the counts ─────────────────────────────────────────────────────────────────────────────────────────────── */

const done = (d, key) => !!(d && d.rubric && d.rubric[key] === true);
const scored = (d, key) => !!(d && d.rubric && typeof d.rubric[key] === 'boolean');
const byTimeDesc = (a, b) => Date.parse(b.at) - Date.parse(a.at);

function count(list, key) {
  const of = list.filter((d) => scored(d, key));
  return { done: of.filter((d) => done(d, key)).length, of: of.length };
}

/** Steady at the focus rule: 6 of 10, or the same share of fewer. */
const shareNeeded = (n) => Math.max(1, Math.ceil((FOCUS_DONE_AT / FOCUS_WINDOW) * n));
function steadyIn(list, key) {
  const c = count(list, key);
  return c.of > 0 && c.done >= shareNeeded(c.of);
}

/** The first behaviour, in order, not steady in `list` (starting after `afterKey`); null when every one is. */
function firstNotSteady(list, afterKey = null) {
  const start = afterKey ? BEHAVIOUR_KEYS.indexOf(afterKey) + 1 : 0;
  return BEHAVIOUR_KEYS.slice(start).find((k) => !steadyIn(list, k)) || null;
}

/**
 * @param {{ monday: string, thisWeek: {at: string, rubric: object}[], lastWeek: {at, rubric}[], before: {at, rubric}[] }} input
 *   thisWeek  her coached debriefs in the week; lastWeek, the week before; before, any of hers before this Monday
 *   (the newest 10 are used)
 */
function summariseWeek({ monday, thisWeek = [], lastWeek = [], before = [] }) {
  const b = weekBounds(monday);
  const week = [...thisWeek].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const n = week.length;
  const small = n < SMALL_WEEK;
  const prior10 = [...before].sort(byTimeDesc).slice(0, FOCUS_WINDOW);
  const upToFriday10 = [...thisWeek, ...before].sort(byTimeDesc).slice(0, FOCUS_WINDOW);

  const focusKey = prior10.length ? firstNotSteady(prior10) : (n ? firstNotSteady(week) : null);
  let focus = null;
  if (focusKey) {
    const last10 = count(upToFriday10, focusKey);
    const reached = last10.done >= FOCUS_DONE_AT;
    const days = [0, 1, 2, 3, 4].map((i) => {
      const date = addDays(monday, i);
      return { date, items: week.filter((d) => pktDate(new Date(d.at)) === date).map((d) => done(d, focusKey)) };
    });
    focus = {
      key: focusKey,
      module: BEHAVIOUR_MODULE[focusKey] || null,
      week: count(week, focusKey),
      last: lastWeek.length ? count(lastWeek, focusKey) : null,
      days,
      last10,
      doneAt: FOCUS_DONE_AT,
      reached,
      next: firstNotSteady(upToFriday10, focusKey),
    };
  }

  const others = BEHAVIOUR_KEYS.filter((k) => k !== focusKey).map((k) => ({ key: k, ...count(week, k) })).filter((c) => c.of > 0);
  const strengths = small ? [] : others.filter((c) => c.done * 3 > c.of * 2);
  const keepInMind = small ? [] : others
    .filter((c) => c.done * 2 < c.of)
    .sort((x, y) => (x.done - y.done) || (BEHAVIOUR_KEYS.indexOf(x.key) - BEHAVIOUR_KEYS.indexOf(y.key)))
    .slice(0, 2)
    .map((c) => ({ ...c, module: BEHAVIOUR_MODULE[c.key] || null }));

  return {
    monday: b.monday,
    friday: b.friday,
    target: TARGET,
    complete: n,
    debriefs: n,
    small,
    // bd-enec2e.5: "your first week" only when no debrief came before it, not merely none last week.
    firstWeek: before.length === 0,
    focus,
    strengths,
    keepInMind,
    respectAll: n > 0 && week.every((d) => d.rubric && d.rubric.disparaged_teacher === false),
    table: BEHAVIOUR_KEYS.map((k) => ({ key: k, week: count(week, k), last: lastWeek.length ? count(lastWeek, k) : null })),
  };
}

module.exports = {
  TARGET, READY_HOUR, FOCUS_DONE_AT, FOCUS_WINDOW, SMALL_WEEK,
  addDays, isMonday, mondayOf, weekBounds, weekOfDebrief, latestReadyMonday, summariseWeek,
};
