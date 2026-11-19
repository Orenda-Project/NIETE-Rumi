'use strict';
/**
 * bd-r2uzg1.18.7 (ICT sheet, DC row) — photos or a lesson plan sent on WhatsApp AFTER a lesson sent from the
 * recording screen.
 *
 * A teacher records her lesson on the Digital Coaching screen and presses Send with no lesson plan and no photos; then
 * she sends the plan and ~10 photos here. Nothing can join them to that lesson (it is analysed from what Send carried,
 * so her report says lesson-plan fidelity "not assessed"), and they fell to the generic picture path. Now, when her
 * LATEST own Digital Coaching session was sent from the recording screen (portal-coaching isPortalTeacherSession: an
 * app recording, not an observation) less than WINDOW_MS ago, she gets ONE message: these cannot be added to the
 * lesson she sent; next time add them on the recording screen before Send. It carries the Digital Coaching button the
 * bot's app links already use (app-redirect sendCoachingLink), or the same line as plain text when no link can be made.
 *
 * ONE MESSAGE PER BURST. Photos arrive as separate webhooks, often all at once:
 *   - the first claims `dc:media_after_app:<session id>` (SET NX, WINDOW_MS, value = when) and sends the message;
 *   - the rest, while she keeps sending (each within BURST_MS of the message or of the last one taken), are taken
 *     silently;
 *   - after BURST_MS of quiet, the next picture goes the way it went before (false): she has been told once about that
 *     lesson, and a later picture may be about something else.
 * Redis down: setNX answers "claimed" (railway-redis's rule), so one message per photo at worst, never silence. Nothing
 * sent at all: the claim is released and the caller runs today's path.
 *
 * Asked by image-message.handler after every session claim (child test, photo step, lesson-plan step, exam checker,
 * race-hold) and before the generic picture path, and by the webhook's document door (whatsapp-bot.js) after the
 * lesson-plan step, before "I received your document". A failed read is false: today's path.
 */

const { logToFile } = require('../../utils/logger');

/** How long after she sent her lesson a picture is taken as meant for it. */
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** The burst: a picture within this long of the message, or of the last picture taken, is part of it. */
const BURST_MS = 10 * 60 * 1000;
const KEY = 'dc:media_after_app';
/** The line and the button (ux-strings.js). The button is the one the saved-recording link already shows. */
const COPY = Object.freeze(['dcMediaAfterAppRecording', 'appLinkButtonCoachingSaved']);

const toMs = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Her newest Digital Coaching row (user_id = her). A coach's observation of her is her row too; it is not a lesson she
 * sent, so isPortalTeacherSession says no and she keeps today's path.
 */
async function latestSession(userId) {
  const supabase = require('../../config/supabase');
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, audio_url, observation_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || 'coaching_sessions read failed');
  return data || null;
}

/** The lesson she sent from the recording screen under WINDOW_MS ago, or null. */
async function recentAppLesson(userId, now) {
  const session = await latestSession(userId);
  if (!session) return null;
  const { isPortalTeacherSession } = require('./portal-coaching.service');
  if (!isPortalTeacherSession(session)) return null;
  const at = Date.parse(session.created_at);
  if (!Number.isFinite(at) || now - at >= WINDOW_MS) return null;
  return session;
}

/** Send the line with the Digital Coaching button, else as text. true when something reached her. */
async function sendNotice(user, from, kind) {
  let language = user.preferred_language;
  try {
    language = (await require('../../utils/language-cache').getUserLanguage(user.id)) || language;
  } catch (_) { /* her stored language, as read with the user */ }
  let sent = false;
  let via = 'cta_url';
  try {
    sent = await require('../app-redirect.service').sendCoachingLink({
      userId: user.id, from, language, reason: 'media_after_app_recording', copy: COPY,
    });
  } catch (err) {
    logToFile('⚠️ DC media after an app recording: the link threw — sending the line as text', { userId: user.id, error: err?.message }, 'warn');
  }
  if (!sent) {
    via = 'text';
    try {
      const { resolveUx } = require('../../config/ux-strings');
      sent = await require('../whatsapp.service').sendMessage(from, resolveUx(COPY[0], { language }));
    } catch (err) {
      logToFile('❌ DC media after an app recording: the line could not be sent', { userId: user.id, kind, error: err?.message }, 'error');
    }
  }
  return { sent: Boolean(sent), via };
}

/**
 * A picture or a document reached WhatsApp with no session waiting for it. If she sent a lesson from the recording
 * screen in the last WINDOW_MS, answer it (once per burst) and say so.
 *
 * @param {object} args
 * @param {object} args.user  her users row ({ id, preferred_language })
 * @param {string} args.from  WhatsApp number
 * @param {'image'|'document'} [args.kind]  log line only
 * @param {number} [args.now]  clock, for tests
 * @returns {Promise<boolean>} true = handled (the message went, or it is part of the burst); false = today's path
 */
async function answerMediaAfterAppRecording({ user, from, kind = 'image', now = Date.now() } = {}) {
  if (!user || !user.id || !from) return false;
  let session;
  try {
    session = await recentAppLesson(user.id, now);
  } catch (err) {
    logToFile('⚠️ DC media after an app recording: her latest session could not be read — today\'s path', { userId: user.id, kind, error: err?.message }, 'warn');
    return false;
  }
  if (!session) return false;

  const redis = require('../cache/railway-redis.service');
  const key = `${KEY}:${session.id}`;
  const lastKey = `${key}:last`;
  const burstS = Math.ceil(BURST_MS / 1000);
  const ids = { userId: user.id, coachingSessionId: session.id, kind };

  let claimed = true;
  try {
    claimed = await redis.setNX(key, String(now), Math.ceil(WINDOW_MS / 1000));
  } catch (_) { claimed = true; }

  if (!claimed) {
    let first = null;
    let last = null;
    try { [first, last] = await Promise.all([redis.get(key), redis.get(lastKey)]); } catch (_) { /* no anchor */ }
    if (!(now - Math.max(toMs(first), toMs(last)) < BURST_MS)) {
      logToFile('↩️ DC media after an app recording: told already, burst over — today\'s path', ids);
      return false;
    }
    try { await redis.set(lastKey, String(now), burstS); } catch (_) { /* the burst may close early */ }
    logToFile('🤫 DC media after an app recording: part of the burst — taken, no second message', ids);
    return true;
  }

  try { await redis.set(lastKey, String(now), burstS); } catch (_) { /* the message's own time anchors the burst */ }
  const { sent, via } = await sendNotice(user, from, kind);
  if (!sent) {
    try { await redis.delete(key); } catch (_) { /* the next picture waits for the burst instead */ }
    logToFile('❌ DC media after an app recording: nothing reached her — today\'s path', ids, 'error');
    return false;
  }
  logToFile('📎 DC media after an app recording: told her they cannot join the lesson she sent', { ...ids, via });
  return true;
}

module.exports = {
  WINDOW_MS,
  BURST_MS,
  answerMediaAfterAppRecording,
};
