/**
 * Reflective-question guardrails.
 *
 * Deterministic, language-aware validation of a generated question against the v6→v11 rules that
 * a model can still occasionally break: raw MM:SS, a "Q1/Q2" meta-leak, and — for a non-Latin-
 * script language read aloud by TTS — Roman transliteration or bare inline digits. PURE (no LLM,
 * no I/O), fully unit-testable. The RETRY + safe-fallback orchestration lives in the caller
 * (_generateReflectiveQuestionV12).
 *
 * Why language-aware: honorifics appear in Urdu script and Swahili, not only Latin. The
 * invented-name gate only inspects mid-sentence Latin-capitalized tokens (the STT-noise failure
 * mode) minus a subject-term stoplist. The script/digit gates fire only for non-Latin
 * languages, because Urdu/Arabic TTS engines mangle Roman text and bare digits.
 */

// Length guidance is now PROMPT-side (≤75 words). Kept + exported for any consumer that
// reads it; NOT enforced as a hard gate here (it over-fired on verbose Kiswahili/Urdu questions).
const WORD_LIMIT = 75;

const RAW_MMSS_RE = /(\[\d{1,2}:\d{2}\]|\b\d{1,2}:\d{2}\b)/;
const META_LEAK_RE = /\b(Q[123])\b|\bquestion\s+(one|two|three|1|2|3)\b|\bsawal\s+(no|number|nambar)\b/i;

/**
 * @param {string} question  the generated question in the teacher's language.
 * @param {object} corpus    reflective_corpus (for the allowed-name set).
 * @param {string} [firstName]  the teacher's first name (allowed to appear).
 * @param {object} [profile]   language profile — { script } enables the TTS script/digit gates.
 * @returns {string[]} violation codes; empty = clean.
 */
function validateQuestion(question, corpus = {}, firstName = '', profile = {}) {
  const v = [];
  const q = (question || '').trim();
  if (!q) return ['empty'];

  // The honorific / invented-name / over-65-words gates were REMOVED — they
  // false-positived on Kiswahili (the transcript labels teacher speech "Mwalimu:", so a verbatim
  // quote tripped `honorific`; capitalized Kiswahili/English content words tripped the English-only
  // invented-name stoplist; Kiswahili/Urdu verbosity tripped 65 words), dropping good v12 questions
  // to the generic safe-fallback. They are now PROMPT instructions (question-prompt.js: no-honorific,
  // name-skepticism, ≤75 words). We keep ONLY gates that are genuine defects with ~no false-positive
  // risk: raw MM:SS, a "Q1/Q2" meta-leak, and (non-Latin TTS language) Roman transliteration + digits.
  if (RAW_MMSS_RE.test(q)) v.push('raw_mmss');
  if (META_LEAK_RE.test(q)) v.push('meta_leak');

  // TTS gates for a non-Latin-script language (e.g. Urdu Nastaliq). These questions are
  // read aloud; Roman transliteration and bare inline digits both break the voice.
  if (profile.script && profile.script !== 'Latin') {
    if (_isRomanized(q)) v.push('roman_script');   // language written in Roman, not its own script
    if (/\d/.test(q)) v.push('inline_digit');       // bare digit -> "alaran" gibberish in TTS
  }

  return v;
}

/**
 * For a non-Latin-script language, flag a question that is mostly Latin letters — i.e. the language
 * was Roman-transliterated instead of written in its own script. NOT a length check. English
 * subject terms are legitimately Latin, so a genuine Nastaliq question (even with a few English
 * terms) stays well above the threshold; a fully-Roman-Urdu question falls far below it.
 */
function _isRomanized(q) {
  let latin = 0;
  let nativeScript = 0;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    const c = q.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++;       // A-Z a-z
    else if (c > 0x7F && /\p{L}/u.test(ch)) nativeScript++;            // non-ASCII letter (Nastaliq/Arabic/…)
  }
  const total = latin + nativeScript;
  if (total === 0) return false;
  return nativeScript / total < 0.4; // <40% native-script letters => Roman, not its own script
}

// _allowedNames / _containsInventedName were removed — the invented-name gate moved to the
// prompt's NAME-SKEPTICISM instruction (it false-positived on capitalized Kiswahili/English content
// words via an English-only stoplist).

// Curated, pre-validated fallbacks — used ONLY when both the first generation and the one retry
// fail validation (rare). Generic but always safe (gender-neutral, no name, no honorific, ≤65w).
const FALLBACKS = {
  ur: {
    1: 'اس سبق میں ایک لمحہ جب آپ کو محسوس ہوا کہ بچے واقعی سوچ رہے ہیں — اُس وقت آپ کے ذہن میں کیا آیا؟',
    2: 'جب کسی بچے نے کوئی جواب دیا جو آپ کی توقع سے مختلف تھا، تو آپ کے خیال میں وہ کیا سوچ رہا تھا؟',
    3: 'اگلی بار جب ایسا ہی لمحہ آئے، تو جواب دینے سے پہلے آپ خود سے سب سے پہلا سوال کیا پوچھنا چاہیں گی؟',
  },
  sw: {
    1: 'Katika somo hili, kulikuwa na wakati ulipohisi wanafunzi wanafikiri kweli — wakati huo, nini kilikuja akilini mwako?',
    2: 'Mwanafunzi alipotoa jibu lililokushangaza, unafikiri alikuwa anafikiria nini?',
    3: 'Wakati ujao hali kama hii itakapotokea, ni swali gani la kwanza ungejiuliza kabla ya kujibu?',
  },
  en: {
    1: 'There was a moment in this lesson when you felt the children were really thinking — what was going through your mind then?',
    2: 'When a child gave an answer that surprised you, what do you think they were thinking?',
    3: 'Next time a moment like that arises, what is the first question you would ask yourself before responding?',
  },
};

/**
 * @param {number} questionNumber 1|2|3
 * @param {object} corpus  (unused in the generic fallback, kept for signature symmetry/future use)
 * @param {object} profile language profile (uses the language code via profile match; default en)
 * @returns {string}
 */
function buildSafeFallback(questionNumber, corpus, profile = {}) {
  const lang = (profile.language || '').toLowerCase();
  const set = lang.includes('urdu') ? FALLBACKS.ur
    : (lang.includes('swahili') || lang.includes('kiswahili')) ? FALLBACKS.sw
      : FALLBACKS.en;
  return set[questionNumber] || set[1];
}

module.exports = { validateQuestion, buildSafeFallback, WORD_LIMIT };
