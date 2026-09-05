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
const PROPHET_RE = new RegExp(PROPHET_TOKENS.map(esc).join('|'), 'g');

// The honorific may be the ligature or spelled out; a comma, a colon or a
// quote may sit between the name and it.
const HONORIFIC_RE = /^[\s،۔:'"’”)(‏]{0,3}(ﷺ|صل[یى]\s*الل[ہه]\s*عل[يی]ہ?\s*(?:و\s*آل[ہه]\s*)?و\s*سلم)/;

// A companion as the books print them: "حضرت <name>". Bare "علی"/"عمر" would
// match ordinary words, so the unit is the honorific-bearing name phrase.
const COMPANION_RE = /حضرت\s+([^\s،۔:'"’”)(]+(?:\s+[^\s،۔:'"’”)(]+)?)/g;
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
    if (!HONORIFIC_RE.test(after)) {
      errs.push(`prophet mention without ﷺ: …${s.slice(Math.max(0, m.index - 15), m.index + m[0].length + 20)}`);
      break;
    }
  }

  // 2. Sacred names never in Latin script.
  const t = TRANSLIT_RE.exec(s);
  if (t) errs.push(`latin-script sacred name: ${t[1]}`);

  // 3. Companions carry their honorific.
  COMPANION_RE.lastIndex = 0;
  while ((m = COMPANION_RE.exec(s))) {
    const name = m[1];
    if (PROPHET_AFTER_HAZRAT.test(name)) continue;     // the Prophet — rule 1 owns it
    // The captured name may have swallowed the first word of the honorific
    // ("ابوبکر رضی"); check from the end of the FIRST word too.
    const firstWordEnd = m.index + 'حضرت '.length + name.split(/\s+/)[0].length;
    const afterFull = s.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const afterFirst = s.slice(firstWordEnd, firstWordEnd + 40);
    if (!COMPANION_HON.test(afterFull) && !COMPANION_HON.test(afterFirst)) {
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
    const tail = s.slice(m.index + m[0].length);
    const h = COMPANION_HON.exec(tail);
    spans.push([m.index, m.index + m[0].length + (h ? h[0].length : 0)]);
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
  truncateCodePoints,
  cpLen,
  PROPHET_RE,
  HONORIFIC_RE,
  TRANSLIT_RE,
  COMPANION_RE,
  COMPANION_HON,
};
