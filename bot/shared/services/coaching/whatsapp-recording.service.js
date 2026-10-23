'use strict';
/**
 * bd-c5reix — a classroom recording a teacher sends on WhatsApp, KEPT for the app.
 *
 * Since 19 Oct (app_redirect_ai_coaching = "teachers") a teacher on the teacher app who sends a lesson of 15 minutes
 * or more gets the app link instead of coaching, and the recording was dropped: 1,073 recordings from 395 teachers
 * between 20 and 22 Oct, of whom 173 (44%) went on to start a DC observation in the app. Now the recording is saved
 * before the link goes, and it waits for her in Digital Coaching: she adds her class (a lesson plan and photos if she
 * likes) and sends it, with nothing uploaded twice.
 *
 * WHERE IT LIVES — R2 ONLY, NO TABLE
 * ----------------------------------
 * Under the portal's own audio tree, so the app's Submit (startPortalSession) takes it exactly as it takes an upload
 * (isOwnPortalKey and PORTAL_KEY_RX, both unchanged):
 *
 *     classroom_audio/<uid>/<YYYY-MM>/portal_wa-<first 16 of the sha256>-<uuid>.<ext>
 *
 * `wa-` says it came from WhatsApp; the hash prefix lets the bot find the same bytes by LISTING, without a read per
 * object. The full sha256, the duration and the door ride as object metadata. "Waiting" is such an object, at most
 * PENDING_DAYS old, that no coaching_sessions row has as its audio_url. Once she sends it, the row it becomes is the
 * record; nothing else is written anywhere.
 *
 * THE SAME RECORDING AGAIN (bd-7beiz's rule, moved to the door)
 * -------------------------------------------------------------
 *   · the same bytes as a DC observation of hers that was analysed (findRecentDuplicateSession: her own, not an
 *     observation, completed, no time window), or as a saved WhatsApp recording she already sent from the app →
 *     nothing is saved; she is told she sent it before, and the link opens Digital Coaching, where its report is;
 *   · the same bytes as a recording still waiting → nothing is saved twice; the normal link (it is already there).
 */

const crypto = require('crypto');

/** How long a saved recording waits for her in the app. */
const PENDING_DAYS = 7;
const PENDING_MS = PENDING_DAYS * 24 * 60 * 60 * 1000;
/** Hex characters of the sha256 carried in the key. */
const SHA_PREFIX = 16;
/** The listen link's life: long enough for the page to sit open, short enough not to be a share link. */
const LISTEN_TTL_SECONDS = 30 * 60;
/** How long the link may wait for the recording to be kept (download + hash + put); past it, today's link goes. */
const SAVE_TIMEOUT_MS = 60 * 1000;
/** The most waiting recordings the page is shown (each costs one HEAD). */
const MAX_PENDING = 10;
/** A DC observation that never reached analysis was not "sent before" (audio-hash-cache NOT_ANALYSED_STATUSES). */
const NOT_ANALYSED = ['cancelled', 'abandoned', 'failed'];
const SHA_RX = /^[0-9a-f]{64}$/;
/** A saved WhatsApp recording's key, and the two things it carries. */
const WA_KEY_RX = /\/portal_wa-([0-9a-f]{16})-[A-Za-z0-9-]+\.[a-z0-9]+$/;

/** The app link's landing for a saved recording (app-login-link.js LANDINGS) — the one screen, with it attached. */
const SAVED_LANDING = 'ai_coaching_recording';
/** The app link's words for a recording she sent before (ux-strings.js). */
const REPEAT_COPY = Object.freeze(['appLinkBodyCoachingRepeat', 'appLinkButtonCoachingRepeat']);

/** WhatsApp's media types → the portal's audio extension. The file's own name wins when it names one we take. */
const MIME_EXT = Object.freeze({
  'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a', 'audio/m4a': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr', 'audio/wav': '.wav',
  'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/webm': '.webm', 'audio/3gpp': '.3gp',
});

const portal = () => require('./portal-coaching.service');

/** Default collaborators, each required only when first used (portal-coaching.service's pattern). */
function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../config/supabase'),
    r2: () => require('../../storage/r2'),
    redirect: () => require('../app-redirect.service'),
    downloadMedia: () => (id) => require('../whatsapp.service').downloadMedia(id),
    hashCache: () => require('./audio-hash-cache'),
    log: () => require('../../utils/logger').logToFile,
    tk: () => require('../quiz/web-quiz-kid').tk,
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

