'use strict';

/**
 * bd-pni007 — obs612: the coach observation rubric for grades 6-12, built from FDE's own tools (Annexure G of
 * FDE's 2026-27 guidelines). Every reader shares this module: the visit's rubric choice, the Flow, the record,
 * the coach summary, the teacher report, the portal label.
 *
 * Three tools, each its own rubric id (the id names the family, the classes, the subject and the version):
 *
 *   obs612-msci-v1   Maths & Science tool (FDE: Grade VI-VII)      11 indicators at Level 0-3, a 5-student check,
 *                                                                  a development plan. FDE gives no total.
 *   obs612-enur-v1   English & Urdu tool (FDE: Grade VI-VIII)      items scored 1-4; sheet 'en' /148, 'ur' /156;
 *                                                                  % and a band (Section 7's bands, on the %).
 *   obs612-gen-v1    Teacher Observation Form General (any class)  35 Yes/No items in 6 sections. No score.
 *
 * The wording is data: obs612.rubric.json, generated from FDE_2026-27_annex-g.md by
 * bot/scripts/build-obs612-rubric.js. Never hand-edit the JSON. What is ours, not FDE's, lives here: which tool a
 * class and subject get (FDE's pack leaves gaps; the operator approved the defaults on 11 Nov), the short names
 * the report rows use, and the arithmetic.
 *
 * The coach scores every item. An obs612 score is never a FICO number: it is stamped with its rubric id
 * (analysis_data.framework / .rubric / .scores.rubric), and frameworks/own-rubric.js keeps it out of every FICO
 * total and average.
 */

const fs = require('fs');
const path = require('path');

const RUBRIC_FILE = path.join(__dirname, 'obs612.rubric.json');
const RUBRIC = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf8'));

const FAMILY = 'obs612';
// The label every surface shows (operator 11 Nov ~18:45: framework + version only, no grade or subject).
const LABEL = RUBRIC.label; // 'FDE v1'
const TOOLS = RUBRIC.tools;
const IDS = Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, t.id]));
const ID_RX = /^obs612-(gen|msci|enur)-v(\d+)$/;

/** Is this string an obs612 rubric id (any version)? */
function isObs612Id(id) {
  return typeof id === 'string' && ID_RX.test(id);
}

/** 'gen' | 'msci' | 'enur' for an obs612 rubric id, else null. */
function toolOf(id) {
  const m = ID_RX.exec(String(id || ''));
  return m ? m[1] : null;
}

/** The tool definition for a rubric id (this version's), else null. */
function toolById(id) {
  const t = toolOf(id);
  return t && TOOLS[t] && TOOLS[t].id === id ? TOOLS[t] : null;
}

// ── which tool a lesson gets ──────────────────────────────────────────────────

// The class a coach can name. 1-5 is one choice: those lessons stay on FICO.
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PRIMARY_MAX_GRADE = 5;

// The subjects a coach can name for a grade 6-12 lesson. Keys are stored in visit_context.subject.
const SUBJECTS = [
  { key: 'english', label: 'English' },
  { key: 'urdu', label: 'Urdu' },
  { key: 'maths', label: 'Maths' },
  { key: 'science', label: 'Science', hint: 'General science, physics, chemistry, biology' },
  { key: 'social_studies', label: 'Social Studies' },
  { key: 'islamiat', label: 'Islamiat' },
  { key: 'computer', label: 'Computer' },
  { key: 'other', label: 'Other' },
];
const SUBJECT_KEYS = SUBJECTS.map((s) => s.key);

/**
 * Which tool a grade 6-12 lesson gets. FDE's pack names English & Urdu for VI-VIII and Maths & Science for VI-VII
 * and nothing for IX-XII. The gaps, as the operator approved them on 11 Nov 2026 (plan #94, choice A):
 *   - grade 8 Maths or Science → the Maths & Science tool (FDE prints VI-VII);
 *   - grades 9-12, and any other subject → the General form;
 *   - one tool per visit.
 * Data, so a change is one row.
 */
