'use strict';
/**
 * One voice per quiz: app_settings `web_quiz_one_voice` (default off). Its value is the voice PLAN, data:
 *
 *   true                                  every spoken line in the one voice of web-quiz-voice.js ONE_VOICE
 *   { "voices": { "en": { "provider": "elevenlabs", "voice": "<id>", "name": "Bella", "model": "eleven_v4" },
 *                 "ur": { ... } },        the voice per language (a language left out, or invalid, takes ONE_VOICE's)
 *     "bank": ["q", "opts", "why"] }      the parts still served from the bank's own recordings of people
 *                                         (a subset; default none): every other line is the plan's voice
 *
 * A library (video-bank) quiz carries the bank's own recordings of people for its questions and, for some, its
 * options and explanation; every other line of the quiz is the quiz voice (web-quiz-voice.js). Served together, a
 * child hears the voice change inside one question. On, the plan decides: the parts not in `bank` are neither
 * served from the recording (web-quiz-sound.js) nor skipped at publish (web-quiz-publish.service.js), a quiz
 * recorded under another plan is recorded again (its stamp is the plan's `sig`), the page shows a line with no
 * clip instead of reading it with the phone's own voice and plays Jugnu's shared lines in the plan's voice (wq.js,
 * boot `one_voice`, `voice_sets`). A listen item's sound to identify (`stim`) is the question's material and is
 * always the recording.
 *
 * Off: an absent row, `false`, `{ "enabled": false }`, any other value and a failed read. 30 s cache.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const Voice = require('./web-quiz-voice');

const KEY = 'web_quiz_one_voice';
const TTL_MS = 30 * 1000;
const BANK_PARTS = Object.freeze(['q', 'opts', 'why']);
const PROVIDERS = Object.freeze(['elevenlabs', 'soniox']);
let cache = null; // { at, plan }

function parse(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  return v;
}

function voiceOf(raw, lang) {
  const base = Voice.ONE_VOICE[lang];
  if (!raw || typeof raw !== 'object' || !PROVIDERS.includes(raw.provider) || typeof raw.voice !== 'string' || !raw.voice.trim()) return base;
  const v = { provider: raw.provider, voice: raw.voice.trim(), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.voice.trim() };
  if (raw.provider === 'elevenlabs') {
    v.model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : base.model;
    v.settings = raw.settings && typeof raw.settings === 'object' ? { ...raw.settings } : base.settings;
  }
  return Object.freeze(v);
}

/** The plan a switch value names, or null (off). Pure. */
function normalize(value) {
  const v = parse(value);
  if (v === true) return withSig({ voices: { en: Voice.ONE_VOICE.en, ur: Voice.ONE_VOICE.ur }, bank: [] });
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.enabled === false) return null;
  const voices = v.voices && typeof v.voices === 'object' ? v.voices : {};
  const bank = Array.isArray(v.bank) ? BANK_PARTS.filter((p) => v.bank.includes(p)) : [];
  return withSig({ voices: { en: voiceOf(voices.en, 'en'), ur: voiceOf(voices.ur, 'ur') }, bank });
}

// The plan's stamp: its voice per language (by tag) and its bank parts. A quiz recorded under another plan is
// recorded again; clips of an unchanged voice keep their keys, so only what changed is paid for.
function withSig(plan) {
  const sig = crypto.createHash('sha1')
    .update(JSON.stringify({ en: Voice.tagOf(plan.voices.en), ur: Voice.tagOf(plan.voices.ur), bank: plan.bank }))
    .digest('hex').slice(0, 10);
  return Object.freeze({ ...plan, sig });
}

/** → the plan when the switch is on, else null. `db`: a Supabase client (defaults to the bot's). Never throws. */
async function plan({ db, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.plan;
  try {
    const client = db || require('../../config/supabase');
    const { data, error } = await client.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, plan: data ? normalize(data.value) : null };
    return cache.plan;
  } catch (err) {
    logToFile('⚠️ web-quiz: one-voice setting unreadable — the recorded clips play as before', { error: err && err.message });
    return null;
  }
}

/** → true only when the switch names a plan. Never throws. */
async function on(opts) { return Boolean(await plan(opts)); }

/** The last reading, without asking (null before the first): for a caller that must name a clip's key at once. */
function currentPlan() { return (cache && cache.plan) || null; }
function current() { return Boolean(currentPlan()); }

// Reads the switch every TTL in the background, so currentPlan() is fresh in a process whose requests never ask
// (the challenge's clip keys). Never in tests: a test reads the switch itself.
let fresh = null;
function keepFresh() {
  if (fresh || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
  const tick = () => plan({ now: Date.now() }).catch(() => null);
  tick();
  fresh = setInterval(tick, TTL_MS);
  if (fresh.unref) fresh.unref();
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, plan, normalize, current, currentPlan, keepFresh, reset, KEY, TTL_MS, BANK_PARTS };
