/**
 * Reflective-question language layer (principle-driven, future-proof).
 *
 * The reflective-question prompt body carries the cross-lingual PRINCIPLES that never change:
 *   • write in the teacher's everyday staff-room register (not bookish/classical/foreign-borrowed)
 *   • never require the teacher's gender — agree with a noun, not the addressee
 *   • keep subject terms (multiply, place value, proper nouns) in English/Latin for clean TTS
 *
 * This module carries only the thin per-language DATA those principles need: the language name,
 * its script, the region whose spoken register to match, and short hints (what to avoid, how gender
 * works, and how a moment's time is said — in the language's OWN script: a Roman example is copied
 * sound by sound, which is how Urdu corpora came to say «کریب» for «قریب», bd-gr4fy.5.13). Adding a new language is ONE entry here — zero change to prompt logic.
 *
 * Soniox already transcribes ur / sw / en / ar, so the profile is keyed by the same ISO codes the
 * transcriber emits. `ar` ships as a working stub ahead of the Arabic rollout.
 *
 * An unknown / null code must never crash question generation — `resolveProfile` returns a
 * principle-only fallback that still instructs gender-neutrality, so a brand-new transcriber
 * language degrades to "principles only" rather than an exception.
 */

const LANGUAGE_PROFILES = {
  ur: {
    language: 'Urdu',
    script: 'Nastaliq',
    region: 'Pakistan',
    avoid_hint: " Use everyday Urdu rooted in Persian/Arabic — NEVER Hindi/Sanskrit-origin words (say شکریہ not دھنیہ واد, فوراً not ترنت/turant, سوال not پرشن, ضرورت not آوشیکتا, کوشش not پریاس). Also avoid bookish words (taajub, muntakhab, markooz).",
    // bd-gr4fy.5.12: concrete, in Nastaliq. The abstract rule alone ("agree with a noun") left 152 of 164 Sonnet
    // and 166 of 230 DeepSeek questions in a gendered verb («چاہیں گے/گی»).
    gender_hint:
      'Urdu verbs show gender and we do not know hers, so NEVER put her in a verb: not «آزمانا چاہیں گے/گی»,'
      + ' not «سوچتے/سوچتی ہیں», not «چاہتے/چاہتی ہیں», not «کرتے/کرتی ہیں». Agree with a noun or use نے:'
      + ' «کون سا ایک چھوٹا قدم آزمانا مفید رہے گا؟», «آپ کا کیا خیال ہے؟», «آپ نے کیا محسوس کیا؟».',
    // The question's closing invitation, said without a gendered verb (question-prompt.js {forwardClose}).
    forward_close: '«…اور اگلی بار جب ویسا ہی لمحہ آئے، تو کون سا ایک چھوٹا قدم آزمانا مفید رہے گا؟»',
    time_anchor_hint: "'شروع میں' / 'قریب دس منٹ پر' / 'سبق کے آخر میں' — numbers as words",
  },
  sw: {
    language: 'Kiswahili',
    script: 'Latin',
    region: 'Tanzania',
    avoid_hint: '',
    gender_hint: 'Kiswahili is gender-neutral — write naturally.',
    time_anchor_hint: "'mwanzoni' / 'karibu dakika ya kumi' / 'mwishoni mwa somo'",
  },
  en: {
    language: 'English',
    script: 'Latin',
    region: '(English-medium)',
    avoid_hint: '',
    gender_hint: 'English 2nd-person is gender-neutral — write naturally.',
    time_anchor_hint: "'at the start' / 'around minute ten' / 'near the end of the lesson'",
  },
  ar: {
    language: 'Arabic',
    script: 'Arabic',
    region: '(Arabic-speaking)',
    avoid_hint: ' Avoid classical/Quranic register; use simple spoken MSA.',
    gender_hint:
      "Arabic is gendered: undiacritized PAST-tense reads as neutral, but FUTURE/imperfect is NOT — restructure to a noun ('ما هي الخطوة الأولى' not 'ماذا ستفعل').",
    time_anchor_hint: "'في البداية' / 'حوالي الدقيقة العاشرة' / 'في نهاية الدرس'",
  },
};

/**
 * Resolve a transcript/preference language code to a profile.
 * Resolution order at the call site: coaching_sessions.transcript_language →
 * users.preferred_language → region default → 'en'. This fn just maps a final code → profile,
 * with a principle-only fallback for any code we don't ship yet.
 *
 * @param {string|null|undefined} code  ISO language code (e.g. 'ur', 'sw').
 * @returns {{language:string, script:string, region:string, avoid_hint:string, gender_hint:string, time_anchor_hint:string, forward_close?:string}}
 */
function resolveProfile(code) {
  if (code && LANGUAGE_PROFILES[code]) return LANGUAGE_PROFILES[code];
  return {
    language: code || 'English',
    script: 'Latin',
    region: '',
    avoid_hint: '',
    gender_hint: 'Use a gender-neutral construction native to this language.',
    time_anchor_hint: "a short natural phrase in this language and its own script ('at the start', 'around minute ten', 'near the end')",
  };
}

module.exports = { LANGUAGE_PROFILES, resolveProfile };
