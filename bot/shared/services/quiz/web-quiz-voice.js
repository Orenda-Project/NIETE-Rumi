'use strict';
const crypto = require('crypto');
/**
 * The ONE voice a child hears in a web quiz, per language.
 *
 * Every spoken line of a quiz uses it: the shared feedback lines recorded once
 * (dashboard/public/wq/voice/, whose manifest.json names the voice it was recorded
 * in) and every per-quiz clip the publish step records (question, options, why,
 * wrong-option feedback, hint). Change it here and both must be re-recorded: the
 * voice tag is part of every per-quiz clip key, and a test holds the manifest to
 * this table.
 *
 * Soniox for both languages (blind listening bake-off, Oct 2026): it won Urdu and
 * is the bot's own voice; in English it is about a tenth of the per-quiz cost of
 * the voice that won by ear, and one voice beats two good ones in one sentence.
 *
 * No requires: the portal's tests load this file from the bot folder.
 */

const QUIZ_VOICE = Object.freeze({
  ur: Object.freeze({ provider: 'soniox', voice: 'Ishita' }),
  en: Object.freeze({ provider: 'soniox', voice: 'Grace' }),
});

// With app_settings web_quiz_one_voice on (web-quiz-one-voice-flag.js), the ONE voice of the whole child app per
// language: every quiz line (question, options, why, wrong-answer lines, hint, the bank's own items), Jugnu's
// shared lines (dashboard/public/wq/voice/one/, its manifest names this table) and the challenge's clips, the same
// voice as the storybook and passage voice-overs (the voice pick of Oct 2026: ElevenLabs v4, one call per line at
// the voice's natural speed, its own bytes kept). A new pick is one id per language here; its tag changes, so every
// clip is recorded again in it. `name` is the tag (readable keys); `voice` is the provider's voice id.
const ONE_SETTINGS = Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true });
const ONE_VOICE = Object.freeze({
  en: Object.freeze({ provider: 'elevenlabs', voice: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', model: 'eleven_v4', settings: ONE_SETTINGS }),
  ur: Object.freeze({ provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', name: 'Sara', model: 'eleven_v4', settings: ONE_SETTINGS }),
});

const PROVIDER_TAG = Object.freeze({ soniox: 'sx', elevenlabs: 'el', openai: 'oa' });

function baseLang(language) {
  return String(language || '').trim().toLowerCase().split(/[-_]/)[0];
}

// How a voice is rendered (its model and settings, keys sorted), short: part of a plan's stamp, a clip's key and a
// shared-line set's name.
function renderOf(voice) {
  const v = voice || {};
  const settings = v.settings && typeof v.settings === 'object'
    ? Object.keys(v.settings).sort().reduce((o, k) => ({ ...o, [k]: v.settings[k] }), {}) : null;
  return crypto.createHash('sha1').update(JSON.stringify([v.model || null, settings])).digest('hex').slice(0, 6);
}
const ONE_RENDER = renderOf({ model: 'eleven_v4', settings: ONE_SETTINGS });

/**
 * The name of ONE rendering of a voice: its tag ("el-bella"), plus its rendering ("el-bella-cff2e4") when that is not
 * the one voice's v4 default. A one-voice clip's key, its quiz's stamp and Jugnu's shared-line set all carry it, so the
 * same voice id on another model or speed is another voice everywhere (the voice-mix alarm too). Key-safe.
 */
function setIdOf(voice) {
  const tag = tagOf(voice || {});
  const r = renderOf(voice);
  return r === ONE_RENDER ? tag : `${tag}-${r}`;
}

// Jugnu's shared lines recorded in a one voice (dashboard/public/wq/voice/one/<set>/, a manifest beside them): the
// set (setIdOf) → the hash of its files (a test holds it), so a page can ask for the set of the plan's voice as the
// plan renders it. A plan voice with no set here has no shared-line audio: the page shows those lines.
const SHARED_SETS = Object.freeze({
  'el-bella': '365969a7', 'el-sana': '76bc9453', 'el-sara': 'f2d8d2ef',
  'el-bella-cff2e4': '3a274a11', // Bella on eleven_multilingual_v2 at speed 0.9 (the storyteller pace of the passages)
  // Urdu Reva (eleven_v4), matched to the bank's recordings of people, each line levelled to -21 LUFS.
  'el-reva-cc0c3b': 'cbfa2478',
  // English Shanaya (eleven_v4, stability 0.75), matched to the bank's recordings of people, levelled to -21 LUFS.
  'el-shanaya-e228e6': '4da1fca4',
  // English Anjura (same rendering), for the quizzes whose recordings are nearer it (a plan's quiz_voices).
  'el-anjura-e228e6': 'cb014e5e',
});

// The voice each recorded set was recorded in, for a plan that names a set by its name alone (`quiz_voices`):
// the set's name (setIdOf) → its voice, as the set's manifest names it (a test holds both).
const SET_VOICES = Object.freeze({
  'el-bella-cff2e4': Object.freeze({ ...ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: Object.freeze({ ...ONE_SETTINGS, speed: 0.9 }) }),
  'el-reva-cc0c3b': Object.freeze({ provider: 'elevenlabs', voice: 'o85TqPN3F4P7dWae2paA', name: 'Reva', model: 'eleven_v4',
    settings: Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 }) }),
  'el-shanaya-e228e6': Object.freeze({ provider: 'elevenlabs', voice: 'ZeK6O9RfGNGj0cJT2HoJ', name: 'Shanaya', model: 'eleven_v4',
    settings: Object.freeze({ stability: 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 }) }),
  'el-anjura-e228e6': Object.freeze({ provider: 'elevenlabs', voice: 'a6XidOEnTywSiWFoBUhm', name: 'Anjura', model: 'eleven_v4',
    settings: Object.freeze({ stability: 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 }) }),
});

/**
 * { provider, voice } for a quiz language, or null. `oneVoice`: true (ONE_VOICE) or a plan (web-quiz-one-voice-flag.js:
 * its voice for the language), with the voice's name, model and settings.
 */
function quizVoice(language, { oneVoice = false } = {}) {
  const lang = baseLang(language);
  if (!oneVoice) return QUIZ_VOICE[lang] || null;
  // A language the plan leaves out (its voice null) keeps today's quiz voice.
  if (typeof oneVoice === 'object' && oneVoice.voices && oneVoice.voices[lang] === null) return QUIZ_VOICE[lang] || null;
  return (typeof oneVoice === 'object' && oneVoice.voices && oneVoice.voices[lang]) || ONE_VOICE[lang] || null;
}

/** Short, key-safe name of a voice: "sx-ishita", "el-bella". */
function tagOf({ provider, voice, name } = {}) {
  const p = PROVIDER_TAG[provider] || String(provider || 'x').slice(0, 2);
  return `${p}-${String(name || voice || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

/** The voice tag of a quiz language ("sx-grace"; `oneVoice`: "el-bella"), or "default" when it has no quiz voice. */
function voiceTag(language, opts) {
  const v = quizVoice(language, opts);
  return v ? tagOf(v) : 'default';
}

/** The voice a tag or a rendering's name (setIdOf) names ({ provider, voice, … }): in `plan`'s voices, else either table; or null. */
function voiceOfTag(tag, plan) {
  const planVoices = plan && typeof plan === 'object' && plan.voices ? Object.values(plan.voices) : [];
  const all = [...planVoices, ...Object.values(ONE_VOICE), ...Object.values(QUIZ_VOICE), ...Object.values(SET_VOICES)].filter(Boolean);
  return all.find((v) => setIdOf(v) === tag) || all.find((v) => tagOf(v) === tag) || null;
}

// Words a voice misreads, spelled for the voice only: the page shows the words as the quiz wrote them. Per language,
// each entry a whole `word`, what the voice is given (`say`), and `near`: another whole word the line must hold, for a
// word that is two words without vowel marks (the line then says which one it is).
// - میلا is mela (a fair) and maila (dirty); میلہ is only ever mela. Next to کیلا (kela, the rhyme) it is the fair.
const SAY_AS = Object.freeze({
  ur: Object.freeze([
    Object.freeze({ word: 'میلا', say: 'میلہ', near: 'کیلا' }),
  ]),
});

// A whole word: no letter, vowel mark or digit touching it on either side (Urdu has no \b).
const wholeWord = (w) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${w}(?![\\p{L}\\p{M}\\p{N}])`, 'gu');

/** The words a one-voice clip's voice is given for `text` in `language`: SAY_AS applied. */
function sayAs(text, language) {
  let out = text == null ? '' : String(text);
  (SAY_AS[baseLang(language)] || []).forEach(({ word, say, near }) => {
    if (near && !wholeWord(near).test(out)) return;
    out = out.replace(wholeWord(word), say);
  });
  return out;
}

/** The shared-line sets for a plan, per language: { en: { path, v }, ur: { path, v } } (a language with no set left out). */
function sharedSets(plan) {
  const out = {};
  ['en', 'ur'].forEach((lang) => {
    if (plan && typeof plan === 'object' && plan.voices && plan.voices[lang] === null) return;   // today's voice, today's lines
    const id = setIdOf(quizVoice(lang, { oneVoice: plan || true }));
    if (SHARED_SETS[id]) out[lang] = { path: id, v: SHARED_SETS[id] };
  });
  return out;
}

module.exports = { QUIZ_VOICE, ONE_VOICE, SHARED_SETS, SET_VOICES, SAY_AS, sayAs, quizVoice, voiceTag, tagOf, renderOf, setIdOf, voiceOfTag, sharedSets };
