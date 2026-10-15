'use strict';
/**
 * The Trail page, v2 (app_settings `web_quiz_challenge_v2`, parent `web_quiz_challenge`): which v2 screens the
 * Challenge page may show, and the grown-up's "keep this reading?" answer.
 *
 *   bits()             → { v2: { pool, story, consent } } for the menu and exercise payloads, or {} when v2 is off
 *                        (the payload is then today's, byte for byte).
 *   consentFor(body)   → 'kept_ok' | 'kept_no' | 'not_asked' when `web_quiz_challenge_audio_consent` is on (with v2),
 *                        else null (today's rule: the keep switch alone decides).
 *   allowsKeep(c)      → may this reading be kept? null (switch off) → yes, as today; else only 'kept_ok'.
 *   columns(c)         → the run row's consent columns (audio_consent, _at, _by) or {} when the switch is off.
 *   writeConsent(r,c)  → writes them after the row is final, apart from it; a failure is logged, never thrown.
 *   noteConsent(run,c) → web_quiz.ch_audio_consent {run, v}, once per run.
 *
 * Switches read like web-quiz-hub-flags.js: app_settings, 30 s cache, fail CLOSED (a failed read is "off").
 * Every switch is effective only with its parent on: _pool, _story, _audio_consent need _v2; _v2 needs the Challenge.
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const KEYS = {
  challenge: 'web_quiz_challenge',
  v2: 'web_quiz_challenge_v2',
  pool: 'web_quiz_challenge_pool',
  story: 'web_quiz_challenge_story',
  consent: 'web_quiz_challenge_audio_consent',
  keep: 'web_quiz_challenge_keep_audio',
};
const TTL_MS = 30 * 1000;
const OFF = Object.freeze({ challenge: false, v2: false, pool: false, story: false, consent: false, keep: false });
let cache = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const raw = Object.fromEntries(Object.entries(KEYS).map(([k, key]) => [k, isTrue(by[key])]));
    const v2 = raw.challenge && raw.v2;
    cache = { at: now, challenge: raw.challenge, v2, pool: v2 && raw.pool, story: v2 && raw.story, consent: v2 && raw.consent, keep: raw.keep };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz trail v2: settings lookup failed — v2 off', { error: err.message });
    return OFF;
  }
}

/** What the page may show under v2; {} when v2 is off. `consent` = the keep screen is shown (needs the keep switch). */
async function bits() {
  const f = await flags();
  if (!f.v2) return {};
  return { v2: { pool: !!f.pool, story: !!f.story, consent: !!(f.consent && f.keep) } };
}

const CONSENT = new Set(['kept_ok', 'kept_no']);

/** The grown-up's answer as the row keeps it, or null when the consent switch is off (today's rule). */
async function consentFor(body = {}) {
  const f = await flags();
  if (!f.consent) return null;
  const v = body && body.audio_consent;
  return CONSENT.has(v) ? v : 'not_asked';
}

/** A kept key only with 'kept_ok'; null (switch off) keeps today's behaviour. */
const allowsKeep = (consent) => consent == null || consent === 'kept_ok';

/** The run row's consent columns (M1 adds them), only under the switch. */
const columns = (consent, now = new Date()) => (consent == null ? {} : { audio_consent: consent, audio_consent_at: now.toISOString(), audio_consent_by: 'grownup_tap' });

/**
 * The consent columns, written AFTER the run row is final and apart from it (M1 adds the columns): a failed write
 * (e.g. 42703, the column is not there yet) is logged and never touches the scored row. Never throws.
 */
async function writeConsent(runId, cols) {
  if (!runId || !cols || !Object.keys(cols).length) return false;
  try {
    const { error } = await supabase.from('web_quiz_challenge_runs').update(cols).eq('id', runId);
    if (error) {
      const e = new Error(error.message || 'update failed');
      e.pgCode = error.code;
      throw e;
    }
    return true;
  } catch (err) {
    logError('web_quiz.ch_audio_consent_write_failed', { run: runId, code: (err && err.pgCode) || null, error: String((err && err.message) || err).slice(0, 120) });
    return false;
  }
}

const noted = new Set();
function noteConsent(runId, consent) {
  if (consent == null || !runId || noted.has(runId)) return;
  noted.add(runId);
  if (noted.size > 5000) noted.clear();
  logEvent('web_quiz.ch_audio_consent', { run: runId, v: consent });
}

module.exports = { flags, bits, consentFor, allowsKeep, columns, writeConsent, noteConsent, KEYS, _reset: () => { cache = null; noted.clear(); } };
