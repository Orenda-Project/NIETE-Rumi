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
  // The same letters when they arrive PRECOMPOSED (U+0958-U+095F) rather than as base + U+093C. Written as escapes:
  // these are Unicode composition exclusions, so an editor that normalises the file turns a literal one into base +
  // nukta, which is how this line once became a silent duplicate of the one above.
  ['\u0958', 'ق'], ['\u0959', 'خ'], ['\u095A', 'غ'], ['\u095B', 'ز'],
  ['\u095C', 'ڑ'], ['\u095D', 'ڑھ'], ['\u095E', 'ف'], ['\u095F', 'ی'],
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
  // The rarer letters and signs, by their nearest Urdu reading (escapes, for the same reason as the
  // precomposed nukta letters above). Anything still left in the Devanagari blocks is dropped at the end.
  '\u0900': 'ں',                                   // inverted candrabindu
  '\u0904': 'ا', '\u090C': 'ل', '\u090D': 'اے',     // short a, vocalic l, candra e
  '\u090E': 'اے', '\u0912': 'او', '\u0960': 'ر',     // short e, short o, vocalic rr
  '\u0961': 'ل', '\u0972': 'آ',                     // vocalic ll, candra a
  '\u0929': 'ن', '\u0931': 'ر', '\u0934': 'ل',       // nnna, rra, llla
  '\u0944': 'ر', '\u0945': 'ے', '\u0946': 'ے',       // vowel signs: vocalic rr, candra e, short e
  '\u094A': 'و', '\u0962': 'ل', '\u0963': 'ل',       // vowel signs: short o, vocalic l, vocalic ll
  '\u0950': 'اوم', '\u0970': '.',                    // om, abbreviation sign
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
  '\u0945': 'ی', '\u0946': 'ی',   // candra e and short e signs, as े
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
  // The guarantee is "never Devanagari". A code point the map does not know (a Vedic tone mark, a
  // letter only other languages use) is dropped rather than shown as a box.
  // A virama or dropped short vowel can leave a doubled space; normalise.
  return result.replace(DEVANAGARI_GLOBAL_RE, '').replace(/[ \t]{2,}/g, ' ');
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

/**
 * The same guard over a MODEL REPLY, not just a transcript.
 *
 * The transcript layers hold, but the model still writes the odd Hindi-script word into its own Urdu: evidence, the
 * report narrative, the focus area, the reflective corpus (prod, 1-19 Nov 2026: 81 teacher DC sessions and 20 coach
 * observations, across about 45 different JSON paths). So every string in a JSON-shaped value goes through
 * transliterateToUrdu — this file's one converter — wherever it sits. Keys, numbers, booleans and null are left as
 * they are; a string with no Devanagari is returned as it was, so English and Urdu are untouched.
 *
 * The input is never mutated. Only the branches that held Devanagari are copied; everything else keeps its
 * reference, and a value that needed nothing comes back as the very same reference.
 *
 * @param {*} value - what a model reply parses to (object, array, string, scalar)
 * @param {object} [opts]
 * @param {function} [opts.onDetected] - called once, only when something was converted, as
 *   ({ count, strings, paths, sample }): Devanagari code points, strings converted, up to 20 JSON paths
 *   ('domains.x.indicators[0].evidence'), and up to 12 of the Devanagari characters. Never the sentence itself.
 * @returns {*}
 */
const DEEP_MAX_DEPTH = 64;
const DEEP_MAX_PATHS = 20;

function ensureNoDevanagariDeep(value, opts = {}) {
  const found = { count: 0, strings: 0, paths: [], sample: '' };
  const out = deepConvert(value, '', found, 0);
  if (found.strings && typeof opts.onDetected === 'function') {
    try { opts.onDetected(found); } catch (_) { /* logging must never cost the caller its text */ }
  }
  return out;
}

function deepConvert(v, path, found, depth) {
  if (typeof v === 'string') {
    if (!hasDevanagari(v)) return v;
    found.strings += 1;
    found.count += countDevanagari(v);
    if (found.paths.length < DEEP_MAX_PATHS) found.paths.push(path || '$');
    if (found.sample.length < 12) {
      found.sample += (v.match(DEVANAGARI_GLOBAL_RE) || []).join('').slice(0, 12 - found.sample.length);
    }
    return transliterateToUrdu(v);
  }
  if (!v || typeof v !== 'object' || depth >= DEEP_MAX_DEPTH) return v;
  if (Array.isArray(v)) {
    let copy = null;
    for (let i = 0; i < v.length; i++) {
      const next = deepConvert(v[i], `${path}[${i}]`, found, depth + 1);
      if (next !== v[i]) { if (!copy) copy = v.slice(); copy[i] = next; }
    }
    return copy || v;
  }
  // Plain objects only: a Date, a Buffer or a class instance is not model text.
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  let copy = null;
  for (const k of Object.keys(v)) {
    const next = deepConvert(v[k], path ? `${path}.${k}` : k, found, depth + 1);
    if (next !== v[k]) { if (!copy) copy = { ...v }; copy[k] = next; }
  }
  return copy || v;
}

module.exports = {
  hasDevanagari,
  countDevanagari,
  transliterateToUrdu,
  ensureNoDevanagari,
  ensureNoDevanagariDeep,
  DEVANAGARI_RE,
};
