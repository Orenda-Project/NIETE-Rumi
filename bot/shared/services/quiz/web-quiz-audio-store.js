'use strict';
/**
 * Where a web quiz's read-aloud clips live, what they are called, and whether
 * recording is allowed right now.
 *
 * BUCKET — one config point: WEB_QUIZ_AUDIO_BUCKET, else R2_BUCKET_NAME (unset =
 * exactly the behaviour before it existed). It is an environment variable, not an
 * app_settings row, because the bucket must match the R2 credentials of the
 * service that writes it. Set it on every service that records or signs quiz
 * audio (bot + sqs-worker). The bucket a quiz was recorded into is stored with
 * its keys (quizzes.meta.web.audio_bucket), so a quiz recorded before a switch
 * keeps playing after it.
 *
 * KEYS — one clip, one readable name, new words or a new voice = a new name:
 *
 *   quiz-audio/<env>/<quizId>/<lang>/<questionId>/<part>-<voiceTag>-<hash8>.ogg
 *     env       the Railway environment (sandbox | staging | production)
 *     part      q | a..d | why | xa..xd | hint
 *     voiceTag  web-quiz-voice.js ("sx-ishita")
 *     hash8     sha256 of language, voice, words and stored format
 *
 * Keys under LEGACY_PREFIX ("web-quiz/audio/…") were recorded before this scheme,
 * into R2_BUCKET_NAME; they stay there.
 *
 * BUDGET — app_settings, read per publish (cached briefly), failing OPEN:
 *   web_quiz_audio_enabled    false → nothing is recorded (the page shows the words big)
 *   web_quiz_audio_daily_cap  quizzes recorded per day (Pakistan day), default DEFAULT_DAILY_CAP
 * A settings read error records anyway and logs at error: a child without a voice
 * costs more than a few cents, and the cap still bounds the day.
 */

const crypto = require('crypto');

const PREFIX = 'quiz-audio';
const LEGACY_PREFIX = 'web-quiz/audio/';
const ENABLED_KEY = 'web_quiz_audio_enabled';
const CAP_KEY = 'web_quiz_audio_daily_cap';
const DEFAULT_DAILY_CAP = 1500;
const SETTINGS_CACHE_MS = 60 * 1000;

/** The bucket new quiz clips are recorded into. */
function quizAudioBucket(env = process.env) {
  return String(env.WEB_QUIZ_AUDIO_BUCKET || '').trim() || env.R2_BUCKET_NAME || null;
}

/** The deployment's name for keys: Railway's environment name, else NODE_ENV, else "dev". */
function deployEnv(env = process.env) {
  const raw = env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'dev';
  return String(raw).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'dev';
}

const safe = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 64) || 'x';

function clipKey({ env = deployEnv(), quizId, lang, qid, part, voice, text, format = '' }) {
  const h = crypto.createHash('sha256').update(`${lang || ''}\n${voice || ''}\n${text || ''}\n${format}`).digest('hex').slice(0, 8);
  return `${PREFIX}/${safe(env)}/${safe(quizId)}/${safe(lang || 'xx')}/${safe(qid)}/${safe(part)}-${safe(voice)}-${h}.ogg`;
}

/** The bucket a stored key is in: legacy keys in the default bucket, the rest where the quiz says. */
function bucketForKey(key, meta, env = process.env) {
  if (String(key || '').startsWith(LEGACY_PREFIX)) return env.R2_BUCKET_NAME || null;
  const web = (meta && meta.web) || {};
  return (typeof web.audio_bucket === 'string' && web.audio_bucket) || quizAudioBucket(env);
}

/** Today's date in Pakistan (UTC+5), the day the cap counts. */
function pkDay(now = Date.now()) {
  return new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

let settingsCache = null; // { at, enabled, cap }

function parseSetting(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return value; } }
  return value;
}

async function readSetting(db, key) {
  const { data, error } = await db.from('app_settings').select('key, value').eq('key', key).maybeSingle();
  if (error) throw Object.assign(new Error(error.message || 'app_settings read failed'), { cause: error });
  return data && data.key === key ? parseSetting(data.value) : undefined;
}

/**
 * May this quiz be recorded now?
 * @returns {Promise<{ok: true, day: string} | {ok: false, reason: 'disabled'|'capped', cap?: number, recordedToday?: number}>}
 */
async function recordingAllowed({ db, quizId, logEvent, logError, now = Date.now() }) {
  const day = pkDay(now);
  let enabled = true;
  let cap = DEFAULT_DAILY_CAP;
  try {
    if (settingsCache && settingsCache.db === db && now - settingsCache.at < SETTINGS_CACHE_MS) {
      ({ enabled, cap } = settingsCache);
    } else {
      const [e, c] = await Promise.all([readSetting(db, ENABLED_KEY), readSetting(db, CAP_KEY)]);
      enabled = !(e === false || String(e).trim().toLowerCase() === 'false');
      const n = Number(c);
      cap = c !== undefined && c !== null && Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
      settingsCache = { db, at: now, enabled, cap };
    }
  } catch (error) {
    logError('web_quiz_audio.settings_failed', { event: 'web_quiz_audio.settings_failed', quizId, error: String(error.message || error).slice(0, 200) });
    return { ok: true, day };
  }
  if (!enabled) return { ok: false, reason: 'disabled' };
  let recordedToday = 0;
  try {
    const { count, error } = await db.from('quizzes').select('id', { count: 'exact', head: true }).eq('meta->web->>audio_day', day);
    if (error) throw new Error(error.message || 'count failed');
    recordedToday = Number(count) || 0;
  } catch (error) {
    logError('web_quiz_audio.settings_failed', { event: 'web_quiz_audio.settings_failed', quizId, error: String(error.message || error).slice(0, 200) });
    return { ok: true, day };
  }
  if (recordedToday >= cap) {
    logEvent('web_quiz_audio.capped', { quizId, cap, recordedToday, day });
    return { ok: false, reason: 'capped', cap, recordedToday };
  }
  return { ok: true, day };
}

function resetSettingsCache() { settingsCache = null; }

module.exports = {
  PREFIX, LEGACY_PREFIX, ENABLED_KEY, CAP_KEY, DEFAULT_DAILY_CAP,
  quizAudioBucket, deployEnv, clipKey, bucketForKey, pkDay, recordingAllowed, resetSettingsCache,
};
