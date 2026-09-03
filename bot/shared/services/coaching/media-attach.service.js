'use strict';
/**
 * R165 — attach a coach's photo / lesson plan to the RIGHT
 * observation, or ask which one.
 *
 * Every media arrival site (image webhook, document webhook) now calls one of
 * the two `handle*Arrival` entry points instead of running its own
 * newest-first query + inline attach:
 *   handlePhotoArrival        classroom photo (kind 'photo' = on the photo step,
 *                             kind 'hold' = raced the transcription)
 *   handleLessonPlanMediaArrival  lesson plan as document OR photo
 *
 * Both resolve the session through media-session-resolver (tapped target →
 * single candidate → ask), then attach through ONE code path each:
 *   attachClassroomPhoto   → capture.service (capturePhotoAndPrompt / hold)
 *   attachLessonPlanMedia  → CoachingService.handleLessonPlanResponse
 * When the resolver is ambiguous the media is PARKED (media:parked:<userId>)
 * and the coach gets an interactive list "Which teacher is this for?"; her
 * `mediatarget_<sid>` tap (handleMediaTargetTap) sets the target and re-runs
 * the SAME attach for the parked media.
 *
 * image-id SETNX idempotency is kept: the media id is claimed with SETNX under the
 * same `image:<userId>:<mediaId>` key the image handler always used — a
 * redelivered webhook is a silent no-op whether the copy attaches or parks.
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');
const MediaTarget = require('./media-target.service');
const { resolveMediaSession, sessionAccepts, fetchSession, isSenderParty } = require('./media-session-resolver');
const { CLASSROOM_PHOTO_STATUSES, isClassroomPhotoState } = require('./photo-capture-routing');

const IDEMPOTENCY_TTL_SECONDS = 3600;   // same window as image-message.handler
const TAP_LOCK_TTL_SECONDS = 300;
const MAX_ASK_ROWS = 10;                // WhatsApp list cap
const MEDIATARGET_PREFIX = 'mediatarget_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function claimMedia(userId, mediaId, status) {
  return redisService.setNX(
    `image:${userId}:${mediaId}`,
    JSON.stringify({ status, startedAt: Date.now() }),
    IDEMPOTENCY_TTL_SECONDS,
  );
}

// Coach language, clamped to the NIETE offer (en/ur) by the catalog's own
// clampLanguage — no inline floor here (language-protocol, Rule 20).
async function coachLanguage(user) {
  const { clampLanguage } = require('../../config/ux-strings');
  try {
    const { getUserLanguage } = require('../../utils/language-cache');
    return clampLanguage((await getUserLanguage(user.id)) || (user && user.preferred_language));
  } catch (_) {
    return clampLanguage(user && user.preferred_language);
  }
}

/**
 * Attach one classroom photo to a KNOWN session. On the photo step → capture +
 * add-another/done prompt; still processing (race) → hold on the session.
 */
async function attachClassroomPhoto({ user, from, mediaId, mimeType, session, claim = true }) {
  if (claim) {
    const ok = await claimMedia(user.id, mediaId, 'classroom_photo_handled');
    if (!ok) {
      logToFile('🔁 Duplicate classroom-photo webhook — skipping', { coachingSessionId: session.id, userId: user.id, imageId: mediaId });
      return { outcome: 'duplicate', sessionId: session.id };
    }
  }
  const WhatsAppService = require('../whatsapp.service');
  const { capturePhotoAndPrompt, holdPhotoForSession } = require('./classroom-photo/capture.service');
  const imageBuffer = await WhatsAppService.downloadMedia(mediaId);
  const onPhotoStep = CLASSROOM_PHOTO_STATUSES.includes(session.status)
    && isClassroomPhotoState(session.conversation_state && session.conversation_state.current_state);
  const mime = mimeType || 'image/jpeg';
  if (onPhotoStep) {
    await capturePhotoAndPrompt({ session, imageBuffer, mimeType: mime, from, user });
  } else {
    await holdPhotoForSession({ session, imageBuffer, mimeType: mime, from, user });
  }
  logToFile('📸 Classroom photo attached', {
    coachingSessionId: session.id, userId: user.id, imageId: mediaId, mode: onPhotoStep ? 'capture' : 'hold',
  });
  return { outcome: 'attached', sessionId: session.id, mode: onPhotoStep ? 'capture' : 'hold' };
}