/** A funnel row (app-redirect.service funnelEvent's shape): `event` names it, the journey id joins it to the rest. */
function funnel(d, name, props) {
  try { d.log(name, { event: name, ...props }); } catch (_) { /* a log line never decides what she receives */ }
}

const timeOf = (v) => {
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

/** The audio extension to save under, or null when it is not a format the app takes. */
function audioExtFor({ filename, mimeType }) {
  const { KINDS, extOf } = portal();
  const types = KINDS.audio.types;
  const own = extOf(filename);
  if (own && types[own]) return own;
  const ext = MIME_EXT[String(mimeType || '').toLowerCase().split(';')[0].trim()];
  return ext && types[ext] ? ext : null;
}

/** Is this a recording the bot saved from WhatsApp (and not one she uploaded in the app)? */
function isWhatsAppKey(key) {
  return WA_KEY_RX.test(String(key || ''));
}

/** The id the page names a saved recording by: its file name, without the extension. */
function recordingIdOf(key) {
  const m = String(key || '').match(/\/(portal_wa-[A-Za-z0-9-]+)\.[a-z0-9]+$/);
  return m ? m[1] : null;
}

/** This month and the one before (UTC, as buildUploadKey names them): a PENDING_DAYS window spans at most two. */
function months(now) {
  const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [ym(now), ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))];
}

/** Her saved WhatsApp recordings (only those with this hash prefix, when given), newest first. */
async function listSaved(d, userId, shaPrefix = '') {
  const out = [];
  for (const ym of months(d.now())) {
    const prefix = `classroom_audio/${userId}/${ym}/portal_wa-${shaPrefix ? `${shaPrefix}-` : ''}`;
    // eslint-disable-next-line no-await-in-loop
    for (const o of (await d.r2.listObjects(prefix)) || []) if (isWhatsAppKey(o.key)) out.push(o);
  }
  return out.sort((a, b) => timeOf(b.lastModified) - timeOf(a.lastModified));
}

/**
 * Which of these keys a session of hers holds — live or completed: key → { id, status }. A session that ended without
 * analysis (NOT_ANALYSED) does not hold it, so her recording stays waiting and Submit takes it again. The key is matched
 * as coaching_sessions.audio_url stores it: r2.buildR2PublicUrl(key), exact (startPortalSession writes it so).
 */
async function sessionsHolding(d, userId, keys) {
  if (!keys.length) return new Map();
  const byUrl = new Map(keys.map((k) => [d.r2.buildR2PublicUrl(k), k]));
  const { data, error } = await d.supabase
    .from('coaching_sessions')
    .select('id, status, audio_url')
    .eq('user_id', userId)
    .in('audio_url', [...byUrl.keys()]);
  if (error) throw new Error(`saved-recording lookup failed: ${error.message}`);
  const out = new Map();
  for (const row of data || []) {
    const key = byUrl.get(row.audio_url);
    if (key && !out.has(key) && !NOT_ANALYSED.includes(row.status)) out.set(key, { id: row.id, status: row.status });
  }
  return out;
}

/**
 * Her DC observations over these bytes that reached analysis (or are on their way): sha256 → the newest.
 * Her own only, never an observation (observation_type null) — the backstop's rule, but any state past "never ran",
 * so a recording still being analysed is "sent before" too.
 */
async function sentBefore(d, userId, shas) {
  const wanted = [...new Set(shas.filter((s) => SHA_RX.test(s)))];
  if (!wanted.length) return new Map();
  const { data, error } = await d.supabase
    .from('coaching_sessions')
    .select('id, status, created_at, audio_hash')
    .eq('user_id', userId)
    .in('audio_hash', wanted)
    .is('observation_type', null)
    .not('status', 'in', `(${NOT_ANALYSED.join(',')})`)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`sent-before lookup failed: ${error.message}`);
  const out = new Map();
  for (const row of data || []) {
    if (!out.has(row.audio_hash)) {
      out.set(row.audio_hash, { sessionId: row.id, date: row.created_at, ready: row.status === 'completed' });
    }
  }
  return out;
}

/**
 * Keep a classroom recording that came in on WhatsApp, for the app.
 *
 * @param {{userId, buffer: Buffer, mimeType?, filename?, seconds?, door: 'voice'|'document'}} args
 * @returns {Promise<{status:'saved', key, sha256} | {status:'waiting', key, sha256}
 *   | {status:'repeat', sessionId, sha256} | {status:'invalid', reason}>}  Throws when R2 or the database fails.
 */
