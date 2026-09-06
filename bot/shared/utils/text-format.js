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
 * bd-2612 — label a child's class without saying "Grade" twice.
 *
 * Children type this themselves when they open the share link, so the column
 * holds "3", "Grade 3", "Class 3", "4 B" and worse. The template used to
 * prefix "Grade " unconditionally, which produced "Grade Grade 3" and
 * "Grade Class 3" in a real teacher's report.
 */
function classLabel(v, language = 'en') {
  const t = String(v === null || v === undefined ? '' : v).trim();
  if (!t) return '';
  // Already names the unit — in English, in Urdu, or in the two romanisations
  // teachers use. Checked before the language branch, because a child who
  // typed "Class 3" into an Urdu quiz still typed "Class 3".
  // `\b` is an ASCII word boundary, so it never fires after a Perso-Arabic
  // letter — "جماعت 4" has to be matched on the following space instead,
  // or it comes back out as "جماعت جماعت 4".
  if (/^(grade|class|jamaat|jamat)\b/i.test(t) || /^جماعت(\s|$)/.test(t)) return t;
  // PLAN_R4 D1 — a single-language document cannot print an English word
  // in the middle of an Urdu roster. The label is chrome, so it follows the
  // document's language; the class VALUE the child typed is left as typed.
  return language === 'ur' ? `جماعت ${t}` : `Grade ${t}`;
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
 * Two children in one class must not read as two classes, so "7", "Class 7"
 * and " 7 " collapse; the unit word the child typed is stripped for the
 * comparison and the DOCUMENT's own unit word is put back once, in front.
 *
 * Sorted numerically, because a lexical sort puts "10" before "6" and a
 * teacher reading "Classes 10, 6, 7" assumes the report is broken.
 */
const CLASS_UNIT = /^(grade|class|jamaat|jamat)\b[\s.:-]*|^جماعت[\s.:-]*/i;

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
    const raw = String(v === null || v === undefined ? '' : v).trim();
    if (!raw) return;
    const bare = raw.replace(CLASS_UNIT, '').trim();
    if (!bare) return;
    const key = bare.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) seen.set(key, bare);
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

module.exports = { stripEmphasis, classLabel, classHeading, normaliseClasses };
