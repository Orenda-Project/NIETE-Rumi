'use strict';
/**
 * Small presentation helpers shared by the class-report service and template.
 *
 * They live in utils, not in either of those two files, because the service
 * lazily requires the template inside sendAsPdf(). Putting a shared helper in
 * one of them and importing it from the other would close that loop into a
 * circular require.
 *
 * Ported from the main bot (bd-2610/2611/2612) as a prerequisite for the
 * video-quiz report i18n foundation — self-contained, no other deps.
 */

/**
 * bd-2611 — take markdown emphasis out of LLM prose before a teacher reads it.
 *
 * The "For tomorrow" paragraph is written by an LLM, which reaches for
 * markdown unprompted. Nothing stripped it, so the asterisks went out in the
 * PDF. Telling the prompt not to use markdown helps but cannot be relied on —
 * a model is free to ignore an instruction, so the guarantee has to be
 * deterministic and live here.
 *
 * Deliberately does NOT touch a lone `*`. In the WhatsApp text fallback a
 * single asterisk IS bold, so stripping it would break the one place it is
 * correct — and "draw 3 * 4 dots" is a legitimate maths line.
 */
function stripEmphasis(s) {
  if (s === null || s === undefined) return s;
  return String(s)
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    // A single underscore pair, only when it hugs the words it wraps, so
    // snake_case_identifiers and stray underscores survive untouched.
    .replace(/(?<![\w_])_(?!\s)([\s\S]+?)(?<!\s)_(?![\w_])/g, '$1');
}

/**
 * Read the class a child typed into the join form.
 *
 * The column is free text and one class of children writes it a dozen ways:
 * "4", "Class 4", "grade 4", "4th", "4 B", "Class-4", "class four", "چوتھی
 * جماعت", and the same digit in three scripts — "4", "۴" (the Urdu digit a
 * Pakistani keyboard types) and "٤" (Arabic-Indic). Compared as strings those
 * were different classes: the report's hero read "جماعتیں 4، ۴".
 *
 * So the digits are normalised first, and then the GRADE NUMBER is read out of
 * the text — the first number from 1 to 12, as digits or as a word. A section
 * letter or a trailing "th" is not part of the grade. A class with no number in
 * it at all ("KG", "Prep", "کچی") keeps its own word, with the unit word the
 * child may have typed in front of it taken off.
 *
 * Returns { key, value } — `key` decides "the same class", `value` is what a
 * label prints after the document's own unit word — or null for a blank.
 */
const URDU_DIGITS = /[\u06F0-\u06F9]/g;       // ۰-۹, the digits an Urdu keyboard types
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g; // ٠-٩

