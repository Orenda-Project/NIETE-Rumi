/**
 * bd-x1tl95 — "Send feedback", from the More page of the coach's app (it opens in WhatsApp's in-app browser
 * from /portal, and in the Android app). Coaches asked to give it by voice, so a voice message is a first-class
 * answer; she may also write, and add up to three screenshots.
 *
 * ONE FORM, ONE TABLE. "Report an issue" (bd-whlsm0) asked the same thing in words only and started coach_feedback;
 * this form took its four kinds and writes the same table (bot/database/migrations/coach_feedback.sql, then
 * coach_feedback_voice.sql). The app's word is `topic`; the column is `kind`.
 *
 * THE ORDER
 * ---------
 *   1. presignUpload   the voice message and each screenshot go straight to R2 (kinds feedback_audio and
 *                      feedback_photo of portal-coaching.service: one signer, one ownership check).
 *   2. submitFeedback  checks every key is hers and arrived, keeps ONE coach_feedback row, and answers. Nothing
 *                      slow happens before she has her answer.
 *   3. followUp        afterwards (d.later): the voice message is transcribed onto the row, then ONE Slack post
 *                      tells the team it arrived, and notified_at is set. Slack is off until
 *                      APP_FEEDBACK_SLACK_CHANNEL is set: there is no fallback channel, so a deploy alone never
 *                      starts posting anywhere. With it off, or failing, the row is the record (notified_at NULL).
 *
 * IDENTITY. userId is the id the PORTAL read from its session; never one from the request body.
 * PRIVACY.  The Slack post names her (the team has to be able to reply) but never carries her phone. Logs carry
 *           the row id only. Links in the post are presigned for 7 days, the longest R2 allows; the keys stay on
 *           the row for good.
 */

const crypto = require('crypto');

const TOPICS = Object.freeze(['broken', 'numbers', 'idea', 'other']);
const TOPIC_LABEL = Object.freeze({
  broken: 'Something isn’t working', numbers: 'Numbers look wrong', idea: 'An idea', other: 'Something else',
});
const TABLE = 'coach_feedback';
const MAX_PAGE_CHARS = 200;
const MAX_TEXT_CHARS = 2000;
const MAX_FEEDBACK_PHOTOS = 3;
// A day's sends per person. Far above what anyone writes by hand; it stops a stuck tap or a loop flooding Slack.
const DAILY_CAP = 20;
const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const UPLOAD_KINDS = Object.freeze(['feedback_audio', 'feedback_photo']);

// The context the app may send, each with its check. Anything else is dropped, never stored.
const CONTEXT_FIELDS = Object.freeze({
  // dashboard app-funnel.routes browserClass(): classified from the request's own user agent
  browser: (v) => ['whatsapp-iab', 'webview', 'browser', 'native'].includes(v),
  appBuild: (v) => Number.isInteger(v) && v > 0 && v < 1e7,
});

function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../config/supabase'),
    r2: () => require('../../storage/r2'),
    coaching: () => require('../coaching/portal-coaching.service'),
    getUserLanguage: () => require('../../utils/language-cache').getUserLanguage,
    transcribe: () => require('../coaching/portal-coaching.service').transcribeFromR2,
    postToSlack: () => require('../monitoring/quiz-funnel-watch.service').postToSlack,
    env: () => process.env,
    later: () => (fn) => { setImmediate(fn); },
    logError: () => require('../../utils/logger').logError,
    logWarn: () => require('../../utils/logger').logWarn,
    now: () => () => new Date(),
    newId: () => () => crypto.randomUUID(),
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, {
      enumerable: true,
      get: () => (deps[name] !== undefined ? deps[name] : load()),
    });
  }
  return d;
}

/** Sign a direct-to-R2 upload of a voice message or a screenshot, and nothing else. */
async function presignUpload({ userId, filename, sizeBytes, kind }, deps) {
  if (!UPLOAD_KINDS.includes(kind)) return { status: 'invalid', reason: 'unknown_kind' };
  const d = withDefaults(deps);
  return d.coaching.presignUpload({ userId, filename, sizeBytes, kind }, { r2: d.r2, now: d.now, newId: d.newId });
}

/** The portal address she sent it from (coach_feedback.page's CHECK), else null. */
function pageOf(raw) {
  return typeof raw === 'string' && raw.startsWith('/portal/') && raw.length <= MAX_PAGE_CHARS ? raw : null;
}

function cleanContext(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [field, ok] of Object.entries(CONTEXT_FIELDS)) {
    if (ok(raw[field])) out[field] = raw[field];
  }
  return out;
}

/**
 * Keep what she sent and answer.
 * @returns {{status:'ok', feedbackId} | {status:'invalid', reason, key?}}
 */