async function keepRecording({ userId, buffer, mimeType = null, filename = null, seconds = null, door = null }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { status: 'invalid', reason: 'no_audio' };
  const { KINDS, buildUploadKey } = portal();
  const ext = audioExtFor({ filename, mimeType });
  if (!ext) return { status: 'invalid', reason: 'not_audio' };
  if (buffer.length > KINDS.audio.maxBytes) return { status: 'invalid', reason: 'too_large' };

  const d = withDefaults(deps);
  const sha256 = d.hashCache.computeAudioHash(buffer);

  // Analysed before: the backstop would only hand her the old report, so nothing is kept.
  const prior = await d.hashCache.findRecentDuplicateSession(d.supabase, { userId, audioHash: sha256 });
  if (prior) return { status: 'repeat', sessionId: prior.id, sha256 };

  // Saved before: sent from the app already (a repeat), or still waiting (keep the one copy).
  const same = await listSaved(d, userId, sha256.slice(0, SHA_PREFIX));
  if (same.length) {
    const held = await sessionsHolding(d, userId, same.map((o) => o.key));
    const sent = same.find((o) => held.has(o.key));
    if (sent) return { status: 'repeat', sessionId: held.get(sent.key).id, sha256 };
    const nowMs = d.now().getTime();
    const waiting = same.find((o) => !held.has(o.key) && nowMs - timeOf(o.lastModified) < PENDING_MS);
    if (waiting) return { status: 'waiting', key: waiting.key, sha256 };
  }

  const now = d.now();
  const key = buildUploadKey(userId, ext, now, `wa-${sha256.slice(0, SHA_PREFIX)}-${d.newId()}`, 'audio');
  await d.r2.uploadBuffer(buffer, key, KINDS.audio.types[ext], {
    metadata: {
      sha256,
      duration: Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? String(Math.round(Number(seconds))) : '',
      door: door ? String(door) : '',
      receivedAt: now.toISOString(),
    },
  });
  return { status: 'saved', key, sha256 };
}

/**
 * Her saved WhatsApp recordings still waiting to be sent, newest first, one per recording (the same bytes twice is
 * one). Each with how long it is, when it came, a short-lived link to listen to it, and — when she has sent the same
 * bytes before — the DC observation it was.
 *
 * @returns {Promise<{status:'ok', recordings: Array<{key, id, seconds, receivedAt, listenUrl, duplicateOf}>}
 *   | {status:'invalid', reason}>}
 */
async function pendingRecordings({ userId }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const d = withDefaults(deps);
  const nowMs = d.now().getTime();
  const listed = (await listSaved(d, userId)).filter((o) => nowMs - timeOf(o.lastModified) < PENDING_MS);
  if (!listed.length) return { status: 'ok', recordings: [] };

  const held = await sessionsHolding(d, userId, listed.map((o) => o.key));
  const seen = new Set();
  const waiting = [];
  for (const o of listed) {
    const prefix = o.key.match(WA_KEY_RX)[1];
    if (held.has(o.key) || seen.has(prefix)) continue;
    seen.add(prefix);
    waiting.push(o);
    if (waiting.length >= MAX_PENDING) break;
  }

  const heads = await Promise.all(waiting.map((o) => d.r2.headObject(o.key).catch(() => null)));
  const items = waiting
    .map((o, i) => ({ o, head: heads[i] }))
    // Gone since the listing (or unreadable): not shown, rather than shown and refused at Submit.
    .filter(({ head }) => head && head.exists)
    .map(({ o, head }) => {
      const meta = head.metadata || {};
      const seconds = Number(meta.duration);
      return {
        key: o.key,
        sha256: SHA_RX.test(String(meta.sha256 || '')) ? meta.sha256 : null,
        seconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
        receivedAt: new Date(timeOf(o.lastModified)).toISOString(),
      };
    });

  const before = await sentBefore(d, userId, items.map((it) => it.sha256).filter(Boolean));
  const recordings = await Promise.all(items.map(async (it) => {
    let listenUrl = null;
    try { listenUrl = await d.r2.getPresignedGetUrl(it.key, LISTEN_TTL_SECONDS); } catch (_) { listenUrl = null; }
    const hit = it.sha256 ? before.get(it.sha256) : null;
    return {
      key: it.key,
      id: recordingIdOf(it.key),
      seconds: it.seconds,
      receivedAt: it.receivedAt,
      listenUrl,
      duplicateOf: hit ? { sessionId: hit.sessionId, date: hit.date, ready: hit.ready } : null,
    };
  }));
  return { status: 'ok', recordings };
}

