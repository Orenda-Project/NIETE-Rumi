'use strict';
/**
 * The board-pattern registry: which patterns exist, who may use them, and the
 * few derived views the routes and the generator need (the summary the app
 * shows, the pages a pattern paper is set from, the slot-tagged type list).
 *
 * Pure: reads the frozen pattern modules, never writes them.
 */

const FDE_G5_2027 = require('./fde-g5-2027');
const FDE_G1_2026 = require('./fde-g1-2026');
const FDE_G2_2026 = require('./fde-g2-2026');

// The same subject aliases as question-types.js's normalise (not exported there).
const SUBJECT_ALIAS = {
  eng: 'english', math: 'maths', mathematics: 'maths', gensci: 'science',
  genk: 'general_knowledge', sst: 'social_studies',
};

function normalise(subject) {
  const k = String(subject || '').trim().toLowerCase();
  return SUBJECT_ALIAS[k] || k;
}

const REGISTRY = Object.freeze({
  [FDE_G5_2027.id]: FDE_G5_2027,
  [FDE_G1_2026.id]: FDE_G1_2026,
  [FDE_G2_2026.id]: FDE_G2_2026,
});

function list() {
  return Object.keys(REGISTRY);
}

function get(id) {
  return REGISTRY[String(id || '')] || null;
}

function subjectOf(id, subject) {
  const P = get(id);
  if (!P) return null;
  return P.subjects[normalise(subject)] || null;
}

function isEligible(id, grade, subject) {
  const P = get(id);
  if (!P || grade === null || grade === undefined || grade === '') return false;
  return Number(grade) === P.grade && Boolean(subjectOf(id, subject));
}

function slotsOf(S) {
  return S.sections.flatMap((sec) => sec.slots);
}

/** A slot label without FDE's trailing punctuation: "Q.7:" → "Q7", "Q1. (a)" → "Q1 (a)". */
function shortLabel(label) {
  return String(label || '')
    .replace(/^Q\.\s?/, 'Q')
    .replace(/^(Q\d+)\.\s*\(/, '$1 (')
    .replace(/[.:]\s*$/, '')
    .trim();
}

function parseRanges(str) {
  return String(str || '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [a, b] = part.split('-').map((n) => Number(n.trim()));
    return [a, Number.isFinite(b) ? b : a];
  });
}

function formatRanges(ranges) {
  return ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ');
}

/** The pages one slot is set from: the whole scope, or a run of units (Maths). */
function rangesForSlot(S, slot) {
  const spec = slot.section_pages || 'scope';
  const m = /^units:(\d+)(?:-(\d+))?$/.exec(spec);
  if (!m) return parseRanges(S.scope.page_ranges);
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return S.scope.unit_ranges
    .filter((u) => u.chapter >= lo && u.chapter <= hi)
    .flatMap((u) => parseRanges(u.ranges));
}

function unionRanges(ranges) {
  const seen = new Map();
  ranges.forEach(([a, b]) => seen.set(`${a}-${b}`, [a, b]));
  return [...seen.values()].sort((x, y) => x[0] - y[0]);
}

/** What the server fills in for a pattern paper set on the FDE syllabus. */
function scopeFor(id, subject) {
  const S = subjectOf(id, subject);
  if (!S) return null;
  const sectionRanges = {};
  for (const sec of S.sections) {
    sectionRanges[sec.id] = formatRanges(unionRanges(sec.slots.flatMap((slot) => rangesForSlot(S, slot))));
  }
  return {
    page_ranges: S.scope.page_ranges,
    chapters: [...S.scope.chapter_numbers],
    display_chapters: [...S.scope.display_chapters],
    excluded: [...S.scope.excluded],
    topics_only: [...S.scope.topics_only],
    held: [...S.scope.held],
    unit_ranges: S.scope.unit_ranges.map((u) => ({ chapter: u.chapter, ranges: u.ranges })),
    section_ranges: sectionRanges,
    label_en: S.scope.label_en,
    label_ur: S.scope.label_ur,
    line_en: S.scope.line_en,
    line_ur: S.scope.line_ur,
  };
}

/** One entry per slot: the type the model is asked for, how many, and the slot to tag. */
function expandTypes(id, subject) {
  const S = subjectOf(id, subject);
  if (!S) return [];
  return slotsOf(S).map((slot) => ({
    id: slot.type, count: slot.generate, category: slot.category, slot: slot.slot,
  }));
}

/** The lines the app shows about a pattern for one subject (data, never typed into the app). */
function summaryFor(id, subject) {
  const P = get(id);
  const S = subjectOf(id, subject);
  if (!P || !S) return null;
  const generateTotal = slotsOf(S).reduce((sum, slot) => sum + slot.generate, 0);
  const n = S.sections.length;
  const lines = S.summary_lines;
  const frame = slotsOf(S).find((slot) => slot.frame);
  const youAdd = frame
    ? { en: P.you_add[frame.frame.kind].en, ur: P.you_add[frame.frame.kind].ur, kind: frame.frame.kind, slot: frame.slot }
    : null;
  return {
    id: P.id,
    name: { en: P.name.en, ur: P.name.ur },
    holds: {
      en: `${n} sections · ${S.total_marks} marks · ${S.total_time_en} · ${generateTotal} questions`,
      ur: `${n} حصے · ${S.total_marks} نمبر · ${S.total_time_ur} · ${generateTotal} سوال`, // needs fluent-Urdu review
    },
    sections: S.sections.map((sec, i) => ({ id: sec.id, en: lines.en.sections[i], ur: lines.ur.sections[i] })),
    choice: { en: lines.en.choice, ur: lines.ur.choice },
    choices: slotsOf(S).filter((slot) => slot.attempt < slot.generate).map((slot) => ({
      slot: slot.slot,
      label_en: shortLabel(slot.label_en),
      label_ur: slot.label_ur,
      generate: slot.generate,
      attempt: slot.attempt,
      marks_each: slot.marks_each,
    })),
    youAdd,
    scope: {
      en: S.scope.line_en,
      ur: S.scope.line_ur,
      label: { en: S.scope.label_en, ur: S.scope.label_ur },
      chapters: [...S.scope.chapter_numbers],
      displayChapters: [...S.scope.display_chapters],
      excluded: [...S.scope.excluded],
      topicsOnly: [...S.scope.topics_only],
      held: [...S.scope.held],
      unitRanges: S.scope.unit_ranges.map((u) => ({ chapter: u.chapter, ranges: u.ranges })),
    },
    files: { en: P.files.en, ur: P.files.ur },
    generateTotal,
    totalMarks: S.total_marks,
    totalTime: { en: S.total_time_en, ur: S.total_time_ur },
    waitHint: { en: P.wait_hint.en, ur: P.wait_hint.ur },
  };
}

module.exports = {
  list, get, isEligible, summaryFor, scopeFor, expandTypes,
  // for the layout pass and the renderer
  subjectOf, shortLabel, parseRanges, normalise,
};
