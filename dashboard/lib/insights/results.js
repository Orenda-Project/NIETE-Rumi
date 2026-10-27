'use strict';
/**
 * Stage 6b, child-result cells (NIGHTLY_JOB §4 stage 6b; FICO_CROSSWALK §2 rows W-LN..W-NUM; DESIGN §4): one
 * coachip_result_cells row per (school, grade, language, W) for the term to date. Scores only: no child, teacher or
 * coach id leaves this function. Completed sessions only, test accounts skipped, one test per child (the latest).
 * Under 5 tested → insufficient. Subtasks the contract gives no bar for → not_graded; gaps → not_measured.
 */
const C = require('./constants');

const FLOOR = 5;
const BAR_SHARE = 0.5; // "below bar when correct share <= 50%" (W-LN, W-LS, W-FW, W-DEC, W-SPELL)

// Task id → EGRA/EGMA code (x-data C_student_results §1; the RDF set and the full battery's task ids).
const TASKS = [
  { code: 'E3', re: /^(ur|en)\.letter_names/ },
  { code: 'E4', re: /^(ur|en)\.letter_sounds/ },
  { code: 'E8', re: /^(ur|en)\.words/ },
  { code: 'E9', re: /^(ur|en)\.nonwords/ },
  { code: 'E11', re: /^(ur|en)\.story_comp/ },
  { code: 'E10', re: /^(ur|en)\.story(_w\d+)?$/ },
  { code: 'E14', re: /^(ur|en)\.(spelling|dictation)/ },
  { code: 'M', re: /^ma\./ },
];

function codeOf(task) {
  for (const t of TASKS) if (t.re.test(task)) return t.code;
  return null;
}
function languageOf(task) {
  const p = String(task).split('.')[0];
  return p === 'ur' || p === 'en' ? p : p === 'ma' ? 'maths' : null;
}

function resultOf(block) {
  const list = Array.isArray(block.responses) ? block.responses : [];
  const r = list.find((x) => x && x.kind === 'result');
  if (!r || typeof r.correct !== 'number') return null;
  const attempted = typeof r.attempted === 'number' ? r.attempted : null;
  // Nothing attempted reads as 0 correct (a child who could not start is below the bar).
  return { share: attempted ? r.correct / attempted : 0 };
}

const below = (res) => res.share <= BAR_SHARE;

// Per W: which language cells it exists in and how a child is judged. `grade` null = no bar in the contract.
const WS = [
  { w: 'W-LN', langs: ['ur', 'en'], needs: ['E3'], judge: (c) => below(c.E3) },
  { w: 'W-LS', langs: ['en'], gap: ['ur'], needs: ['E4'], judge: (c) => below(c.E4) },
  { w: 'W-FW', langs: ['ur', 'en'], needs: ['E8'], judge: (c) => below(c.E8) },
  { w: 'W-DEC', langs: ['ur', 'en'], needs: ['E9', 'E8'], judge: (c) => below(c.E9) && !below(c.E8) },
  { w: 'W-ORF', langs: ['ur', 'en'], needs: ['E10'], judge: null },
  { w: 'W-RC', langs: ['ur', 'en'], needs: ['E11'], judge: null },
  { w: 'W-SPELL', langs: ['en'], gap: ['ur'], needs: ['E14'], judge: (c) => below(c.E14) },
  { w: 'W-NUM', langs: ['maths'], needs: ['M'], judge: null },
];

function termStartOf(term) {
  const s = typeof term === 'string' ? term : term && term.start;
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('buildResultCells: term start must be YYYY-MM-DD');
  return s;
}

/**
 * buildResultCells({ sessions, blocks, testAccountIds, term, jobRunId, computedAt, graderModel?, mathsLanguage? })
 * sessions: child_test_sessions rows; blocks: child_test_blocks rows (scores only); term: 'YYYY-MM-DD' or {start, end?}.
 */
function buildResultCells({ sessions, blocks, testAccountIds, term, jobRunId, computedAt, graderModel, mathsLanguage }) {
  const termStart = termStartOf(term);
  const startMs = Date.parse(`${termStart}T00:00:00+05:00`);
  const endMs = term && term.end ? Date.parse(`${term.end}T23:59:59.999+05:00`) : Infinity;
  const tests = new Set(testAccountIds || []);
  const mathsLang = mathsLanguage === 'ur' ? 'ur' : 'en';

  // The latest completed session per child in the term.
  const latest = new Map();
  for (const s of sessions || []) {
    if (!s || s.status !== 'completed' || tests.has(s.coach_user_id) || !s.school_id) continue;
    const g = Number(s.grade);
    if (!Number.isInteger(g) || g < 1 || g > 5) continue;
    const t = Date.parse(s.started_at || s.created_at);
    if (!Number.isFinite(t) || t < startMs || t > endMs) continue;
    const childKey = s.student_id || s.id;
    const prev = latest.get(childKey);
    if (!prev || t > prev.t) latest.set(childKey, { s, t, g });
  }
  const kept = new Map([...latest.values()].map((x) => [x.s.id, x]));

  // Per session: { lang: { code: result } }.
  const scores = new Map();
  for (const b of blocks || []) {
    if (!b || !kept.has(b.session_id) || typeof b.block !== 'string') continue;
    const code = codeOf(b.block); const lang = languageOf(b.block);
    const res = code && lang ? resultOf(b) : null;
    if (!res) continue;
    if (!scores.has(b.session_id)) scores.set(b.session_id, {});
    const per = scores.get(b.session_id);
    if (!per[lang]) per[lang] = {};
    per[lang][code] = res;
  }

  // Cells: (school, grade, language) → children's code maps.
  const cells = new Map();
  for (const [sid, per] of scores) {
    const { s, g } = kept.get(sid);
    for (const lang of Object.keys(per)) {
      const k = `${s.school_id}|${g}|${lang}`;
      if (!cells.has(k)) cells.set(k, { school_id: s.school_id, grade: g, lang, children: [] });
      cells.get(k).children.push(per[lang]);
    }
  }

  const rows = [];
  const row = (cell, w, tested, numerator, status) => ({
    school_id: cell.school_id, grade: cell.grade, language: cell.lang === 'maths' ? mathsLang : cell.lang, w_id: w,
    term_start: termStart, tested, numerator, status, grader_model: graderModel || 'sa-battery', framework_version: 'egra',
    pipeline_version: C.PIPELINE_VERSION, job_run_id: jobRunId, computed_at: computedAt,
  });
  const keys = [...cells.keys()].sort();
  for (const k of keys) {
    const cell = cells.get(k);
    for (const spec of WS) {
      if (spec.gap && spec.gap.includes(cell.lang)) {
        const tried = cell.children.filter((c) => spec.needs.every((n) => c[n])).length;
        if (tried) rows.push(row(cell, spec.w, tried, null, 'not_measured'));
        continue;
      }
      if (!spec.langs.includes(cell.lang)) continue;
      const tested = cell.children.filter((c) => spec.needs.every((n) => c[n]));
      if (!tested.length) continue;
      if (!spec.judge) { rows.push(row(cell, spec.w, tested.length, null, 'not_graded')); continue; }
      if (tested.length < FLOOR) { rows.push(row(cell, spec.w, tested.length, null, 'insufficient')); continue; }
      rows.push(row(cell, spec.w, tested.length, tested.filter(spec.judge).length, 'ok'));
    }
  }
  return rows;
}

module.exports = { buildResultCells, codeOf };