/**
 * Has she sent these bytes before? The app asks before it uploads a file she picked (the browser hashes it).
 * @returns {Promise<{status:'ok', duplicateOf: null|{sessionId, date, ready}} | {status:'invalid', reason}>}
 */
async function checkDuplicate({ userId, sha256 }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const sha = String(sha256 || '').toLowerCase();
  if (!SHA_RX.test(sha)) return { status: 'invalid', reason: 'bad_hash' };
  const d = withDefaults(deps);
  const hit = (await sentBefore(d, userId, [sha])).get(sha);
  return { status: 'ok', duplicateOf: hit || null };
}

/**
 * The WhatsApp door's call, in place of redirectIfFlagged('ai_coaching', …): the same decision, and when the answer
 * is the app LINK, the recording is kept (keepRecording) before the link goes. Saved or already waiting → the link
 * opens the one screen with it attached; sent before → the link says so and opens Digital Coaching; anything that
 * goes wrong keeping it → today's link, never silence.
 *
 * @returns {Promise<boolean>} redirectIfFlagged's answer: true = handled, the caller returns
 */
async function redirectClassroomRecording({
  userId, from, language, reason, mediaId = null, buffer = null, mimeType = null, filename = null, seconds = null, door = null,
}, deps) {
  const d = withDefaults(deps);
  const bound = deps && Number.isFinite(deps.saveTimeoutMs) ? deps.saveTimeoutMs : SAVE_TIMEOUT_MS;
  const keep = async () => {
    const audio = buffer || await d.downloadMedia(mediaId);
    return { audio, kept: await keepRecording({ userId, buffer: audio, mimeType, filename, seconds, door }, deps) };
  };
  const onLink = async ({ journey } = {}) => {
    // Her keyed reference, never the raw id, on a log line (tests/setup/log-raw-ids); the journey id joins the funnel.
    const fx = { journeyId: (journey && journey.journeyId) || null, tk: d.tk(userId), door, seconds };
    let timer = null;
    try {
      // Bounded: a download or a put that never answers must not hold the link back — after the bound it goes plain.
      const outcome = await Promise.race([keep(), new Promise((resolve) => { timer = setTimeout(() => resolve(null), bound); })]);
      if (!outcome) {
        d.log('⚠️ WhatsApp recording not kept for the app in time — today\'s link goes', { ...fx, ms: bound }, 'warn');
        funnel(d, 'app_funnel.recording_save_failed', { ...fx, why: 'timeout' });
        return null;
      }
      const { audio, kept } = outcome;
      if (kept.status === 'saved' || kept.status === 'waiting') {
        funnel(d, 'app_funnel.recording_saved', { ...fx, how: kept.status === 'saved' ? 'new' : 'already_waiting', sizeBytes: audio.length });
        return { landing: SAVED_LANDING };
      }
      if (kept.status === 'repeat') {
        funnel(d, 'app_funnel.recording_duplicate', { ...fx, coachingSessionId: kept.sessionId });
        return { copy: REPEAT_COPY };
      }
      d.log('⚠️ WhatsApp recording not kept for the app — today\'s link goes', { ...fx, why: kept.reason }, 'warn');
      funnel(d, 'app_funnel.recording_save_failed', { ...fx, why: kept.reason });
      return null;
    } catch (err) {
      d.log('⚠️ WhatsApp recording could not be kept for the app — today\'s link goes', { ...fx, error: err && err.message }, 'warn');
      funnel(d, 'app_funnel.recording_save_failed', { ...fx, why: 'error' });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return d.redirect.redirectIfFlagged('ai_coaching', { userId, from, language, reason, onLink });
}

module.exports = {
  SAVE_TIMEOUT_MS,
  isWhatsAppKey, // dashboard portal.routes: a start that sends a kept recording
  pendingRecordings,
  checkDuplicate,
  redirectClassroomRecording,
  // For the tests only (the child-test services' __internals pattern).
  __internals: { keepRecording },
};
