'use strict';
/**
 * R165 — ONE rule for "which coaching session does this photo /
 * lesson plan belong to?", shared by every media arrival site:
 *   image-message.handler.js   Phase-3 photo gate · LP-as-photo gate · race-hold gate
 *   whatsapp-bot.js            document-as-photo gate · LP DOCUMENT gate
 *
 * Until this module each site ran its own
 *   .or(user_id / observer_user_id).in('status', …).order('created_at', desc).limit(1)
 * i.e. "the sender's NEWEST session at the gate". A coach running observations
 * back-to-back had two sessions at the same gate and every file landed on the
 * newest one regardless of teacher (31 Aug: 3 photos in 5 min, all newest-first).
 *
 * Resolution order:
 *   1. a stored target (media-target.service — set by the photo_yes_ / lp_upload_
 *      / lessonplan_yes_ taps) whose session is still at this gate → use it;
 *   2. otherwise the candidate query WITHOUT limit(1):
 *        exactly one → use it (today's behaviour)
 *        none        → 'none' (caller keeps its fall-through)
 *        several     → 'ambiguous' — the caller parks the media and ASKS.
 *
 * Load (pre-merge Class R): at most two keyed/indexed reads per media arrival
 * (target row by id, then the sender's sessions at one status set — the same
 * filter the old query used, minus the limit; a coach has a handful of open
 * sessions at most). Narrow columns only — never analysis_data/transcript_text.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const MediaTarget = require('./media-target.service');
const {
  CLASSROOM_PHOTO_STATUSES, isClassroomPhotoState,
  PRE_PHOTO_PROCESSING_STATUSES, shouldHoldImageForActiveCoaching,
} = require('./photo-capture-routing');

const SESSION_COLUMNS = 'id, status, user_id, observer_user_id, created_at, conversation_state, classroom_photos';

// kind → which sessions can accept this media right now. `targetKind` names
// the stored-target kind that may pre-empt the candidate rule (null = never:
// the race-hold gate has no tap that could have set one).
const KINDS = {
  photo: {
    targetKind: 'photo',
    statuses: CLASSROOM_PHOTO_STATUSES,
    accepts: (s) => isClassroomPhotoState(s.conversation_state && s.conversation_state.current_state),
  },
  lp: {
    targetKind: 'lp',
    statuses: ['awaiting_lesson_plan'],
    accepts: () => true,
  },
  hold: {
    targetKind: null,
    statuses: Array.from(PRE_PHOTO_PROCESSING_STATUSES),
    accepts: (s) => shouldHoldImageForActiveCoaching(s),
  },
};

function isSenderParty(session, userId) {
  return !!session && (session.user_id === userId || session.observer_user_id === userId);
}

/** True when `session` is at the gate for `kind` (status + state). */
function sessionAccepts(session, kind) {
  const spec = KINDS[kind];
  return !!(session && spec && spec.statuses.includes(session.status) && spec.accepts(session));
}

async function fetchSession(sessionId, client = supabase) {
  const { data } = await client
    .from('coaching_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();
  return data || null;
}

/**
 * @param {{ user: {id:string}, kind: 'photo'|'lp'|'hold', client?: object }} args
 * @returns {Promise<{ outcome: 'target'|'single'|'none'|'ambiguous', session: object|null, candidates: object[] }>}
 */
async function resolveMediaSession({ user, kind, client = supabase }) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`media-session-resolver: unknown kind "${kind}"`);
  const userId = user.id;

  if (spec.targetKind) {
    const target = await MediaTarget.getTarget(userId);
    if (target && target.kind === spec.targetKind && target.sessionId) {
      const t = await fetchSession(target.sessionId, client);
      if (isSenderParty(t, userId) && sessionAccepts(t, kind)) {
        return { outcome: 'target', session: t, candidates: [t] };
      }
      // The tapped observation has moved past this gate — forget the target so
      // it cannot misroute later media, and fall back to the candidate rule.
      logToFile('📎 media-target: stored target no longer at this gate — forgetting it', {
        userId, kind, sessionId: target.sessionId, status: t && t.status,
      });
      await MediaTarget.clearTarget(userId);
    }
  }

  const { data, error } = await client
    .from('coaching_sessions')
    .select(SESSION_COLUMNS)
    .or(`user_id.eq.${userId},observer_user_id.eq.${userId}`)
    .in('status', spec.statuses)
    .order('created_at', { ascending: false });
  if (error) {
    // Same fall-through the old per-site queries had (they destructured `data`
    // only): a read failure is "nothing at this gate", never a crash.
    logToFile('⚠️ media-session-resolver: candidate query failed — treating as none', { userId, kind, error: error.message });
    return { outcome: 'none', session: null, candidates: [] };
  }

  const candidates = (data || []).filter((s) => spec.accepts(s));
  if (candidates.length === 0) return { outcome: 'none', session: null, candidates: [] };
  if (candidates.length === 1) return { outcome: 'single', session: candidates[0], candidates };
  return { outcome: 'ambiguous', session: null, candidates };
}

module.exports = { resolveMediaSession, sessionAccepts, fetchSession, isSenderParty, SESSION_COLUMNS, KINDS };
