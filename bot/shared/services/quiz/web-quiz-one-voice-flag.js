'use strict';
/**
 * One voice per quiz: app_settings `web_quiz_one_voice` (default off). Its value is the voice PLAN, data:
 *
 *   true                                  the bank's recordings of people keep the question and the options; every
 *                                         other spoken line is the one voice of web-quiz-voice.js ONE_VOICE
 *   { "voices": { "en": { "provider": "elevenlabs", "voice": "<id>", "name": "Bella", "model": "eleven_v4",
 *                         "settings": { "stability": 0.5, ... } },
 *                 "ur": { ... } },        the voice per language: a language left out keeps today's quiz voice and
 *                                         today's shared lines (its quizzes are as with the switch off); a language
 *                                         named with an invalid voice, or a plan naming no voices, takes ONE_VOICE's
 *     "bank": ["q", "opts"],              the parts still served from the bank's own recordings of people (a subset
 *                                         of q, opts, why; default ["q", "opts"]). Only an explicit [] voices the
 *                                         recorded question and options again in the plan's voice
 *     "kbps": 32,                         the clip's rate, asked of the provider in the same generation (32 or 64,
 *                                         default 64): no second encode unless the plan names a loudness
 *     "loudness_lufs": -21,               optional: every clip the plan records is levelled to this loudness (LUFS,
 *                                         -31 to -10), one Opus encode at the plan's rate; part of the stamp and keys
 *     "quiz_voices": { "<quizId>": "el-reva-cc0c3b" | "keep" } }
 *                                         optional, quiz by quiz: a quiz named here is voiced in that recorded set's
 *                                         voice (web-quiz-voice.js SET_VOICES), or keeps today's ("keep"); a quiz not
 *                                         named takes its language's voice above. A set that is not recorded, or
 *                                         whose voice is not known, turns the whole plan off (refused and logged)
 *
 * A plan is live only when every language it voices (as the plan renders it, web-quiz-voice.js setIdOf) has a
 * recorded set of Jugnu's shared lines (web-quiz-voice.js SHARED_SETS): the page would show those lines silent
 * otherwise. A plan without one reads as off, and the refusal is logged. The tools given a plan directly (the
 * backfill's --plan, the missing-keys check) are not refused: they record before the flip.
 *
 * A voice's `settings` are the provider's own (ElevenLabs: stability, …, `speed` for a slower delivery). The stamp
 * (`sig`) names every voice's tag, model and settings, the bank parts and the rate, so a change to any of them
 * records the quiz again.
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
 * Off: an absent row, `false`, an object whose `enabled` is there and is not the JSON `true` (`{ "enabled": false }`,
 * `{ "enabled": "false" }`), an object that names no valid `voices`, `bank` or `kbps` (`{}`, `{ "enabled": true }`), a
 * string (the JSON string "true" too), any other value and a failed read. 30 s cache. The quiz page reads it in its own
 * settings read (web-quiz-identity-roster.js, `take`), so the switch costs the page no read.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const Voice = require('./web-quiz-voice');

const KEY = 'web_quiz_one_voice';
const TTL_MS = 30 * 1000;
const BANK_PARTS = Object.freeze(['q', 'opts', 'why']);
const PROVIDERS = Object.freeze(['elevenlabs', 'soniox']);
const KBPS = Object.freeze([32, 64]);
const DEFAULT_KBPS = 64;
// The parts a plan keeps from the bank's recordings of people when it names none: the question and the options.
const DEFAULT_BANK = Object.freeze(['q', 'opts']);
let cache = null; // { at, plan }
let pinned; // a read-only tool's plan (pin): every reader in the process sees it, the switch is never read


const validVoice = (raw) => Boolean(raw) && typeof raw === 'object' && PROVIDERS.includes(raw.provider) && typeof raw.voice === 'string' && Boolean(raw.voice.trim());

function voiceOf(raw, lang) {
  const base = Voice.ONE_VOICE[lang];
  if (!validVoice(raw)) return base;
  const v = { provider: raw.provider, voice: raw.voice.trim(), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.voice.trim() };
  if (raw.provider === 'elevenlabs') {
    v.model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : base.model;
    v.settings = raw.settings && typeof raw.settings === 'object' ? { ...raw.settings } : base.settings;
  }
  return Object.freeze(v);
}

/** The plan a switch value names, or null (off). A string (the JSON string "true" too) is off, as for every switch. Pure. */
function normalize(value) {
  const v = value;
  if (v === true) return withSig({ voices: { en: Voice.ONE_VOICE.en, ur: Voice.ONE_VOICE.ur }, bank: [...DEFAULT_BANK], kbps: DEFAULT_KBPS });
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  // `enabled`, when there, is read as the JSON `true` only (`"false"`, `0`, `null` are off).
  if ('enabled' in v && v.enabled !== true) return null;
  // An object is a plan only when it names a valid `voices` (a language with a provider and a voice), `bank` (a list)
  // or `kbps` (32 or 64): `{}`, `{ enabled: true }` or a stray row is off, never the default plan.
  const hasVoices = Boolean(v.voices) && typeof v.voices === 'object' && !Array.isArray(v.voices)
    && (validVoice(v.voices.en) || validVoice(v.voices.ur));
  const hasBank = Array.isArray(v.bank);
  const hasKbps = KBPS.includes(Number(v.kbps));
  const quizVoices = quizVoicesOf(v.quiz_voices);
  if (!hasVoices && !hasBank && !hasKbps && !quizVoices) return null;
  const voices = hasVoices ? v.voices : {};
  // A plan that names `voices` for some languages only: a language it leaves out keeps today's quiz voice (null).
  const voiceFor = (lang) => (hasVoices && !(lang in v.voices) ? null : voiceOf(voices[lang], lang));
  const bank = hasBank ? BANK_PARTS.filter((p) => v.bank.includes(p)) : [...DEFAULT_BANK];
  const kbps = hasKbps ? Number(v.kbps) : DEFAULT_KBPS;
  // The loudness every clip of the plan is levelled to (a number, LUFS, -31 to -10); absent, the provider's own level.
  const lufs = typeof v.loudness_lufs === 'number' && v.loudness_lufs >= -31 && v.loudness_lufs <= -10 ? v.loudness_lufs : null;
  return withSig({ voices: { en: voiceFor('en'), ur: voiceFor('ur') }, bank, kbps,
    ...(lufs === null ? {} : { loudness_lufs: lufs }), ...(quizVoices ? { quiz_voices: quizVoices } : {}) });
}

