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

const PROVIDER_TAG = Object.freeze({ soniox: 'sx', elevenlabs: 'el', openai: 'oa' });

function baseLang(language) {
  return String(language || '').trim().toLowerCase().split(/[-_]/)[0];
}

/** { provider, voice } for a quiz language, or null for a language with no quiz voice. */
function quizVoice(language) {
  return QUIZ_VOICE[baseLang(language)] || null;
}

/** Short, key-safe name of a voice: "sx-ishita". */
function tagOf({ provider, voice } = {}) {
  const p = PROVIDER_TAG[provider] || String(provider || 'x').slice(0, 2);
  return `${p}-${String(voice || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

/** The voice tag of a quiz language ("sx-grace"), or "default" when it has no quiz voice. */
function voiceTag(language) {
  const v = quizVoice(language);
  return v ? tagOf(v) : 'default';
}

module.exports = { QUIZ_VOICE, quizVoice, voiceTag, tagOf };
