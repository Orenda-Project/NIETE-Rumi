/**
 * bd-2651 — shared language rules for ANY text that will be spoken aloud by TTS.
 *
 * Root cause of the Maria-Karim "Hindi–Urdu mix" (ICT DC, 3 Aug 2026): the coaching
 * voice-debrief + general-voice prompts told the model "natural Urdu" but never
 *   (a) pinned the script to Urdu Nastaliq,
 *   (b) forbade Hindi/Sanskrit-origin vocabulary, or
 *   (c) kept genuine English terms in Latin script
 * — and our Urdu voice (Sara / eleven_v3) is ElevenLabs' "Warm Storyteller — Urdu &
 * Hindi", trained on BOTH, so on ambiguous/Hindi-leaning text she tips into Hindi
 * phonology. The debrief prompt even said "avoid English jargon", which pushed the
 * model to TRANSLITERATE English terms — the opposite of what the voice needs.
 *
 * This encodes the lp-voicenotes V20 lessons (§2 prompt-language-drives-phonology,
 * §6 recurring-phrases-in-Nastaliq) in ONE place so every voice surface — debrief,
 * reflective question, acknowledgement, general chat, reading feedback, video — shares
 * the same rules. Pure + dependency-free → unit-testable.
 *
 * Voice selection itself is unchanged and correct: ur → Sara, en → Jessica (pure
 * English). These rules make the TEXT match the voice.
 */

const URDU_VOICE_RULES = `URDU-FOR-VOICE RULES (this text is spoken aloud by an Urdu voice — follow exactly):
- SCRIPT: write ALL Urdu in Urdu Nastaliq script (اردو). NEVER Roman-Urdu ("aaj" → write "آج"), NEVER Devanagari.
- PURE URDU VOCABULARY, NOT HINDI: use everyday Urdu rooted in Persian/Arabic — NEVER Hindi/Sanskrit-origin words. The voice reads Hindi words with a Hindi accent and teachers cannot follow it. Say the LEFT word, NEVER the right one:
    شکریہ (not دھنیہ واد) · فوراً (not ترنت) · سوال (not پرشن) · ضرورت (not آوشیکتا) · مشکل (not کٹھن) · کوشش (not پریاس) · مثال (not اُداہرن) · اُمید (not آشا) · طالبِ علم/بچے (not ودیارتھی) · استاد/ٹیچر (not ادھیاپک).
- ENGLISH TERMS STAY IN ENGLISH (Latin letters), inline: genuine English words — lesson plan, classroom, worksheet, activity, Grade 3, and pedagogy terms — stay written in English. NEVER transliterate them into Urdu script (never "گریڈ تھری" → write "Grade 3"). The voice handles inline English cleanly.
- NUMBERS: never write a bare digit inline (the voice garbles "43"/"8") — spell numbers as words.
- NO markdown (** or *) — the voice reads the asterisks aloud.`;

const ENGLISH_VOICE_RULES = `ENGLISH-FOR-VOICE RULES (this text is spoken aloud by an English voice):
- Respond ONLY in natural, simple English. Do NOT use any Urdu, Hindi, or transliteration — English words only.
- Warm, clear, conversational. NO markdown (** or *).`;

/**
 * Voice-safe language rules for a given language code. Injected into any prompt whose
 * output will be sent to TTS. Returns '' for languages that carry their own script/voice
 * rules elsewhere (sw/ar) so callers can always interpolate the result unconditionally.
 *
 * @param {string|null|undefined} languageCode  ISO code ('ur', 'en', 'sw', ...)
 * @returns {string}
 */
function voiceLanguageRules(languageCode) {
  const base = String(languageCode || 'en').slice(0, 2).toLowerCase();
  if (base === 'ur') return URDU_VOICE_RULES;
  if (base === 'en') return ENGLISH_VOICE_RULES;
  return '';
}

module.exports = { URDU_VOICE_RULES, ENGLISH_VOICE_RULES, voiceLanguageRules };