// `quiz_voices`: { "<quizId>": "<set name>" | "keep" }, the valid entries with keys sorted; null when not an object
// with at least one valid entry.
const SET_NAME = /^[a-z]{2}-[a-z0-9]+(?:-[0-9a-f]{6})?$/;
function quizVoicesOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ids = Object.keys(raw).sort()
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && typeof raw[id] === 'string' && (raw[id] === 'keep' || SET_NAME.test(raw[id])));
  return ids.length ? Object.freeze(ids.reduce((o, id) => ({ ...o, [id]: raw[id] }), {})) : null;
}

/**
 * The plan as it applies to ONE quiz in `lang`, or null: the quiz keeps today's voice (the switch is off for it).
 * `quiz_voices` first: a quiz mapped to a set is voiced in that set's voice, "keep" keeps today's. A quiz the map does
 * not name takes its language's voice: a language the plan leaves out keeps today's; `lang` unknown, the plan as it is.
 */
function forQuiz(p, quizId, lang = null) {
  if (!p) return null;
  const tag = p.quiz_voices && quizId ? p.quiz_voices[quizId] : undefined;
  if (tag === 'keep') return null;
  if (tag) {
    const voice = Voice.voiceOfTag(tag, p);
    return voice ? Object.freeze({ ...p, voices: Object.freeze({ en: voice, ur: voice }) }) : null;
  }
  const base = lang ? String(lang).trim().toLowerCase().split(/[-_]/)[0] : null;
  if (base && p.voices && p.voices[base] === null) return null;
  return p;
}

// How a voice is rendered (web-quiz-voice.js): part of the stamp and of a clip's key.
const { renderOf } = Voice;

// The plan's stamp: its voice per language (by tag, model and settings), its bank parts and its rate. A quiz recorded
// under another plan is recorded again; clips of an unchanged voice keep their keys, so only what changed is paid for.
function withSig(plan) {
  const voice = (lang) => (plan.voices[lang] === null ? null : [Voice.tagOf(plan.voices[lang]), renderOf(plan.voices[lang])]);
  const sig = crypto.createHash('sha1')
    .update(JSON.stringify({ en: voice('en'), ur: voice('ur'), bank: plan.bank, kbps: plan.kbps,
      ...(plan.loudness_lufs === undefined ? {} : { lufs: plan.loudness_lufs }),
      ...(plan.quiz_voices === undefined ? {} : { quiz_voices: plan.quiz_voices }) }))
    .digest('hex').slice(0, 10);
  return Object.freeze({ ...plan, sig });
}

