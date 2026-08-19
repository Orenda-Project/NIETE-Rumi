/**
 * bd-bfy69 — nothing we render may be in Devanagari.
 *
 * WHY THIS EXISTS
 * Urdu and Hindi are the same spoken language in two scripts. Soniox's language
 * identification hears an Urdu-medium ICT classroom and, on ~7% of recordings
 * since 2026-08-11, decides it is Hindi and writes the transcript in Devanagari.
 * Measured on prod: one session came back with 4,926 tokens tagged `hi` against
 * 139 tagged `en`, and not a single `ur`. That script then flows into the FICO
 * evidence a coach reads in the Flow, and into the teacher's report.
 *
 * It cannot be drawn. There is no Devanagari font in bot/shared/fonts/, and the
 * render container has no system fonts, so every Devanagari glyph paints as an
 * empty box. Unlike the Urdu tofu (bd-osmk0), this one cannot be fixed by
 * naming a fallback face — we do not ship the face.
 *
 * THE ORDER OF DEFENCE (each layer is cheaper and better than the next)
 *   1. Do not invite it: the Soniox language hints come from LANGUAGE_OFFER
 *      (ur, en) instead of a hardcoded six-language list. See audio.service.js.
 *   2. If it arrives anyway: re-transcribe once with a single forced `ur` hint.
 *   3. Only if it STILL arrives: transliterate to Perso-Arabic, here.
 *
 * HONEST LIMITS OF LAYER 3 — read before trusting its output.
 * Devanagari→Urdu is lossy in both directions and this is a mechanical map, not
 * a transliterator with a lexicon:
 *   - Urdu does not write short vowels, so ि and ु are dropped, exactly as a
 *     human would write them. A reader supplies them from context.
 *   - श and ष both fold to ش; ण and न both fold to ن. The distinction does not
 *     exist in Urdu orthography.
 *   - Nukta letters (क़ ख़ ग़ ज़ ड़ ढ़ फ़) are mapped, but Devanagari often omits the
 *     nukta, in which case ज़ arrives as ज and comes out as ج rather than ز.
 *   - Word-initial vowels are approximated; اِ / اُ distinctions are not restored.
 * The result is READABLE Urdu, not correct Urdu. It exists so a coach sees words
 * instead of boxes, and it always logs at error level so the real fix (layer 1
 * and 2) is never quietly replaced by this one.
 */

// U+0900–U+097F, plus the Devanagari Extended and Vedic blocks so a stray
// character from either cannot slip past the detector.
const DEVANAGARI_RE = /[ऀ-ॿ꣠-ꣿ᳐-᳿]/;
const DEVANAGARI_GLOBAL_RE = /[ऀ-ॿ꣠-ꣿ᳐-᳿]/g;

/** Two-character sequences first — a nukta or an aspirate must win over its base letter. */
const DIGRAPHS = [
  ['क़', 'ق'], ['ख़', 'خ'], ['ग़', 'غ'], ['ज़', 'ز'], ['ड़', 'ڑ'], ['ढ़', 'ڑھ'], ['फ़', 'ف'], ['य़', 'ی'],
  // The same letters when they arrive pre-composed rather than as base + U+093C.
  ['क़', 'ق'], ['ख़', 'خ'], ['ग़', 'غ'], ['ज़', 'ز'], ['ड़', 'ڑ'], ['ढ़', 'ڑھ'], ['फ़', 'ف'],
  // इए is the polite-imperative ending all over these debriefs — बताइए, कीजिए,
  // दीजिए. Character-by-character it yields a double hamza (ئئے); Urdu writes ئیے.
  ['इए', 'ئیے'],
  // Same ending after a consonant, where the short-i matra is dropped:
  // पूछिए, सुनिए, कीजिए. Urdu writes یے, not a hamza.
  ['िए', 'یے'],
];

