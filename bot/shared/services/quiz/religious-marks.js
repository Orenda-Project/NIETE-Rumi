'use strict';
/**
 * Religious marks — the DECIDABLE half of the Islamiyat rule.
 *
 * Ported from the curriculum lesson-plan lint (the lp_html RELIGIOUS_MARKS
 * gate), which the operator specified as: sacred names typed correctly,
 * honorifics for the Prophet and his companions, and no content that puts
 * words in the Prophet's mouth. Everything here is mechanical — a missing ﷺ,
 * a transliterated sacred name, a companion honorified in one line and bare
 * in the next, prophetic speech with no hadith source behind it. The
 * judgement half (is this question theologically sound, is it appropriate
 * for a child) is not automatable and is not attempted; that is the native
 * review that gates the subject entering production.
 *
 * Two deliberate differences from the lint it was ported from:
 *   - the honorific regex accepts «صلی اللہ علیہ وآلہ وسلم» (the وآلہ
 *     variant), which real transcripts use and which the lint wrongly rejects;
 *   - truncateCodePoints() exists so a 24-code-point list title or a
 *     20-code-point button never ends on "نبی کریم" with the ﷺ cut off.
 */

// LONGEST FIRST. "نبی" is a substring of "نبی کریم", and scanning short-first
// reports a missing honorific on every correctly-honorified mention.
const PROPHET_TOKENS = [
  'سرورِ کائنات', 'پیغمبر اسلام', 'رسولِ اکرم', 'رسول اللہ', 'رسول کریم',
  'نبی کریم', 'نبی اکرم', 'نبی پاک', 'آں حضرت', 'آنحضرت', 'حضور اکرم',
  'حضرت محمد', 'محمد', 'حضور', 'نبی',
].sort((a, b) => b.length - a.length);
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PROPHET_ALT = PROPHET_TOKENS.map(esc).join('|');
// WHOLE WORDS only. JS \b is ASCII-only, so without this «نبی» matched inside
// «نبیوں» (the plural "prophets") and «انبیاء», and the checker demanded ﷺ for
// a word that is not a mention of the Prophet at all. The lookaround excludes a
// letter or a digit on either side but NOT a combining mark, so «نبیؐ» — where
// the mark IS the honorific — still reaches rule 1.
const PROPHET_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PROPHET_ALT})(?![\\p{L}\\p{N}])`, 'gu');
// A COMPOUND title — «نبی حضرت محمد ﷺ», «رسول اللہ حضرت محمد ﷺ». The mention
// continues into a second Prophet token, and the honorific belongs after the
// LAST element. Demanding it after the first is what reported one Islamiyat
// lesson's every mention as bare while ﷺ sat two words to the right.
const PROPHET_CONTINUES = new RegExp(`^[\\s،:]{0,3}(?:${PROPHET_ALT})`);

// The honorific may be the ligature or spelled out; a comma, a colon or a
// quote may sit between the name and it.
const HONORIFIC_RE = /^[\s،۔:'"’”)(‏]{0,3}(ﷺ|صل[یى]\s*الل[ہه]\s*عل[يی]ہ?\s*(?:و\s*آل[ہه]\s*)?و\s*سلم)/;

// A companion as the books print them: "حضرت <name>". Bare "علی"/"عمر" would
// match ordinary words, so the unit is the honorific-bearing name phrase.
const COMPANION_RE = /حضرت\s+([^\s،۔:'"’”)(]+(?:\s+[^\s،۔:'"’”)(]+)?)/g;
// One word of a name, with the space run before it.
const NAME_WORD = /^\s*([^\s،۔:'"’”)(]+)/;
// The links a patronymic name is built from: «سعد بن ربیع», «زینب بنت خزیمہ».
const PATRONYM = /^(بنِ?|ابنِ?|بنتِ?)$/;
// A name is a name, not a sentence. Six words covers «ابو عبیدہ بن الجراح»
// with room to spare and stops the walk long before a verb.
const NAME_MAX_WORDS = 6;
const COMPANION_HON = /^[\s،۔]{0,2}(رضی\s*اللہ\s*(?:تعالیٰ\s*)?عنہم?ا?|رضی\s*اللہ\s*عنہا|رضوان\s*اللہ|کرم\s*اللہ\s*وجہہ|علیہ\s*السلام|علیہا\s*السلام|رحمہ\s*اللہ|رحمۃ\s*اللہ|صدیق|فاروق|المرتضیٰ|ﷺ|صل[یى]\s*الل[ہه])/;
// Names that are the Prophet's, not a companion's — PROPHET_RE owns these.
const PROPHET_AFTER_HAZRAT = /^(محمد|محمّد)\b/;

// Latin script has no place in a sacred name on an Urdu religious page.
const TRANSLIT_RE = /\b(Allah|ALLAH|Muhammad|Mohammad|Muhammed|PBUH|SAW|SAWW|Sallallahu|Rasool|Rasul|Sahaba|Radiallahu)\b/;

// Attributed prophetic SPEECH: a Prophet token, a speech verb that INTRODUCES
// words, and a quoted span. That is a hadith; without a source it is the
// "content that has him speak" the operator ruled out.
const SPEECH_VERB = /(فرمایا|ارشاد\s*فرمایا|کہا)\s*[:：]\s*['‘"“]?/;
const QUOTED_SPAN = /['‘"“][^'’"”]{6,}['’"”]/;
const HADITH_SOURCE = /(بخاری|مسلم(?![\u0600-\u06FF])|ترمذی|ابو\s*داؤد|نسائی|ابن\s*ماجہ|مؤطا|مسند|حدیث\s*[۰-۹0-9]|ص\s*[۰-۹0-9]|p\.?\s*\d)/;

function cpLen(s) {
  return [...String(s || '')].length;
}

/** Every Prophet-token span in `s`, so the companion rule can stay out of them. */
function prophetSpans(s) {
  const spans = [];
  PROPHET_RE.lastIndex = 0;
  let m;
  while ((m = PROPHET_RE.exec(s))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/**
 * The offsets at which a companion's name could END — the places the honorific
 * is allowed to sit.
 *
 * bd-mg9c7.95: the books print most companions patronymically («سعد بن ربیع»,
 * «عبدالرحمن بن عوف»), so a name is a first word, optionally a second (a kunya
 * or a family name), and then as many «بن X» / «بنت X» links as follow. Looking
 * only two words deep is what made every correctly-honorified patronymic read
 * as bare, and one real Islamiyat lesson shipped zero questions six times out
 * of six because of it.
 *
 * The walk stops at the first word that is neither a link nor the word a link
 * introduces, so an honorific belonging to a DIFFERENT name later in the
 * sentence can never be borrowed by a bare one.
 */
function companionNameEnds(s, from) {
  const words = [];
  let i = from;
  for (let k = 0; k < NAME_MAX_WORDS; k += 1) {
    const m = NAME_WORD.exec(s.slice(i));
    if (!m) break;
    const end = i + m[0].length;
    words.push({ word: m[1], end });
    i = end;
  }
  const ends = [];
  for (let k = 0; k < words.length; k += 1) {
    if (k > 1 && !PATRONYM.test(words[k].word) && !PATRONYM.test(words[k - 1].word)) break;
    ends.push(words[k].end);
  }
  return ends;
}

/**
 * For the «حضرت …» match starting at `at`: is the honorific there, and where
 * does the name-plus-honorific end? The end is what a truncation must not cut
 * into.
 */
function companionExtent(s, at) {
  const ends = companionNameEnds(s, at + 'حضرت'.length);
  for (const end of ends) {
    const h = COMPANION_HON.exec(s.slice(end, end + 40));
    if (h) return { honorified: true, end: end + h[0].length };
  }
  return { honorified: false, end: ends.length ? ends[ends.length - 1] : at + 'حضرت'.length };
}

/**
 * Check one string. Returns an array of error strings (empty = clean).
 * @param {string} text
 */
function checkReligiousMarks(text) {
  const s = String(text || '');
  const errs = [];
  if (!s.trim()) return errs;

  // 1. Every Prophet mention carries an honorific.
  PROPHET_RE.lastIndex = 0;
  let m;
  while ((m = PROPHET_RE.exec(s))) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
    // The name continues into another Prophet token: that later mention is the
    // one the honorific has to follow, and this loop reaches it next.
    if (PROPHET_CONTINUES.test(after)) continue;
    if (!HONORIFIC_RE.test(after)) {
      errs.push(`prophet mention without ﷺ: …${s.slice(Math.max(0, m.index - 15), m.index + m[0].length + 20)}`);
      break;
    }
  }

  // 2. Sacred names never in Latin script.
  const t = TRANSLIT_RE.exec(s);
  if (t) errs.push(`latin-script sacred name: ${t[1]}`);

  // 3. Companions carry their honorific.
  // COMPANION_RE has no left word boundary (JS \b is ASCII-only), so it also
  // matches the حضرت inside «آنحضرت» and the حضرت of «آں حضرت» / «حضرت محمد» —
  // all of which are the Prophet, and all of which rule 1 has already checked.
  // «آنحضرت ﷺ» was reported as "companion without honorific: حضرت ﷺ".
  const inProphet = prophetSpans(s);
  COMPANION_RE.lastIndex = 0;
  while ((m = COMPANION_RE.exec(s))) {
    const name = m[1];
    if (inProphet.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (PROPHET_AFTER_HAZRAT.test(name)) continue;     // the Prophet — rule 1 owns it
    // The honorific may sit after the first word, after a two-word name, or
    // after any patronymic link — companionNameEnds() enumerates all of them.
    if (!companionExtent(s, m.index).honorified) {
      errs.push(`companion without honorific: حضرت ${name.split(/\s+/)[0]}`);
      break;
    }
  }

  // 4. No unsourced prophetic speech.
  PROPHET_RE.lastIndex = 0;
  if (PROPHET_RE.test(s) && SPEECH_VERB.test(s) && QUOTED_SPAN.test(s) && !HADITH_SOURCE.test(s)) {
    errs.push('unsourced prophetic speech (a quoted saying with no hadith reference)');
  }
  return errs;
}

/**
 * The spans [start, end) that must survive a cut together: a Prophet mention
 * plus its honorific, or a companion's name plus its honorific.
 */
function protectedSpans(s) {
  const spans = [];
  PROPHET_RE.lastIndex = 0;
  let m;
  while ((m = PROPHET_RE.exec(s))) {
    const tail = s.slice(m.index + m[0].length);
    const h = HONORIFIC_RE.exec(tail);
    spans.push([m.index, m.index + m[0].length + (h ? h[0].length : 0)]);
  }
  COMPANION_RE.lastIndex = 0;
  while ((m = COMPANION_RE.exec(s))) {
    // The WHOLE patronymic name plus its honorific: cutting «حضرت سعد بن» off
    // «ربیع رضی اللہ عنہ» separates the name from the honorific just as surely
    // as cutting the honorific itself.
    spans.push([m.index, companionExtent(s, m.index).end]);
  }
  return spans;
}

/**
 * Cut a string to `max` CODE POINTS without ever separating a sacred name
 * from its honorific: if the cut would land inside a protected span, the cut
 * moves to the start of that span instead. Trailing whitespace is trimmed.
 *
 * Used at every truncation site a child or teacher sees (list row titles and
 * descriptions, button titles, the PDF). Meta truncates SILENTLY past its
 * caps, so this is the only place the honorific is guaranteed to survive.
 */
function truncateCodePoints(text, max) {
  const s = String(text || '');
  const cps = [...s];
  if (cps.length <= max) return s;
  let cutIdx = cps.slice(0, max).join('').length;   // UTF-16 index of the cut
  for (const [start, end] of protectedSpans(s)) {
    if (cutIdx > start && cutIdx < end) { cutIdx = start; break; }
  }
  return s.slice(0, cutIdx).replace(/[\s،۔,.:;]+$/, '');
}

module.exports = {
  checkReligiousMarks,
  companionExtent,
  truncateCodePoints,
  cpLen,
  PROPHET_RE,
  HONORIFIC_RE,
  TRANSLIT_RE,
  COMPANION_RE,
  COMPANION_HON,
};