/** Hand a lesson plan (document or photo) to the LP processor for a KNOWN session. */
async function attachLessonPlanMedia({ user, from, mediaId, session, claim = true }) {
  if (claim) {
    const ok = await claimMedia(user.id, mediaId, 'lp_media_handled');
    if (!ok) {
      logToFile('🔁 Duplicate lesson-plan media webhook — skipping', { coachingSessionId: session.id, userId: user.id, mediaId });
      return { outcome: 'duplicate', sessionId: session.id };
    }
  }
  const CoachingService = require('../coaching-orchestrator.service');
  await CoachingService.handleLessonPlanResponse(session.id, from, true, mediaId);
  // One document per LP step — the lp target is consumed once it lands.
  const target = await MediaTarget.getTarget(user.id);
  if (target && target.kind === 'lp' && target.sessionId === session.id) await MediaTarget.clearTarget(user.id);
  logToFile('📄 Lesson plan media attached', { coachingSessionId: session.id, userId: user.id, mediaId });
  return { outcome: 'attached', sessionId: session.id };
}

// Observed-teacher names for the "which teacher?" rows. The session owner
// (user_id) is the observed teacher when the coach bound one; when she
// recorded ad-hoc the owner is the coach herself — skip that and try the
// linked observation_schedules row (the observed-teacher lookup the debrief list uses). Any failure just costs
// the name (the row falls back to a time label) — never the prompt.
async function teacherNamesFor(candidates, coachUserId) {
  const bySession = new Map();
  const ownerIds = [...new Set(candidates.map((c) => c.user_id).filter((id) => id && id !== coachUserId))];
  try {
    if (ownerIds.length) {
      const { data } = await supabase.from('users').select('id, name, first_name').in('id', ownerIds);
      const byUser = new Map();
      for (const u of data || []) byUser.set(u.id, String(u.name || u.first_name || '').trim() || null);
      for (const c of candidates) if (byUser.get(c.user_id)) bySession.set(c.id, byUser.get(c.user_id));
    }
  } catch (_) { /* name only */ }
  const missing = candidates.filter((c) => !bySession.has(c.id)).map((c) => c.id);
  try {
    if (missing.length) {
      const { data } = await supabase.from('observation_schedules').select('session_id, teacher_name').in('session_id', missing);
      for (const s of data || []) {
        const n = String(s.teacher_name || '').trim();
        if (s.session_id && n && !bySession.has(s.session_id)) bySession.set(s.session_id, n);
      }
    }
  } catch (_) { /* name only */ }
  return bySession;
}

/** Park the media and ask the coach which observation it belongs to. */
async function parkAndAsk({ user, from, kind, mediaId, mimeType, candidates }) {
  const claimed = await claimMedia(user.id, mediaId, 'parked_awaiting_target');
  if (!claimed) {
    logToFile('🔁 Duplicate media webhook while parked — skipping', { userId: user.id, mediaId });
    return { outcome: 'duplicate' };
  }
  await MediaTarget.parkMedia(user.id, { mediaId, mimeType, kind });
  const rows = candidates.slice(0, MAX_ASK_ROWS);
  const names = await teacherNamesFor(rows, user.id);
  const lang = await coachLanguage(user);
  const { buildMediaTargetPrompt } = require('../observe/observe-strings');
  const prompt = buildMediaTargetPrompt(lang, {
    kind,
    candidates: rows.map((c) => ({ id: c.id, teacherName: names.get(c.id) || null, created_at: c.created_at })),
  });
  const WhatsAppService = require('../whatsapp.service');
  const sent = await WhatsAppService.sendInteractiveMessage(from, prompt);
  logToFile('📎 media ambiguous — parked and asked which teacher', {
    userId: user.id, kind, mediaId, candidates: rows.map((c) => c.id), sent,
  });
  return { outcome: 'asked', rows: rows.length };
}

/**
 * A classroom photo arrived (image webhook or image-as-document).
 * @param {{ kind?: 'photo'|'hold' }} kind — 'photo' = the photo-step gate,
 *   'hold' = the race-hold gate (still transcribing/analyzing).
 * @returns {Promise<boolean>} true when handled (attached, parked, or a dupe);
 *   false when no session is at this gate (caller keeps its fall-through).
 */