async function submitFeedback({ userId, topic, text, audioKey, photoKeys, page, context }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  if (!TOPICS.includes(topic)) return { status: 'invalid', reason: 'bad_topic' };
  const message = String(text == null ? '' : text).trim();
  if (message.length > MAX_TEXT_CHARS) return { status: 'invalid', reason: 'too_long' };
  const audio = audioKey ? String(audioKey) : null;
  if (photoKeys != null && !Array.isArray(photoKeys)) return { status: 'invalid', reason: 'bad_photos' };
  const photos = (photoKeys || []).map(String);
  if (photos.length > MAX_FEEDBACK_PHOTOS) return { status: 'invalid', reason: 'too_many_photos' };
  if (!message && !audio) return { status: 'invalid', reason: 'empty' };

  const d = withDefaults(deps);
  const { isOwnPortalKey, checkUploaded } = d.coaching;
  if (audio && !isOwnPortalKey(userId, audio, 'feedback_audio')) return { status: 'invalid', reason: 'not_own_upload' };
  if (photos.some((k) => !isOwnPortalKey(userId, k, 'feedback_photo'))) return { status: 'invalid', reason: 'not_own_upload' };
  const missing = await checkUploaded(d, [
    ...(audio ? [{ key: audio, kind: 'feedback_audio' }] : []),
    ...photos.map((key) => ({ key, kind: 'feedback_photo' })),
  ]);
  if (missing) return missing;

  const since = new Date(d.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await d.supabase
    .from(TABLE).select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since);
  if (countError) throw new Error(`${TABLE} count failed: ${countError.message}`);
  if ((count || 0) >= DAILY_CAP) return { status: 'invalid', reason: 'too_many' };

  const row = {
    user_id: userId, kind: topic, message: message || null, page: pageOf(page),
    audio_key: audio, photo_keys: photos, context: cleanContext(context),
  };
  const { data, error } = await d.supabase.from(TABLE).insert(row).select('id').single();
  if (error || !data) throw new Error(`${TABLE} insert failed: ${error ? error.message : 'no row'}`);

  d.later(() => followUp({ id: data.id, ...row }, deps).catch((e) => {
    d.logError('❌ App feedback follow-up threw', { feedbackId: data.id, error: e && e.message });
  }));
  return { status: 'ok', feedbackId: data.id };
}

/**
 * After she has her answer: transcribe the voice message onto the row, then tell the team on Slack.
 * Never throws for a step that fails; each failure is logged and the next step still runs.
 */
async function followUp(row, deps) {
  const d = withDefaults(deps);
  let transcript = null;
  if (row.audio_key) {
    try {
      const language = await d.getUserLanguage(row.user_id);
      const heard = await d.transcribe(row.audio_key, language);
      transcript = String((heard && heard.text) || '').trim() || null;
      if (transcript) {
        const { error } = await d.supabase.from(TABLE).update({ audio_transcript: transcript }).eq('id', row.id);
        if (error) d.logWarn('⚠️ App feedback transcript not saved', { feedbackId: row.id, error: error.message });
      }
    } catch (e) {
      d.logWarn('⚠️ App feedback transcription failed; the post carries the audio link', { feedbackId: row.id, error: e && e.message });
    }
  }

  const env = d.env || {};
  const target = {
    token: env.APP_FEEDBACK_SLACK_TOKEN || env.PROD_DIGEST_SLACK_TOKEN || '',
    channel: env.APP_FEEDBACK_SLACK_CHANNEL || '',
  };
  // Not configured is not a failure: the row is kept and notified_at stays NULL, which is the record.
  if (!target.channel || !target.token) {
    return { notified: false, reason: target.channel ? 'no_token' : 'no_channel', transcript };
  }

  try {
    const { data: user } = await d.supabase.from('users').select('name').eq('id', row.user_id).maybeSingle();
    const link = (key) => d.r2.getPresignedGetUrl(key, LINK_TTL_SECONDS);
    const audioUrl = row.audio_key ? await link(row.audio_key) : null;
    const photoUrls = await Promise.all((row.photo_keys || []).map(link));
    const text = slackText({ row, name: user && user.name, transcript, audioUrl, photoUrls });
    await d.postToSlack(text, target);
  } catch (e) {
    d.logError('❌ App feedback Slack post failed', { feedbackId: row.id, error: e && e.message });
    return { notified: false, reason: 'post_failed', transcript };
  }
  const { error } = await d.supabase.from(TABLE).update({ notified_at: d.now().toISOString() }).eq('id', row.id);
  if (error) d.logWarn('⚠️ App feedback notified_at not saved', { feedbackId: row.id, error: error.message });
  return { notified: true, transcript };
}

/** The one Slack message: who, what about, her words, what she said, the files, and where she sent it from. */
function slackText({ row, name, transcript, audioUrl, photoUrls }) {
  const ctx = row.context || {};
  const where = [row.page, ctx.browser, ctx.appBuild ? `build ${ctx.appBuild}` : null].filter(Boolean).join(' · ');
  const lines = [
    `:speech_balloon: *App feedback* from ${name || 'a coach'} — ${TOPIC_LABEL[row.kind] || row.kind}`,
  ];
  if (row.message) lines.push(`> ${row.message.replace(/\n/g, '\n> ')}`);
  if (audioUrl) lines.push(`:studio_microphone: <${audioUrl}|Voice message>${transcript ? `: “${transcript}”` : ''}`);
  photoUrls.forEach((u, i) => lines.push(`:frame_with_picture: <${u}|Screenshot ${i + 1}>`));
  lines.push(`_${where ? `${where} · ` : ''}id ${row.id} · links last 7 days_`);
  return lines.join('\n');
}

module.exports = {
  TOPICS,
  MAX_TEXT_CHARS,
  MAX_FEEDBACK_PHOTOS,
  DAILY_CAP,
  UPLOAD_KINDS,
  presignUpload,
  submitFeedback,
  followUp,
  cleanContext,
};
