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
 *                                                                  %, the total on FDE's 108-point scale, and
 *                                                                  Section 7's band on that 108-point score.
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
 *
 * bd-31ziu8 — a fourth tool, FICO-S v1.1 ('fico_s_v1_1', tool 'ficos'): "FICO for Secondary", the ICT HITL rubric for
 * grades 6-12 from 18 Nov (operator: "For 6 onwards all the way to 12, it is going to be FICO-S v1.1"), branched off
 * FICO17 v6 with FDE's Annex G mapped into it. Its text and arithmetic live in frameworks/fico-s; this module only
 * registers it, so the form row, the Flow endpoint, the record, the coach summary, the teacher report and the portal
 * serve it through the same doors as FDE's tools. 'obs612' here names the family (observation, grades 6-12), not FDE.
 * Which tool a lesson gets: toolFor(grade, subject, { ficoS }); FICO-S is on per observer behind fico_s_coach
 * (coaching/fico-s-switch.js) and only for an ICT visit, exactly as FDE's tools (coaching/fde-region.js).
 */

const fs = require('fs');
const path = require('path');

const FicoS = require('../fico-s');

const RUBRIC_FILE = path.join(__dirname, 'obs612.rubric.json');
const RUBRIC = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf8'));

const FAMILY = 'obs612';
// The label every FDE surface shows (operator 11 Nov ~18:45: framework + version only, no grade or subject). A FICO-S
// visit shows 'FICO-S v1.1': read a visit's label with labelOf(rubricId), never this constant.
const LABEL = RUBRIC.label; // 'FDE v1'
const FICO_S_TOOL = {
  id: FicoS.RUBRIC_KEY,
  title: FicoS.LABEL,
  subtitle: FicoS.RUBRIC.title,
  label: FicoS.LABEL,
  branched_from: FicoS.RUBRIC.branched_from,
};
const TOOLS = { ...RUBRIC.tools, ficos: FICO_S_TOOL };
const IDS = Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, t.id]));
// Every id a stored visit may carry: this version's tools, and every FICO-S version (queue #218: a v1.1 visit keeps
// 'fico_s_v1_1' after new ones are 'fico_s_v1_2'). Dispatchers key on these, never on IDS alone.
const KNOWN_IDS = [...new Set([...Object.values(IDS), ...FicoS.IDS])];
const ID_RX = /^obs612-(gen|msci|enur)-v(\d+)$/;

/** Is this string an obs612 rubric id (any version), or a FICO-S id (v1.1, v1.2)? */
function isObs612Id(id) {
  return typeof id === 'string' && (ID_RX.test(id) || FicoS.isFicoSId(id));
}

/** 'gen' | 'msci' | 'enur' | 'ficos' for a grade 6-12 rubric id, else null. */
function toolOf(id) {
  if (FicoS.isFicoSId(id)) return 'ficos';
  const m = ID_RX.exec(String(id || ''));
  return m ? m[1] : null;
}

/** Is this a FICO-S id (tool 'ficos')? */
const isFicoS = (id) => FicoS.isFicoSId(id);

/** The label a visit on this rubric shows: 'FICO 6-12' (v1.1), 'FICO 6-12 v1.2' or 'FDE v1'; null for an id this module does not know. */
function labelOf(id) {
  if (FicoS.isFicoSId(id)) return FicoS.labelOf(id);
  return ID_RX.test(String(id || '')) ? LABEL : null;
}

/** The tool definition for a rubric id (this version's), else null. FICO-S: either version, with its own id and label. */
function toolById(id) {
  const t = toolOf(id);
  if (t === 'ficos') return { ...FICO_S_TOOL, id, title: FicoS.labelOf(id), label: FicoS.labelOf(id) };
  return t && TOOLS[t] && TOOLS[t].id === id ? TOOLS[t] : null;
}

// ── which tool a lesson gets ──────────────────────────────────────────────────

// The class a coach can name. 1-5 is one choice: those lessons stay on FICO.
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PRIMARY_MAX_GRADE = 5;
// bd-ra8xu.40 (operator, 12 Nov ~11:00): "For 9-12, we continue with FICO v3 right now and v6 when we turn v6 on for
// 1-5. This FDE ones only apply to 6 7 8." FDE's tools are for grades 6-8; grades 1-5 and 9-12 follow the FICO coach
// switch.
const FDE_GRADES = [6, 7, 8];
const isFdeGrade = (g) => FDE_GRADES.includes(Number(g));
// bd-31ziu8 (operator 18 Nov): FICO-S v1.1 is every ICT grade from 6 to 12.
const FICO_S_GRADES = FicoS.GRADES.slice();
const isFicoSGrade = (g) => FICO_S_GRADES.includes(Number(g));

