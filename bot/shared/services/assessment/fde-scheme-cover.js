'use strict';
/**
 * The words on a marking scheme's cover and class record (bd-5jmnfj.4.50.5):
 * the "Covers" line, the names the teacher reads out for the paper's parts,
 * and the record's mark columns.
 *
 * A part is named the way the paper heads it: "Section A" only where the paper
 * prints "Section A …", its own heading ("Reading") where it does not. The
 * record carries the oral part when the paper has one, so the total the
 * legend asks for (written + oral) has a column to go in.
 *
 * Pure: strings in, strings out.
 */

// What the before-exam box calls the paper: it prints no file name.
const PAPER_NAME = { en: 'the question paper', ur: 'سوالیہ پرچے' }; // ur: needs fluent-Urdu review
const ORAL = { en: 'Oral', ur: 'زبانی' }; // ur: needs fluent-Urdu review

const { partName } = require('./fde-part-name');

/** "Covers: …" — the scope's own line, else its label with the line in brackets; one bracket deep, one stop. */
function coversLine(scope, template, lang) {
  if (scope.covers_en || scope.covers_ur) return scope[`covers_${lang}`];
  const label = String(scope[`label_${lang}`] || '').trim();
  const line = String(scope[`line_${lang}`] || '').replace(/[\s.۔]+$/, '');
  const text = !line ? label : (!label || /[()]/.test(line) ? line : `${label} (${line})`);
  return String(template || '').replace('{scope}', text);
}

// "A" → "Section A"; "B", "C" → "Sections B and C"; headings and Urdu labels joined as they are.
function joinParts(secs, lang) {
  const names = secs.map((s) => partName(s, lang));
  const and = (xs, comma, word) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(comma)} ${word} ${xs[xs.length - 1]}`);
  if (lang === 'ur') return and(names, '، ', 'اور');
  if (!secs.every((s, i) => names[i] === s.id)) return and(names, ', ', 'and');
  return `${names.length > 1 ? 'Sections' : 'Section'} ${and(names, ', ', 'and')}`;
}

/** The record's mark columns: each part, then the oral part when the paper has one. */
function recordColumns(L, lang, marksOf) {
  const parts = L.sections.map((sec) => ({ head: partName(sec, lang), marks: marksOf(sec) }));
  const oral = L.oral && L.oral.marks > 0 ? [{ head: ORAL[lang], marks: L.oral.marks }] : [];
  return [...parts, ...oral];
}

module.exports = { PAPER_NAME, coversLine, partName, joinParts, recordColumns };