function normaliseDigits(s) {
  return String(s)
    .replace(URDU_DIGITS, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

const CLASS_UNIT = /^(?:grade|class|jamaat|jamat|std|standard)(?![a-z])[\s.:#-]*|^(?:جماعت|کلاس|گریڈ)[\s.:#-]*/i;

// Number words a child may type instead of the digit, in either script. Whole
// words only — they are matched against the tokens of the text, never inside one.
const GRADE_WORDS = new Map(Object.entries({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  ایک: 1, دو: 2, تین: 3, چار: 4, پانچ: 5, چھ: 6, سات: 7, آٹھ: 8, نو: 9, دس: 10, گیارہ: 11, بارہ: 12,
  پہلی: 1, پہلا: 1, دوسری: 2, دوسرا: 2, تیسری: 3, تیسرا: 3, چوتھی: 4, چوتھا: 4, پانچویں: 5, پانچواں: 5,
  چھٹی: 6, چھٹا: 6, ساتویں: 7, ساتواں: 7, آٹھویں: 8, آٹھواں: 8, نویں: 9, نواں: 9, دسویں: 10, دسواں: 10,
  گیارہویں: 11, گیارھویں: 11, بارہویں: 12, بارھویں: 12,
}));

function parseClass(v) {
  const raw = normaliseDigits(v === null || v === undefined ? '' : v).trim();
  if (!raw) return null;
  const digits = raw.match(/\d+/);
  let grade = digits ? Number(digits[0]) : null;
  if (grade === null) {
    const tokens = raw.toLowerCase().split(/[\s.,:;#()\-،۔]+/).filter(Boolean);
    const hit = tokens.find((t) => GRADE_WORDS.has(t));
    if (hit) grade = GRADE_WORDS.get(hit);
  }
  if (Number.isInteger(grade) && grade >= 1 && grade <= 12) return { key: String(grade), value: String(grade) };
  const bare = raw.replace(CLASS_UNIT, '').trim();
  if (!bare) return null;
  return { key: bare.toLowerCase().replace(/\s+/g, ' '), value: bare };
}

/**
 * The grade a QUIZ row carries, as the words that follow "Grade" in a prompt:
 * "4" for "4", "Grade 4" or "۴"; a band the lesson digest estimated ("6-8") is
 * kept as the band rather than read as its first number. '' when there is none.
 */
function gradeText(v) {
  const raw = normaliseDigits(v === null || v === undefined ? '' : v).trim().replace(CLASS_UNIT, '').trim();
  const band = raw.match(/^(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})$/i);
  if (band) return `${Number(band[1])}-${Number(band[2])}`;
  const c = parseClass(raw);
  return c ? c.value : '';
}

/**
 * bd-2612 — label a child's class without saying "Grade" twice. Now also ONE
 * format per document: "Class 4" in English, "جماعت 4" in Urdu, whatever the
 * child typed — "Grade 5", "class 5" and "جماعت ۴" in one roster read as three
 * different kinds of thing. The unit word is chrome, so it follows the
 * document's language (PLAN_R4 D1); the value is the parsed grade.
 */
function classLabel(v, language = 'en') {
  const c = parseClass(v);
  if (!c) return '';
  return language === 'ur' ? `جماعت ${c.value}` : `Class ${c.value}`;
}


/**
 * PLAN_R5 §0 item 6 — name the class from what the CHILDREN typed.
 *
 * The pre-send PDF used to print the DIGEST's grade band, and a band derived
 * from a transcript reads "Grade 6-8", which the operator correctly called a
 * wild range: it is the model's guess about a recording, not a fact about a
 * classroom. By the time the report is written the fact exists — every child
 * typed a class into the join form — so the report says what they typed and
 * the PDF, which is written before any of them has, says nothing at all.
 *
 * Two children in one class must not read as two classes, so "7", "Class 7",
 * "7th", "۷" and " 7 " collapse — parseClass() reads the grade number out of
 * each — and the DOCUMENT's own unit word is put back once, in front.
 *
 * Sorted numerically, because a lexical sort puts "10" before "6" and a
 * teacher reading "Classes 10, 6, 7" assumes the report is broken.
 */

/**
 * The one definition of "the same class", so the report service (which reads
 * the sessions) and the report chrome (which words the heading) cannot come to
 * different answers about how many classes took the quiz. Two copies of this
 * rule is exactly the kind of pair that drifts and then disagrees on one
 * teacher's report.
 *
 * Returns the BARE values — the unit word stripped — in reading order. The
 * caller puts the document's own unit word back on, once, in front.
 */
function normaliseClasses(values) {
  const seen = new Map();
  (Array.isArray(values) ? values : []).forEach((v) => {
    const c = parseClass(v);
    if (c && !seen.has(c.key)) seen.set(c.key, c.value);
  });
  return [...seen.values()].sort((a, b) => {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
    return a.localeCompare(b);
  });
}

function classHeading(values, language = 'en') {
  const classes = normaliseClasses(values);
  if (!classes.length) return '';
  const ur = language === 'ur';
  const unit = classes.length > 1
    ? (ur ? 'جماعتیں' : 'Classes')
    : (ur ? 'جماعت' : 'Class');
  // The list separator belongs to the sentence's language, like every other
  // piece of punctuation in it (language-protocol §9.6).
  return `${unit} ${classes.join(ur ? '، ' : ', ')}`;
}

module.exports = { stripEmphasis, classLabel, classHeading, normaliseClasses, gradeText };