const ROUTES = [
  { grades: [6, 7, 8], subjects: ['english'], tool: 'enur', sheet: 'en' },
  { grades: [6, 7, 8], subjects: ['urdu'], tool: 'enur', sheet: 'ur' },
  { grades: [6, 7, 8], subjects: ['maths', 'science'], tool: 'msci', sheet: null },
];

const normGrade = (g) => {
  const n = Number(g);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
};
// The English & Urdu tool's sheet: 'ur' or 'en' (English is the default sheet). Not a language: the coach's language
// never chooses it, the lesson's subject does.
const SHEETS = ['en', 'ur'];
const normSheet = (s) => (SHEETS.includes(s) ? s : 'en');
const normSubject = (s) => {
  const k = String(s || '').trim().toLowerCase();
  return SUBJECT_KEYS.includes(k) ? k : null;
};

/**
 * The obs612 tool for a lesson, or null when the lesson is not a grade 6-12 one (grades 1-5 stay on FICO, and an
 * unknown grade decides nothing).
 * @returns {{tool: 'gen'|'msci'|'enur', rubricId: string, sheet: 'en'|'ur'|null}|null}
 */
function toolFor(grade, subject) {
  const g = normGrade(grade);
  if (g === null || g <= PRIMARY_MAX_GRADE) return null;
  const s = normSubject(subject);
  const route = ROUTES.find((r) => r.grades.includes(g) && s && r.subjects.includes(s));
  const tool = route ? route.tool : 'gen';
  return { tool, rubricId: TOOLS[tool].id, sheet: route ? route.sheet : null };
}

// ── what we call things (ours, not FDE's) ─────────────────────────────────────

// Short names for the report rows and option titles (≤ 30 characters); the full FDE wording sits behind each.
const SHORT = {
  msci: {
    i1: 'Written work checked',
    i2: 'Opening based on SLOs',
    i3: 'Command on the content',
    i4: 'Communication and delivery',
    i5: 'Student-centric, activities',
    i6: 'Supporting material',
    i7: 'Links to daily life',
    i8: 'Student assessment/questions',
    i9: 'Wrapping up the lesson',
    i10: 'Thinking outside the box',
    i11: 'Management, differentiation',
    students: '5 students checked',
  },
  tools: {
    gen: 'General form',
    msci: 'Maths & Science tool',
    enur: 'English & Urdu tool',
  },
};

/** The student check's levels in short words, for the report: what each level means in students. */
const STUDENTS_SHORT = ['0-1 of 5 understood', '2 of 5 understood', '3-4 of 5 understood', 'All 5 understood'];

// ── the items a form asks ─────────────────────────────────────────────────────

/** The English & Urdu sections a sheet uses ('en' has C, 'ur' has D). */
function enurSections(sheet) {
  const sh = normSheet(sheet);
  return TOOLS.enur.sections.filter((s) => s.sheets.includes(sh));
}

/**
 * Every scored item a visit's form must have, in form order: [{key, section, text, kind}] where kind is
 * 'yes_no' (gen), 'level' (msci, 0-3) or 'points' (enur, 1-4).
 */
function requiredItems(rubricId, sheet) {
  const tool = toolOf(rubricId);
  if (tool === 'gen') {
    return TOOLS.gen.sections.flatMap((s) => s.items.map((i) => ({ key: i.key, section: s.key, text: i.text, kind: 'yes_no' })));
  }
  if (tool === 'msci') {
    return [
      ...TOOLS.msci.indicators.map((i) => ({ key: i.key, section: i.stage, text: i.text, kind: 'level' })),
      { key: TOOLS.msci.student_check.key, section: 'Student Assessment', text: TOOLS.msci.student_check.instruction, kind: 'level' },
    ];
  }
  if (tool === 'enur') {
    return enurSections(sheet).flatMap((s) => s.items.map((i) => ({ key: i.key, section: s.key, text: i.text, kind: 'points' })));
  }
  return [];
}

const KIND_VALUES = {
  yes_no: ['yes', 'no'],
  level: ['0', '1', '2', '3'],
  points: ['1', '2', '3', '4'],
};