// The subjects a coach can name for a grade 6-8 lesson (FDE's grades). Keys are stored in visit_context.subject.
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
 * Which tool a grade 6-8 lesson gets. FDE's pack names English & Urdu for VI-VIII and Maths & Science for VI-VII.
 * As the operator approved them (plan #94 choice A, 11 Nov; narrowed 12 Nov ~11:00 to grades 6-8):
 *   - grade 8 Maths or Science → the Maths & Science tool (FDE prints VI-VII);
 *   - any other subject → the General form;
 *   - grades 9-12 → no FDE tool: FICO, as grades 1-5;
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
 * The grade 6-12 tool for a lesson, or null when the lesson stays on FICO (grades 1-5 always; grades 9-12 unless
 * FICO-S is on; an unknown grade decides nothing).
 *   ficoS on (the observer's fico_s_coach switch, ICT visit): grades 6-12 → FICO-S v1.1, whatever the subject.
 *   ficoS off: grades 6-8 → FDE's tool for the subject (as before); grades 9-12 → null (FICO).
 * @param {{ficoS?: boolean}} [opts]
 * @returns {{tool: 'gen'|'msci'|'enur'|'ficos', rubricId: string, sheet: 'en'|'ur'|null}|null}
 */
function toolFor(grade, subject, { ficoS = false } = {}) {
  const g = normGrade(grade);
  if (g !== null && ficoS && isFicoSGrade(g)) return { tool: 'ficos', rubricId: FICO_S_TOOL.id, sheet: null };
  if (g === null || !isFdeGrade(g)) return null;
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
    ficos: 'FICO 6-12',
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
  if (tool === 'ficos') {
    // Every indicator's level (N/A where the form's version offers it: v1.1 C2; v1.2 C2, C3) and its evidence line
    // (frameworks/fico-s EVIDENCE_MIN).
    const na = FicoS.naCodes(rubricId);
    return FicoS.CODES.flatMap((c) => {
      const ind = FicoS.indicator(c);
      return [
        { key: c, section: ind.section, text: ind.name, kind: na.includes(c) ? 'fico_s_na' : 'fico_s' },
        { key: `ev_${c}`, section: ind.section, text: ind.name, kind: 'evidence' },
      ];
    });
  }
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
  fico_s: ['1', '2', '3', '4'],
  fico_s_na: ['1', '2', '3', '4', 'na'],
};

/**
 * A stored answer in its canonical form ('yes'/'no', the number as a string, FICO-S 'NA'), else null. kind 'evidence'
 * is the observer's written evidence for a FICO-S level: the trimmed text when it counts (frameworks/fico-s).
 */
function normAnswer(kind, v) {
  if (v === undefined || v === null) return null;
  if (kind === 'evidence') return FicoS.isEvidence(v) ? String(v).trim() : null;
  const s = String(v).trim().toLowerCase();
  if (!(KIND_VALUES[kind] && KIND_VALUES[kind].includes(s))) return null;
  return s === 'na' ? 'NA' : s;
}

/** The keys of required items with no valid answer. */
function missingItems(rubricId, sheet, answers = {}) {
  return requiredItems(rubricId, sheet).filter((i) => normAnswer(i.kind, answers[i.key]) === null).map((i) => i.key);
}

// ── the arithmetic ────────────────────────────────────────────────────────────

const round1 = (n) => Math.round(n * 10) / 10;

// Section 7's own scale: FDE prints its bands on a 108-point score (90-108, 70-89, 50-69, below 50).
const BAND_SCALE_MAX = TOOLS.enur.band_scale_max || 108;

/** A lesson's total on FDE's 108-point scale: total × 108 ÷ the sheet's total (148 English, 156 Urdu), one decimal. */
function scoreOn108(total, max) {
  if (!Number.isFinite(total) || !Number.isFinite(max) || max <= 0) return null;
  return round1((total * BAND_SCALE_MAX) / max);
}

/**
 * Section 7's band for a score on FDE's 108-point scale (operator 13 Nov 2026: compute against the lesson's real total
 * and scale it to 108). Read with the full decimal, so 89.9 is Proficient and 90.0 Excellent.
 */
function bandFor(score108) {
  if (typeof score108 !== 'number' || !Number.isFinite(score108)) return null;
  const b = TOOLS.enur.bands.find((x) => score108 >= x.from && score108 < x.below) || TOOLS.enur.bands[TOOLS.enur.bands.length - 1];
  return { label: b.label, rating: b.rating, printed_range: b.printed_range };
}

/**
 * What a completed form adds up to, from the coach's answers. Pure. Unanswered items are left out of the sums and
 * listed in `missing` (a submitted form has none: the Flow requires every item).
 *
 *   gen   sections [{key, title, yes, of}], yes, of            (FDE gives no score: counts only)
 *   msci  indicators [{key, n, stage, level}], students       (FDE gives no total: none is made)
 *   enur  sections [{key, title, score, max}], total, max, pct, score_108 (Section 7's scale), band (on score_108)
 */
function score(rubricId, sheet, answers = {}) {
  const tool = toolOf(rubricId);
  const a = answers || {};
  const missing = missingItems(rubricId, sheet, a);
  if (tool === 'ficos') {
    // frameworks/fico-s: section averages, overall % and band (the sheet's arithmetic). `missing` names levels and
    // evidence alike; the levels' own list is r.missing_levels.
    const r = FicoS.score(Object.fromEntries(FicoS.CODES.map((c) => [c, a[c]])), rubricId);
    return { ...r, tool, rubric_id: rubricId, sheet: null, missing, missing_levels: r.missing };
  }
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
    const on108 = scoreOn108(total, max);
    return { tool, rubric_id: rubricId, sheet: sh, sections, missing, total, max, pct, score_108: on108, band: bandFor(on108) };
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
  labelOf,
  isFicoS,
  FICO_S_TOOL,
  FICO_S_GRADES,
  isFicoSGrade,
  TOOLS,
  IDS,
  KNOWN_IDS,
  GRADES,
  PRIMARY_MAX_GRADE,
  FDE_GRADES,
  isFdeGrade,
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
  scoreOn108,
  BAND_SCALE_MAX,
  lowestIndicator,
};
