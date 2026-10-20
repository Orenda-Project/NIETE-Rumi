'use strict';
/**
 * Parse one tab of the G1-5 curriculum matrix (2-D array of cell strings) into day rows.
 * Pure: no I/O. Grades above 5 (the 6-12 samples appended to the Science tab) are dropped.
 *
 * DayRow = {grade, chapter, chapterTitle, day, seg, lpType, topic, skillType, cpa, section,
 *           pages:number[], sloCodes:string[], sloDescriptions:string[]}
 */
const SUBJECTS = ['english', 'urdu', 'maths', 'science'];
const MAX_GRADE = 5;
const COLUMNS = {
  day: 'Day#', seg: 'Seg', lpType: 'LP Type', topic: 'Topic', skillType: 'Skill Type', cpa: 'CPA',
  section: 'Section', pages: 'Pages', sloCodes: 'SLO Codes', sloDescriptions: 'SLO Description',
};
const GRADE_ROW = /^GRADE\s+(\d+)\b/i;
const BANNER_ROW = /^G(\d+)\s*[—–-]/; // e.g. "G7 — GENERAL SCIENCE · 6-12 v8 SAMPLES": not a GRADE row, but starts a new grade block
const CHAPTER_ROW = /^Ch\s*(\d+)\s*:\s*(.*)$/i;
const DAY_CELL = /^\d+$/;

const cell = (row, i) => (row[i] == null ? '' : String(row[i]).trim());
const splitList = (s, sep) => s.split(sep).map((x) => x.trim()).filter(Boolean);

function findHeader(values) {
  for (let i = 0; i < values.length; i++) {
    const names = (values[i] || []).map((c) => String(c == null ? '' : c).trim());
    if (names.includes(COLUMNS.day) && names.includes(COLUMNS.topic) && names.includes(COLUMNS.pages)) {
      const idx = {};
      for (const [key, name] of Object.entries(COLUMNS)) idx[key] = names.indexOf(name);
      return { at: i, idx };
    }
  }
  throw new Error('matrix header row (Day#, Seg, LP Type, Topic, ...) not found');
}

function parseMatrixTab(values, subject) {
  if (!SUBJECTS.includes(subject)) throw new Error(`unknown subject "${subject}"`);
  const { at, idx } = findHeader(values);
  const out = [];
  let grade = null;
  let chapter = null;
  for (let i = at + 1; i < values.length; i++) {
    const row = values[i] || [];
    const first = cell(row, 0);
    if (!first) continue;
    const g = first.match(GRADE_ROW) || first.match(BANNER_ROW);
    if (g) { grade = Number(g[1]); chapter = null; continue; }
    const c = first.match(CHAPTER_ROW);
    if (c) { chapter = { number: Number(c[1]), title: c[2].trim() }; continue; }
    if (!DAY_CELL.test(first)) continue; // notes, section banners
    if (grade !== null && grade > MAX_GRADE) continue;
    if (grade === null || chapter === null) {
      throw new Error(`matrix row ${i + 1}: day row before any ${grade === null ? 'GRADE' : 'chapter'} header`);
    }
    const f = (k) => cell(row, idx[k]);
    out.push({
      grade, chapter: chapter.number, chapterTitle: chapter.title,
      day: Number(f('day')), seg: Number(f('seg')),
      lpType: f('lpType'), topic: f('topic'), skillType: f('skillType'), cpa: f('cpa'), section: f('section'),
      pages: splitList(f('pages'), ',').map(Number).filter(Number.isFinite),
      sloCodes: splitList(f('sloCodes'), ','),
      sloDescriptions: splitList(f('sloDescriptions'), ' / '),
    });
  }
  return out;
}

module.exports = { parseMatrixTab };
