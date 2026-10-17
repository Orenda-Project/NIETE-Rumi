'use strict';
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
  ur: Object.freeze({ provider: 'elevenlabs', voice: 'XKV307Y3BonMEUh5pCNM', name: 'Sana', model: 'eleven_v4', settings: ONE_SETTINGS }),
});

const PROVIDER_TAG = Object.freeze({ soniox: 'sx', elevenlabs: 'el', openai: 'oa' });

function baseLang(language) {
  return String(language || '').trim().toLowerCase().split(/[-_]/)[0];
}

/** { provider, voice } for a quiz language (`oneVoice`: the one voice's, with its name, model and settings), or null. */
function quizVoice(language, { oneVoice = false } = {}) {
  return (oneVoice ? ONE_VOICE : QUIZ_VOICE)[baseLang(language)] || null;
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

/** The voice a tag names, in either table ({ provider, voice, … }), or null. */
function voiceOfTag(tag) {
  return [...Object.values(ONE_VOICE), ...Object.values(QUIZ_VOICE)].find((v) => tagOf(v) === tag) || null;
}

module.exports = { QUIZ_VOICE, ONE_VOICE, quizVoice, voiceTag, tagOf, voiceOfTag };
