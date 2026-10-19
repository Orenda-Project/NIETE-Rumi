'use strict';
/**
 * Live moves (bd-v0toag.31): what the bot's /api/internal/coaching/live/* routes run. Every result carries a
 * `status` for portalCoachingRoute's HTTP mapping. `userId` is always the portal session's, never the browser's.
 */

const WINDOW_CHARS = 6000;
const MAX_TAPS = 200;
const CHOICES = new Set(['did', 'did_not']);
const LIVE_STATES = new Set(['ticked', 'unticked']);

// Defaults load lazily so a route test can mock this module without pulling in the bot's clients.
function withDefaults(deps = {}) {
  const pick = (name, load) => (deps[name] !== undefined ? deps[name] : load());
  return {
    supabase: pick('supabase', () => require('../../../config/supabase')),
    liveMovesOn: pick('liveMovesOn', () => require('./switch').liveMovesOn),
    loadCardMoves: pick('loadCardMoves', () => require('./card-store').loadCardMoves),
    mintLessonKey: pick('mintLessonKey', () => require('./live-key').mintLessonKey),
    detectMoves: pick('detectMoves', () => require('./detector').detectMoves),
    cap: pick('cap', () => require('./live-key').defaultCap),
    log: pick('log', () => require('../../../utils/logger').logToFile),
    now: pick('now', () => Date.now),
  };
}

async function eligible({ userId }, deps) {
  const d = withDefaults(deps);
  return { status: 'ok', on: Boolean(await d.liveMovesOn(userId)) };
}

async function card({ userId, lessonId }, deps) {
  const d = withDefaults(deps);
  if (!lessonId || !(await d.liveMovesOn(userId))) return { status: 'ok', on: false };
  const moves = await d.loadCardMoves(lessonId);
  return moves ? { status: 'ok', on: true, card: moves } : { status: 'ok', on: false };
}

async function key({ userId, liveId }, deps) {
  const d = withDefaults(deps);
  if (!liveId) return { status: 'invalid', ok: false, reason: 'liveId' };
  if (!(await d.liveMovesOn(userId))) return { status: 'ok', ok: false, reason: 'off' };
  return { status: 'ok', ...(await d.mintLessonKey({ liveId, userId }, { cap: d.cap })) };
}

async function detect({ userId, liveId, lessonId, window, unticked }, deps) {
  const d = withDefaults(deps);
  if (!liveId || !lessonId || !Array.isArray(unticked)) return { status: 'invalid', ticked: [] };
  if (!(await d.liveMovesOn(userId))) return { status: 'ok', ticked: [] };
  d.cap.touch(liveId, d.now());
  const moves = await d.loadCardMoves(lessonId);
  if (!moves) return { status: 'ok', ticked: [] };
  const open = new Set(unticked);
  const wanted = moves.sections.flatMap((s) => s.moves).filter((m) => open.has(m.idx));
  const ticked = await d.detectMoves({ window: String(window || '').slice(-WINDOW_CHARS), moves: wanted });
  return { status: 'ok', ticked };
}

async function end({ userId, liveId, drops, bytesSent }, deps) {
  const d = withDefaults(deps);
  if (!liveId) return { status: 'invalid', ok: false };
  d.cap.release(liveId);
  d.log('live_moves.stream.ended', { userId, liveId, drops, bytesSent });
  return { status: 'ok', ok: true };
}

function validTap(t) {
  return Boolean(t) && Number.isInteger(t.idx) && t.idx >= 0 && CHOICES.has(t.choice)
    && typeof t.at === 'string' && LIVE_STATES.has(t.live_state);
}

async function taps({ userId, coachingSessionId, taps: incoming }, deps) {
  const d = withDefaults(deps);
  if (!coachingSessionId || !Array.isArray(incoming)) return { status: 'invalid', ok: false, reason: 'body' };
  const { data: row, error } = await d.supabase.from('coaching_sessions')
    .select('id, user_id, analysis_data').eq('id', coachingSessionId).maybeSingle();
  if (error) return { status: 'error', ok: false };
  if (!row || row.user_id !== userId) return { status: 'not_found', ok: false, reason: 'not_owner' };
  const data = row.analysis_data || {};
  if (data.lp_fidelity) return { status: 'not_ready', ok: false, reason: 'graded' };
  const live = data.live_moves || {};
  const kept = [...(live.taps || []), ...incoming.filter(validTap)].slice(-MAX_TAPS);
  const patch = { analysis_data: { ...data, live_moves: { ...live, taps: kept } } };
  // The grader writes lp_fidelity into the same blob; only write while it is still absent.
  const { error: writeError } = await d.supabase.from('coaching_sessions')
    .update(patch).eq('id', coachingSessionId).is('analysis_data->lp_fidelity', null);
  if (writeError) return { status: 'error', ok: false };
  return { status: 'ok', ok: true };
}

module.exports = { eligible, card, key, detect, end, taps, WINDOW_CHARS, MAX_TAPS };