async function handlePhotoArrival({ user, from, mediaId, mimeType, kind = 'photo' }) {
  const r = await resolveMediaSession({ user, kind });
  if (r.outcome === 'none') return false;
  if (r.outcome === 'ambiguous') {
    await parkAndAsk({ user, from, kind: 'photo', mediaId, mimeType, candidates: r.candidates });
    return true;
  }
  const res = await attachClassroomPhoto({ user, from, mediaId, mimeType, session: r.session });
  // The tapped observation keeps receiving her next photos: refresh the target.
  if (r.outcome === 'target' && res.outcome === 'attached') await MediaTarget.setTarget(user.id, r.session.id, 'photo');
  return true;
}

/**
 * A lesson plan arrived (document webhook, or a photo while a session waits at
 * awaiting_lesson_plan). Same contract as handlePhotoArrival.
 */
async function handleLessonPlanMediaArrival({ user, from, mediaId, mimeType }) {
  const r = await resolveMediaSession({ user, kind: 'lp' });
  if (r.outcome === 'none') return false;
  if (r.outcome === 'ambiguous') {
    await parkAndAsk({ user, from, kind: 'lp', mediaId, mimeType, candidates: r.candidates });
    return true;
  }
  await attachLessonPlanMedia({ user, from, mediaId, session: r.session });
  return true;
}

/**
 * `mediatarget_<sessionId>` list tap — the coach's answer to "which teacher?".
 * Sets the target and attaches the parked media through the same attach path.
 * @returns {Promise<boolean>} false only when the id is not ours.
 */
async function handleMediaTargetTap(listId, from, user) {
  if (!listId || !listId.startsWith(MEDIATARGET_PREFIX) || !user || !user.id) return false;
  const sessionId = listId.slice(MEDIATARGET_PREFIX.length);
  const WhatsAppService = require('../whatsapp.service');
  const { mediaTargetString } = require('../observe/observe-strings');
  const lang = await coachLanguage(user);
  if (!UUID_RE.test(sessionId)) {
    logToFile('⚠️ mediatarget tap with a malformed session id — ignoring', { listId, userId: user.id });
    return true;
  }

  const parked = await MediaTarget.getParked(user.id);
  if (!parked) {
    // The parked copy expired (2h) — remember the choice and ask for a re-send.
    await MediaTarget.setTarget(user.id, sessionId, 'photo');
    await WhatsAppService.sendMessage(from, mediaTargetString(lang, 'resend'));
    return true;
  }

  // A double tap must attach exactly once.
  const lock = await redisService.setNX(`media:attach:${user.id}:${parked.mediaId}`, '1', TAP_LOCK_TTL_SECONDS);
  if (!lock) return true;

  const kind = parked.kind === 'lp' ? 'lp' : 'photo';
  await MediaTarget.setTarget(user.id, sessionId, kind);

  const session = await fetchSession(sessionId);
  const accepting = isSenderParty(session, user.id) && (kind === 'lp'
    ? sessionAccepts(session, 'lp')
    : (sessionAccepts(session, 'photo') || sessionAccepts(session, 'hold')));
  if (!accepting) {
    await MediaTarget.clearParked(user.id);
    await WhatsAppService.sendMessage(from, mediaTargetString(lang, 'stale'));
    logToFile('📎 mediatarget tap: session no longer accepts this media', { userId: user.id, sessionId, kind, status: session && session.status });
    return true;
  }

  if (kind === 'lp') {
    await attachLessonPlanMedia({ user, from, mediaId: parked.mediaId, session, claim: false });
  } else {
    await attachClassroomPhoto({ user, from, mediaId: parked.mediaId, mimeType: parked.mimeType, session, claim: false });
  }
  await MediaTarget.clearParked(user.id);
  return true;
}

module.exports = {
  handlePhotoArrival,
  handleLessonPlanMediaArrival,
  handleMediaTargetTap,
  attachClassroomPhoto,
  attachLessonPlanMedia,
  parkAndAsk,
  MEDIATARGET_PREFIX,
};
