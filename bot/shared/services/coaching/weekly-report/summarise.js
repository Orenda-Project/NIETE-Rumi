'use strict';
/**
 * bd-v0toag.32 — one teacher's week, rows in, numbers out. Pure: no database, no clock.
 *
 * Definitions (they follow ab-test-v10-coaching/workbench/tracking/*.sql):
 *   lessonPlans  distinct lessons the teacher received on WhatsApp (niete_lp_downloads, status sent) or
 *                opened in the app (niete_lp_opens, k5). The same lesson twice counts once.
 *   recordings   graded class recordings (coaching_sessions, observation_type null, scores present).
 *   daysUsed     distinct PKT calendar days with a message, a lesson plan, or a recording.
 *   move         the next-recording check of the thing to try (thing-to-try-pick.checkThing):
 *                did / partly / not_done are readable; no_matching_move and not_graded are not.
 *   thumbs       "Do you agree?" answers on the week's reports (coaching_quality_metrics, 1 agree, 0 not).
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const NAIVE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** PKT YYYY-MM-DD of a timestamp. Zone-less values (conversations.created_at) are UTC. */
function pktDay(ts) {
  if (!ts) return null;
  const s = String(ts);
  const ms = Date.parse(NAIVE.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

const list = (v) => (Array.isArray(v) ? v : []);

function summarise({ messages, deliveries, opens, sessions, ratings, checks } = {}) {
  const lessons = new Set();
  for (const r of list(deliveries)) if (r && r.lesson_id) lessons.add(String(r.lesson_id));
  for (const r of list(opens)) if (r && r.plan_ref) lessons.add(String(r.plan_ref));

  const days = new Set();
  const addDay = (ts) => { const d = pktDay(ts); if (d) days.add(d); };
  for (const r of list(messages)) addDay(r && r.created_at);
  for (const r of list(deliveries)) addDay(r && r.created_at);
  for (const r of list(opens)) addDay(r && r.opened_at);
  for (const r of list(sessions)) addDay(r && r.created_at);

  const move = { did: 0, partly: 0, notDone: 0, checked: 0 };
  for (const c of list(checks)) {
    const o = c && c.outcome;
    if (o === 'did') move.did += 1;
    else if (o === 'partly') move.partly += 1;
    else if (o === 'not_done') move.notDone += 1;
    else continue;
    move.checked += 1;
  }

  const thumbs = { up: 0, down: 0 };
  for (const r of list(ratings)) {
    const v = r && r.user_satisfaction_rating;
    if (v === 1) thumbs.up += 1;
    else if (v === 0) thumbs.down += 1;
  }

  return {
    lessonPlans: lessons.size,
    daysUsed: days.size,
    recordings: list(sessions).length,
    move,
    thumbs,
  };
}

/** Nothing to count: the kind no-numbers message goes instead. */
function isQuietWeek(s) {
  return !s || (s.lessonPlans === 0 && s.recordings === 0 && s.daysUsed === 0);
}

module.exports = { summarise, isQuietWeek, pktDay };
