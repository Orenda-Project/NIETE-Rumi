/**
 * v10 coaching test (bd-v0toag.20, bd-v0toag.100.8): the one thing to try, and whether she did it.
 *
 * Picked: the first must_happen move marked not_done that carries a practice tag (practice-tag.js), else
 * the first partial one. Stored as prioritized_action.thing_to_try = { move_id, lesson_id, text, tag, step };
 * thing-to-try.js shows it to C and D. An ask belongs to one subject and grade (thing-to-try-scope.js) and
 * stays until a recording of that subject and grade shows she did it (thing-to-try-judge.js judges the ask
 * itself); then a new one is picked, or a done marker stored when nothing was missed. Only while
 * ab_v10_enabled is on, for every group: A and B never see it, but their check is the comparison.
 * Never throws: any failure leaves the commitment card as it was.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { v10Enabled } = require('./ab-v10-switch');
const { groupFor } = require('./ab-v10-arms');
const { practiceTag } = require('./practice-tag');
const { stepOf } = require('./report-card');
const { scopeOf, activeThing } = require('./thing-to-try-scope');
const { judgeThing } = require('./thing-to-try-judge');

const RECENT = 20;
const MEMO_MAX = 200;
const memo = new Map();

function gradedMoves(lpFidelity) {
  if (!lpFidelity || lpFidelity.status !== 'ok' || !Array.isArray(lpFidelity.moves)) return null;
  return lpFidelity.moves.filter((m) => m && typeof m === 'object');
}

/** { move_id, lesson_id, text, tag, step } for the move to try next, else null. Pure. */
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
    step: stepOf(move.phase),
  };
}

const doneMarker = (lessonId) => ({ move_id: null, lesson_id: lessonId, text: null, tag: null, step: null });

/** A carried ask set before steps were stored: the step of its move in the session it was set on. */
function withStep(thing, lpFidelity) {
  if ('step' in thing) return thing;
  const moves = lpFidelity && Array.isArray(lpFidelity.moves) ? lpFidelity.moves : [];
  const m = moves.find((x) => x && thing.move_id && x.move_id === thing.move_id);
  return { ...thing, step: m ? stepOf(m.phase) : null };
}

async function recentSessions(userId, coachingSessionId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, prioritized_action, lp_fidelity:analysis_data->lp_fidelity')
    .eq('user_id', userId)
    .not('prioritized_action', 'is', null)
    .neq('id', coachingSessionId)
    .order('created_at', { ascending: false })
    .limit(RECENT);
  if (error) throw new Error(error.message);
  return data || [];
}

async function resolve({ userId, coachingSessionId, lpFidelity }) {
  const arms = await groupFor(userId).catch(() => null);
  const group = arms ? arms.group : null;
  const lessonId = (lpFidelity && lpFidelity.lesson_id) || null;
  const pick = pickThingToTry(lpFidelity);

  let live = null;
  try {
    live = activeThing(await recentSessions(userId, coachingSessionId), scopeOf(lessonId));
  } catch (err) {
    logToFile('v10 test: thing to try read failed, a new one is picked (non-critical)', {
      userId, coachingSessionId, error: err.message,
    });
  }
  if (!live) return { thing: pick, group, carried: false };

  const verdict = await judgeThing({ thing: live.thing, lpFidelity, sessionId: coachingSessionId });
  const carried = verdict.outcome !== 'did';
  logEvent('coaching.thing_to_try.checked', {
    userId,
    sessionId: coachingSessionId,
    priorSessionId: live.sessionId,
    group,
    moveId: live.thing.move_id || null,
    setOnLessonId: live.thing.lesson_id || null,
    lessonId,
    tag: live.thing.tag || null,
    outcome: verdict.outcome,
    judgedMoveId: verdict.moveId,
    moveIds: verdict.moveId ? [verdict.moveId] : [],
    evidence: verdict.evidence,
    why: verdict.why,
    carried,
  });
  if (carried) return { thing: withStep(live.thing, live.lpFidelity), group, carried };
  return { thing: pick || doneMarker(lessonId), group, carried };
}

/**
 * { thing, group, carried } for this recording: the live ask of its subject and grade carried forward until
 * judged done, else a new pick (or a done marker). Memoized by session, so the slim image and the stored
 * card agree and the ask is judged once.
 */
function resolveThing(args) {
  const key = args && args.coachingSessionId;
  if (key && memo.has(key)) return memo.get(key);
  const p = resolve(args);
  if (key) {
    memo.set(key, p);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
    p.catch(() => memo.delete(key));
  }
  return p;
}

/** actionData with thing_to_try added (a copy), or actionData as given. Never throws. */
async function withThingToTry({ userId, coachingSessionId, lpFidelity, actionData }) {
  try {
    if (!(await v10Enabled())) return actionData;
    const { thing, group, carried } = await resolveThing({ userId, coachingSessionId, lpFidelity });
    if (!actionData || !thing) return actionData;
    logEvent('coaching.thing_to_try.set', {
      userId, sessionId: coachingSessionId, group, lessonId: thing.lesson_id, moveId: thing.move_id, tag: thing.tag, carried,
    });
    return { ...actionData, thing_to_try: thing };
  } catch (err) {
    logToFile('v10 test: thing to try pick failed (the card is stored as it was)', {
      userId, coachingSessionId, error: err.message,
    });
    return actionData;
  }
}

module.exports = { pickThingToTry, resolveThing, withThingToTry };