// A plan the page can play: every language's voice has a recorded set of Jugnu's shared lines. Else null (off),
// logged once per plan.
const refused = new Set();
function live(p) {
  if (!p) return null;
  // Every language the plan voices (a language it leaves out keeps today's voice and today's lines), and every set a
  // quiz is mapped to: it must be a recorded set whose voice is known, or the whole plan is off (fail closed).
  const langs = ['en', 'ur'].filter((lang) => p.voices[lang] !== null)
    .map((lang) => Voice.setIdOf(Voice.quizVoice(lang, { oneVoice: p }))).filter((id) => !Voice.SHARED_SETS[id]);
  const mapped = Object.values(p.quiz_voices || {})
    .filter((t) => t !== 'keep' && !(Voice.SHARED_SETS[t] && Voice.voiceOfTag(t, p) && Voice.setIdOf(Voice.voiceOfTag(t, p)) === t));
  const missing = [...new Set([...langs, ...mapped])];
  if (!missing.length) return p;
  if (!refused.has(p.sig)) {
    refused.add(p.sig);
    logToFile('⚠️ web-quiz: one-voice plan has no recorded set of Jugnu\'s shared lines for its voice — the switch reads off', { sig: p.sig, missing });
  }
  return null;
}

/** → the plan when the switch is on, else null. `db`: a Supabase client (defaults to the bot's). Never throws. */
async function plan({ db, now = Date.now() } = {}) {
  if (pinned !== undefined) return pinned;
  if (cache && now - cache.at < TTL_MS) return cache.plan;
  try {
    const client = db || require('../../config/supabase');
    const { data, error } = await client.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    if (pinned !== undefined) return pinned;   // pinned while this read was in flight
    cache = { at: now, plan: data ? live(normalize(data.value)) : null };
    return cache.plan;
  } catch (err) {
    logToFile('⚠️ web-quiz: one-voice setting unreadable — the recorded clips play as before', { error: err && err.message });
    return null;
  }
}

/**
 * The plan a value another settings read already holds names (the quiz page's read, web-quiz-identity-roster.js), kept
 * as this module's reading for the TTL, so no reader in the process reads the switch again. `undefined` (no row) is off.
 */
function take(value, now = Date.now()) {
  if (pinned !== undefined) return pinned;
  cache = { at: now, plan: live(normalize(value)) };
  return cache.plan;
}

/** → true only when the switch names a plan. Never throws. */
async function on(opts) { return Boolean(await plan(opts)); }

/** The last reading, without asking (null before the first): for a caller that must name a clip's key at once. */
function currentPlan() { return pinned !== undefined ? pinned : (cache && cache.plan) || null; }
function current() { return Boolean(currentPlan()); }

// Reads the switch every TTL in the background, so currentPlan() is fresh in a process whose requests never ask
// (the challenge's clip keys). Never in tests: a test reads the switch itself.
let fresh = null;
function keepFresh() {
  if (fresh || process.env.NODE_ENV === 'test') return;
  const tick = () => plan({ now: Date.now() }).catch(() => null);
  tick();
  fresh = setInterval(tick, TTL_MS);
  if (fresh.unref) fresh.unref();
}

// A generated clip's voice is in its key: `<part>-<tag>[-<render6>]-<hash8>.ogg` (web-quiz-audio-store.js clipKey; the
// rendering's name, web-quiz-voice.js setIdOf).
const TAG_RX = /\/[a-z0-9]+-((?:sx|el|oa)-[a-z0-9]+(?:-[0-9a-f]{6})?)-[0-9a-f]{8}\.ogg(?:[?#]|$)/;

/**
 * The voices a served page carries, for the voice-mix alarm (web_quiz.voice_mix): the tags of its clips (every spoken
 * line, never the sound to identify) and of the shared-line set it plays, sorted. A clip that names no quiz voice is a
 * kept bank recording, which the plan expects, so it is not a voice of the mix. → { tags, mixed }. Pure.
 */
function mixOf(audio, { sharedTag = null } = {}) {
  const tags = new Set(sharedTag ? [sharedTag] : []);
  Object.values(audio || {}).forEach((a) => {
    if (!a || typeof a !== 'object') return;
    [a.q, ...(a.opts || []), a.why, ...(a.fbs || []), a.hint].forEach((u) => {
      const m = typeof u === 'string' ? TAG_RX.exec(u) : null;
      if (m) tags.add(m[1]);
    });
  });
  const sorted = [...tags].sort();
  return { tags: sorted, mixed: sorted.length > 1 };
}

/**
 * A tool only (scripts/quiz/one-voice-missing-keys.js, its check and --record-short): every reader in this process
 * sees `p` (a plan, or null = off) and the switch is never read again, so the keys it computes and the clips it
 * records are those of the plan it was given.
 */
function pin(p) { pinned = p || null; }

/** Tests only: forget the cached reading (and a pin). */
function reset() { cache = null; pinned = undefined; refused.clear(); }

module.exports = { on, plan, take, normalize, forQuiz, renderOf, mixOf, current, currentPlan, keepFresh, pin, reset, KEY, TTL_MS, BANK_PARTS, DEFAULT_BANK, KBPS };
