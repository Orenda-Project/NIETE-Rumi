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
function classLabel(v) {
  const t = String(v === null || v === undefined ? '' : v).trim();
  if (!t) return '';
  // Already names the unit — in English or the two romanisations teachers use.
  if (/^(grade|class|jamaat|jamat)\b/i.test(t)) return t;
  return `Grade ${t}`;
}

module.exports = { stripEmphasis, classLabel };
