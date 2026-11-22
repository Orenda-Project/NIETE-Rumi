'use strict';
/**
 * bd-zrdvmi.50.7 (q182) — FDE's thinking-level mix for a Grade 1-5 build-your-own paper. Pure: no I/O.
 *
 * Shares of MARKS in three bands (Apply takes Apply, Analyse/Evaluate and Create), the same table the exam
 * editor shows as "FDE target" (portal/src/portal/teacher/assessment/fdeLevelGuide.ts; a test keeps them equal).
 *   Grades 1-4: FDE Assessment Scheme 2023-24 and the per-subject Tables of Specification (Drive "Class-I..IV").
 *               A subject's own table wins; Maths tables give no headline split, so Maths takes the Scheme's.
 *   Grade 5:    the Table of Specifications printed per subject in FDE's GRADE V MODEL PAPERS CAE 2026.
 * FDE-format (pattern) papers carry their own `tos` per pattern and do not read this.
 * A grade/subject FDE gave no table for has no target (null), never a made-up one.
 *
 *   fdeTarget(grade, subject)  { Remember, Understand, Apply, source } | null
 *   targetLine(grade, subject) the sentence the writer is given, or '' when there is no target
 *   paperMix(examJson)         the paper's own mix by marks, { Remember, Understand, Apply, marks } | null
 */

const SCHEME = 'FDE Assessment Scheme 2023-24';
const TOS = 'FDE Table of Specification 2023-24';
const G5 = 'FDE Grade V model papers, CAE 2026';

const TABLE = {
  1: {
    maths: [[20, 50, 30], SCHEME], english: [[40, 40, 20], TOS], urdu: [[40, 40, 20], TOS],
    general_knowledge: [[40, 40, 20], TOS], islamiat: [[40, 40, 20], TOS],
  },
  2: {
    maths: [[20, 50, 30], SCHEME], english: [[40, 40, 20], TOS], urdu: [[40, 40, 20], TOS],
    general_knowledge: [[40, 40, 20], TOS], islamiat: [[40, 40, 20], TOS],
  },
  3: {
    maths: [[20, 50, 30], SCHEME], english: [[30, 30, 40], TOS], urdu: [[40, 30, 30], TOS],
    general_knowledge: [[41, 41, 18], TOS], islamiat: [[40, 30, 30], TOS],
  },
  4: {
    maths: [[10, 60, 30], SCHEME], english: [[30, 30, 40], TOS], urdu: [[30, 30, 40], TOS],
    science: [[30, 30, 40], TOS], social_studies: [[35, 30, 35], TOS], islamiat: [[40, 30, 30], TOS],
  },
  5: {
    maths: [[10, 50, 40], G5], science: [[30, 30, 40], G5], english: [[40, 30, 30], G5],
    urdu: [[30, 30, 40], G5], social_studies: [[30, 40, 30], G5], islamiat: [[40, 30, 30], G5],
  },
};

// The bot's own subject keys (assessment-generation CANON) and the request's spellings, onto the table's.
const ALIAS = {
  math: 'maths', mathematics: 'maths', eng: 'english', gensci: 'science', general_science: 'science',
  genk: 'general_knowledge', genk_en: 'general_knowledge', general_knowledge_en: 'general_knowledge',
  sst: 'social_studies', sst_en: 'social_studies', social_studies_en: 'social_studies',
};

function fdeTarget(grade, subject) {
  const key = String(subject ?? '').trim().toLowerCase();
  const n = typeof grade === 'number' ? grade : Number(String(grade ?? '').trim() || NaN);
  const hit = TABLE[n]?.[ALIAS[key] ?? key];
  if (!hit) return null;
  const [[r, u, a], source] = hit;
  return { Remember: r, Understand: u, Apply: a, source };
}

function targetLine(grade, subject) {
  const t = fdeTarget(grade, subject);
  if (!t) return '';
  return `• Thinking levels: across the whole paper, by marks, aim for Remember ${t.Remember}%, `
    + `Understand ${t.Understand}%, Apply ${t.Apply}% (Apply includes Analyze, Evaluate and Create) — `
    + `FDE's target for this grade and subject (${t.source}). Tag each question's blooms honestly to the `
    + 'thinking it asks for; reach the split by choosing what the questions ask, never by mislabelling them.';
}

const BAND = {
  remember: 'Remember', understand: 'Understand',
  apply: 'Apply', analyze: 'Apply', analyse: 'Apply', evaluate: 'Apply', create: 'Apply',
};

function eachItem(examJson, visit) {
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson?.[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (Array.isArray(list)) list.forEach((q) => q && typeof q === 'object' && q.removed !== true && visit(q));
      }
    }
  }
}

function paperMix(examJson) {
  const sum = { Remember: 0, Understand: 0, Apply: 0 };
  eachItem(examJson, (q) => {
    const band = BAND[String(q.blooms ?? '').trim().toLowerCase()];
    const m = Number(q.marks) || 0;
    if (band && m > 0) sum[band] += m;
  });
  const marks = sum.Remember + sum.Understand + sum.Apply;
  if (!marks) return null;
  const pct = (x) => Math.round((x / marks) * 100);
  return { Remember: pct(sum.Remember), Understand: pct(sum.Understand), Apply: pct(sum.Apply), marks };
}

module.exports = { fdeTarget, targetLine, paperMix, TABLE };