const CHARS = {
  // Consonants. Aspirates carry the do-chashmi he (U+06BE), never the ordinary ہ.
  'क': 'ک', 'ख': 'کھ', 'ग': 'گ', 'घ': 'گھ', 'ङ': 'ن',
  'च': 'چ', 'छ': 'چھ', 'ज': 'ج', 'झ': 'جھ', 'ञ': 'ن',
  'ट': 'ٹ', 'ठ': 'ٹھ', 'ड': 'ڈ', 'ढ': 'ڈھ', 'ण': 'ن',
  'त': 'ت', 'थ': 'تھ', 'द': 'د', 'ध': 'دھ', 'न': 'ن',
  'प': 'پ', 'फ': 'پھ', 'ब': 'ب', 'भ': 'بھ', 'म': 'م',
  'य': 'ی', 'र': 'ر', 'ल': 'ل', 'व': 'و', 'ळ': 'ل',
  'श': 'ش', 'ष': 'ش', 'स': 'س', 'ह': 'ہ',
  // Independent vowels.
  'अ': 'ا', 'आ': 'آ', 'इ': 'ا', 'ई': 'ای', 'उ': 'ا', 'ऊ': 'او',
  'ऋ': 'ر', 'ए': 'اے', 'ऐ': 'اے', 'ओ': 'او', 'औ': 'او', 'ऑ': 'آ',
  // Dependent vowel signs. The short ones are intentionally dropped: Urdu does
  // not write them, and inserting a letter for them produces nonsense.
  'ा': 'ا', 'ि': '', 'ी': 'ی', 'ु': '', 'ू': 'و', 'ृ': 'ر',
  'े': 'ے', 'ै': 'ے', 'ो': 'و', 'ौ': 'و', 'ॉ': 'ا',
  // Signs.
  'ं': 'ں', 'ँ': 'ں', 'ः': 'ہ',
  '्': '',   // virama — suppresses the inherent vowel, which Urdu never wrote
  '़': '',   // bare nukta that survived the digraph pass
  '।': '۔', '॥': '۔', 'ऽ': '',
  // Devanagari digits fold to Latin: reports force numerals LTR anyway, and
  // Urdu commonly uses Latin digits.
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

/** Does this text contain any Devanagari at all? */
function hasDevanagari(text) {
  return typeof text === 'string' && DEVANAGARI_RE.test(text);
}

/** How many Devanagari code points are in here? Useful for logging severity. */
function countDevanagari(text) {
  if (typeof text !== 'string') return 0;
  const m = text.match(DEVANAGARI_GLOBAL_RE);
  return m ? m.length : 0;
}

// Devanagari letters and signs that CONTINUE a word. Used to tell a medial
// position from a final one, which changes three mappings — see below.
const IN_WORD_RE = /[ऀ-ॿ]/;

/**
 * Position-sensitive mappings. Urdu spells the same Devanagari character
 * differently depending on where in the word it falls, and ignoring that was
 * the difference between "بتاااے" and "بتائے" on real transcripts.
 */
const MEDIAL_OVERRIDES = {
  // ے is the word-FINAL shape of this vowel; medially Urdu writes ی.
  // में -> میں, not مےں.  हैं -> ہیں, not ہےں.
  'े': 'ی', 'ै': 'ی',
};
/**
 * An independent vowel inside a word takes a hamza carrier, not a bare alif.
 * Without this, बताइए transliterates to بتاااے — three stacked alifs, which is
 * not a word in any script.
 */
const POST_VOWEL_INDEPENDENTS = {
  'इ': 'ئ', 'ई': 'ئی', 'ए': 'ئے', 'ऐ': 'ئے',
  'उ': 'ؤ', 'ऊ': 'ؤ', 'ओ': 'ؤ', 'औ': 'ؤ', 'अ': '', 'आ': 'ا',
};
/** Devanagari characters that leave the syllable "open", so a following independent vowel is medial. */
const VOWELISH_RE = /[ािीुूृेैोौआअइईउऊएऐओौऔ]/;

/**
 * Collapse a geminate — consonant + virama + the SAME consonant. Devanagari
 * writes बच्चों with a doubled च; Urdu marks it with a tashdid that is almost
 * always left off, so the plain letter is what a reader expects: بچوں, not بچچوں.
 */
function collapseGeminates(src) {
  // Only the plain consonant block: the nukta digraphs have already been
  // rewritten to Perso-Arabic by the time this runs, and a geminate nukta
  // letter does not occur in practice.
  let out = src.replace(/([क-ह])्\1/g, '$1');
  // A geminated ASPIRATE is written unaspirated + aspirated in Devanagari —
  // अच्छा is च ् छ, not छ ् छ — so the identical-letter rule above misses it.
  // Urdu writes the aspirate once: اچھا, not اچچھا.
  for (const [plain, asp] of [
    ['क', 'ख'], ['ग', 'घ'], ['च', 'छ'], ['ज', 'झ'], ['ट', 'ठ'],
    ['ड', 'ढ'], ['त', 'थ'], ['द', 'ध'], ['प', 'फ'], ['ब', 'भ'],
  ]) {
    out = out.split(`${plain}्${asp}`).join(asp);
  }
  return out;
}

/**
 * Mechanically transliterate Devanagari runs to Perso-Arabic. Non-Devanagari
 * characters — Latin, existing Urdu, digits, punctuation, whitespace — pass
 * through untouched, so a code-switched transcript keeps its English words.
 *
 * Read the header before relying on the output: this is a legibility rescue.
 */
function transliterateToUrdu(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [from, to] of DIGRAPHS) out = out.split(from).join(to);
  out = collapseGeminates(out);

  const chars = Array.from(out);
  let result = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i + 1 < chars.length ? chars[i + 1] : '';
    const medial = IN_WORD_RE.test(next);   // another Devanagari char follows → not word-final

    if (medial && Object.prototype.hasOwnProperty.call(MEDIAL_OVERRIDES, ch)) {
      result += MEDIAL_OVERRIDES[ch];
      continue;
    }
    // An independent vowel directly after a vowel or matra is medial: carry it
    // on a hamza rather than opening a second alif.
    if (VOWELISH_RE.test(prev) && Object.prototype.hasOwnProperty.call(POST_VOWEL_INDEPENDENTS, ch)) {
      result += POST_VOWEL_INDEPENDENTS[ch];
      continue;
    }
    result += Object.prototype.hasOwnProperty.call(CHARS, ch) ? CHARS[ch] : ch;
  }
  // A virama or dropped short vowel can leave a doubled space; normalise.
  return result.replace(/[ \t]{2,}/g, ' ');
}

/**
 * The guard itself. Returns the text unchanged when it is already clean, and
 * the transliterated text when it is not — never Devanagari, whatever happens.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {function} [opts.onDetected] - called as ({ count, sample }) when the
 *   guard has to act. Wire it to a level='error' log: reaching layer 3 means
 *   layers 1 and 2 both failed and someone should look.
 * @returns {string}
 */
function ensureNoDevanagari(text, opts = {}) {
  if (!hasDevanagari(text)) return text;
  const count = countDevanagari(text);
  if (typeof opts.onDetected === 'function') {
    const sample = (text.match(DEVANAGARI_GLOBAL_RE) || []).slice(0, 12).join('');
    try { opts.onDetected({ count, sample }); } catch (_) { /* logging must never break a transcript */ }
  }
  return transliterateToUrdu(text);
}

module.exports = {
  hasDevanagari,
  countDevanagari,
  transliterateToUrdu,
  ensureNoDevanagari,
  DEVANAGARI_RE,
};