/** A stored answer in its canonical form ('yes'/'no', or the number as a string), else null. */
function normAnswer(kind, v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  return KIND_VALUES[kind] && KIND_VALUES[kind].includes(s) ? s : null;
}

/** The keys of required items with no valid answer. */
function missingItems(rubricId, sheet, answers = {}) {
  return requiredItems(rubricId, sheet).filter((i) => normAnswer(i.kind, answers[i.key]) === null).map((i) => i.key);
}

// ── the arithmetic ────────────────────────────────────────────────────────────

const round1 = (n) => Math.round(n * 10) / 10;

/** Section 7's band for a percentage (FDE prints the bands on a score; the operator approved them on the %). */
function bandFor(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const b = TOOLS.enur.bands.find((x) => pct >= x.from && pct < x.below) || TOOLS.enur.bands[TOOLS.enur.bands.length - 1];
  return { label: b.label, rating: b.rating, printed_range: b.printed_range };
}

/**
 * What a completed form adds up to, from the coach's answers. Pure. Unanswered items are left out of the sums and
 * listed in `missing` (a submitted form has none: the Flow requires every item).
 *
 *   gen   sections [{key, title, yes, of}], yes, of            (FDE gives no score: counts only)
 *   msci  indicators [{key, n, stage, level}], students       (FDE gives no total: none is made)
 *   enur  sections [{key, title, score, max}], total, max, pct, band
 */
function score(rubricId, sheet, answers = {}) {
  const tool = toolOf(rubricId);
  const a = answers || {};
  const missing = missingItems(rubricId, sheet, a);
  if (tool === 'gen') {
    const sections = TOOLS.gen.sections.map((s) => {
      const vals = s.items.map((i) => normAnswer('yes_no', a[i.key]));
      return { key: s.key, title: s.title, yes: vals.filter((v) => v === 'yes').length, of: s.items.length };
    });
    return {
      tool, rubric_id: rubricId, sheet: null, sections, missing,
      yes: sections.reduce((n, s) => n + s.yes, 0),
      of: sections.reduce((n, s) => n + s.of, 0),
    };
  }
  if (tool === 'msci') {
    const lv = (k) => { const v = normAnswer('level', a[k]); return v === null ? null : Number(v); };
    return {
      tool, rubric_id: rubricId, sheet: null, missing,
      indicators: TOOLS.msci.indicators.map((i) => ({ key: i.key, n: i.n, stage: i.stage, level: lv(i.key) })),
      students: lv(TOOLS.msci.student_check.key),
    };
  }
  if (tool === 'enur') {
    const sh = normSheet(sheet);
    const sections = enurSections(sh).map((s) => {
      const pts = s.items.map((i) => normAnswer('points', a[i.key])).filter((v) => v !== null).map(Number);
      return { key: s.key, title: s.title, section: s.section, score: pts.reduce((x, y) => x + y, 0), max: s.max };
    });
    const total = sections.reduce((n, s) => n + s.score, 0);
    const max = TOOLS.enur.sheets[sh].max;
    const pct = round1((total * 100) / max);
    return { tool, rubric_id: rubricId, sheet: sh, sections, missing, total, max, pct, band: bandFor(pct) };
  }
  return null;
}

/** The lowest-level M&S indicator (first in form order on a tie): where a development plan starts. */
function lowestIndicator(answers = {}) {
  let best = null;
  for (const i of TOOLS.msci.indicators) {
    const v = normAnswer('level', answers[i.key]);
    if (v === null) continue;
    if (!best || Number(v) < best.level) best = { key: i.key, n: i.n, level: Number(v) };
  }
  return best;
}

module.exports = {
  RUBRIC,
  FAMILY,
  LABEL,
  TOOLS,
  IDS,
  GRADES,
  PRIMARY_MAX_GRADE,
  SUBJECTS,
  SUBJECT_KEYS,
  ROUTES,
  SHORT,
  STUDENTS_SHORT,
  isObs612Id,
  toolOf,
  toolById,
  toolFor,
  normGrade,
  normSubject,
  normSheet,
  enurSections,
  requiredItems,
  normAnswer,
  missingItems,
  score,
  bandFor,
  lowestIndicator,
};
