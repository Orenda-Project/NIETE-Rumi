/**
 * v10 coaching test (bd-v0toag.20): pick the one thing to try from the plan moves the grading marked
 * missed, and check the last one on this recording.
 *
 * Picked: the first must_happen move marked not_done that carries a practice tag (practice-tag.js), else
 * the first partial one. Stored as prioritized_action.thing_to_try = { move_id, lesson_id, text, tag };
 * thing-to-try.js shows it to C and D. Move ids only mean something inside one lesson, so the check on the
 * next recording (a different lesson) reads that recording's moves with the same tag. Only while
 * ab_v10_enabled is on, for every group: A and B never see it, but their check is the comparison.
 * Never throws: any failure leaves the commitment card as it was.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { v10Enabled } = require('./ab-v10-switch');
const { groupFor } = require('./ab-v10-arms');
const { practiceTag } = require('./practice-tag');

const DONE = new Set(['executed', 'substituted_equivalent', 'substituted_better']);

function gradedMoves(lpFidelity) {
  if (!lpFidelity || lpFidelity.status !== 'ok' || !Array.isArray(lpFidelity.moves)) return null;
  return lpFidelity.moves.filter((m) => m && typeof m === 'object');
}

/** { move_id, lesson_id, text, tag } for the move to try next, else null. Pure. */
function pickThingToTry(lpFidelity) {
  const moves = gradedMoves(lpFidelity);
  if (!moves) return null;
  const candidates = moves.filter((m) => (m.bucket || 'must_happen') === 'must_happen'
    && typeof m.text === 'string' && m.text.trim() && practiceTag(m));
  const move = candidates.find((m) => m.verdict === 'not_done') || candidates.find((m) => m.verdict === 'partial');
  if (!move) return null;
  return {
    move_id: move.move_id || null,
    lesson_id: lpFidelity.lesson_id || null,
    text: move.text.trim(),
    tag: practiceTag(move),
  };
}

/**
 * Did this recording show the prior thing's practice? { outcome, matched, moveIds }, null with no prior
 * tag. moveIds are the moves judged, so a coach can review the call. Pure.
 */
function checkThing(prior, lpFidelity) {
  if (!prior || !prior.tag) return null;
  const moves = gradedMoves(lpFidelity);
  if (!moves) return { outcome: 'not_graded', matched: 0, moveIds: [] };
  const same = moves.filter((m) => m.verdict !== 'not_adjudicable' && practiceTag(m) === prior.tag);
  let outcome = 'no_matching_move';
  if (same.some((m) => DONE.has(m.verdict))) outcome = 'did';
  else if (same.some((m) => m.verdict === 'partial')) outcome = 'partly';
  else if (same.length) outcome = 'not_done';
  return { outcome, matched: same.length, moveIds: same.map((m) => m.move_id) };
}

async function priorSession(userId, coachingSessionId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, prioritized_action')
    .eq('user_id', userId)
    .not('prioritized_action', 'is', null)
    .neq('id', coachingSessionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) return null;
  return data[0];
}

/** actionData with thing_to_try added (a copy), or actionData as given. Logs the check. Never throws. */
async function withThingToTry({ userId, coachingSessionId, lpFidelity, actionData }) {
  try {
    if (!(await v10Enabled())) return actionData;
    const arms = await groupFor(userId).catch(() => null);
    const group = arms ? arms.group : null;
    const lessonId = (lpFidelity && lpFidelity.lesson_id) || null;

    try {
      const prior = await priorSession(userId, coachingSessionId);
      const thing = prior && prior.prioritized_action && prior.prioritized_action.thing_to_try;
      const check = checkThing(thing, lpFidelity);
      if (check) {
        logEvent('coaching.thing_to_try.checked', {
          userId,
          sessionId: coachingSessionId,
          priorSessionId: prior.id,
          group,
          moveId: thing.move_id || null,
          setOnLessonId: thing.lesson_id || null,
          lessonId,
          tag: thing.tag,
          ...check,
        });
      }
    } catch (err) {
      logToFile('v10 test: thing to try check failed (non-critical)', { userId, coachingSessionId, error: err.message });
    }

    const pick = pickThingToTry(lpFidelity);
    if (!actionData || !pick) return actionData;
    logEvent('coaching.thing_to_try.set', {
      userId, sessionId: coachingSessionId, group, lessonId: pick.lesson_id, moveId: pick.move_id, tag: pick.tag,
    });
    return { ...actionData, thing_to_try: pick };
  } catch (err) {
    logToFile('v10 test: thing to try pick failed (the card is stored as it was)', {
      userId, coachingSessionId, error: err.message,
    });
    return actionData;
  }
}

module.exports = { pickThingToTry, checkThing, withThingToTry };
