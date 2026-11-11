/**
 * FICO17 v6: what the coach's brief and the teacher's report say (spec §9.3; FICO6 lane `report`).
 *
 * For a visit stamped 'fico17_v6':
 * - every indicator is named by its v6 name, never a code, and the hidden transcript-only result (dc_result) never shows;
 * - NA is left out; IE is one line ("The recording didn't cover this part of the lesson.") and no level, never in a total;
 * - "work on first" never lands on an NA or IE row, nor on the coach-facing focus text for one;
 * - a broken transcript (observe2 transcript_quality.status 'broken') shows no level from the recording, one line
 *   saying so, and still the six levels the coach set in the room;
 * - totals are over numeric levels only, with the denominator (judged rows × 4);
 * - the teacher report stays out of a send until the six coach levels exist (held).
 * A v5 visit reads exactly as before: report-v5-golden.json pins its output at origin/sandbox afeab2a69b.
 *
 * Real: brief, focus-areas, analysis, the report transformer, the v6 rubric, the DC teacher report. Nothing here
 * touches the database or WhatsApp; the logger is the only mock.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { focusSeen } = require('../../bot/shared/services/observe/observe2/focus-areas');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { PRIORITY, ROW } = require('../../bot/shared/services/observe/observe2/fico17');
const { transformFICOToReportData } = require('../../bot/shared/services/coaching/report-transformers/fico-report-transformer');
const { FORMS, CALLS } = require('./fixtures/report-v5-forms');
const GOLDEN = require('./fixtures/report-v5-golden.json');

const IE_LINE = "The recording didn't cover this part of the lesson.";
const BROKEN_LINE = "The recording couldn't be used, so this report has no levels from it.";
const SESSION = { id: 's', created_at: '2026-11-11T05:00:00Z' };
const LEVELS = { C1: '4', C2: '4', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: 'IE', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
const CODE = /\b[CDF][1-8]\b/;

// A checked v6 record as the check endpoint leaves it: scalar final_levels, the per-code record in v6_levels.
function v6Form({ levels = LEVELS, priority = 'C5', also = [], quality = null } = {}) {
  const v6Levels = {};
  for (const c of V6.COMBINED_CODES) v6Levels[c] = { level: levels[c], because: 'What I saw from the back of the room.', source: 'coach', set_by: 'coach', dc_result: c === 'D2' ? null : 2 };
  return {
    id: 'form-v6', rubric_version: 'fico17_v6', period_minutes: 40,
    answers: { lp: 'none', priority },
    final_levels: { ...levels },
    rumi_moments: { moments: [], ...(quality ? { transcript_quality: quality } : {}) },
    evidence_review: { priority_final: priority, also_final: also, v6_levels: v6Levels },
  };
}
const report = (form) => transformFICOToReportData(SESSION, 'Teacher A', buildAnalysis(form));
const criteria = (r) => r.goals.flatMap((g) => g.criteria);
const S = observe2Strings('en');

describe('v6 names, never codes, never dc_result', () => {
  test('brief: strengths are named by the v6 name', () => {
    const brief = buildBrief(v6Form());
    expect(brief).toContain(`• ${V6.indicator('C1').name}: ${V6.TITLES.C1[3]}`);
    expect(brief).not.toContain(ROW.C1);
    expect(brief).not.toMatch(CODE);
  });
  test('brief: the hidden dc_result never shows (D4 coach 3, dc_result 2)', () => {
    const brief = buildBrief(v6Form());
    expect(brief).toContain(V6.TITLES.D4[2].toLowerCase());
    expect(brief).not.toContain(V6.TITLES.D4[1].toLowerCase());
    expect(brief).not.toContain('dc_result');
  });
  test('analysis rows carry the v6 name for every code', () => {
    const a = buildAnalysis(v6Form());
    for (const key of ['high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']) {
      for (const ind of a.domains[key].indicators) expect(ind.name).toBe(V6.indicator(ind.id).name);
    }
  });
  test('teacher report rows: the v6 name with no code in front', () => {
    const names = criteria(report(v6Form())).map((c) => c.name);
    expect(names).toContain(V6.indicator('C5').name);
    for (const n of names) expect(n).not.toMatch(CODE);
  });
  test('focus text names the indicator by its v6 name (wait time reads C1 and D1)', () => {
    const seen = focusSeen(v6Form(), 'wait', S);
    expect(seen).toContain(`${V6.indicator('C1').name.toLowerCase()}: ${V6.TITLES.C1[3].toLowerCase()}`);
    expect(seen).not.toContain(ROW.C1.toLowerCase());
  });
});

describe('NA left out, IE one line and never counted', () => {
  test('brief: C7 (NA) is not mentioned; D3 (IE) is the one line, once', () => {
    const brief = buildBrief(v6Form());
    expect(brief).not.toContain(V6.indicator('C7').name);
    const lines = brief.split('\n').filter((l) => l.includes(V6.indicator('D3').name));
    expect(lines).toEqual([`• ${V6.indicator('D3').name}: ${IE_LINE}`]);
  });
  test('brief: NA and IE never reach "went well", even at the top of the list', () => {
    const brief = buildBrief(v6Form({ levels: { ...LEVELS, C1: 'NA', C2: 'IE' } }));
    const well = brief.split('Start with what went well:')[1].split('\n\n')[0];
    expect(well).not.toContain(V6.indicator('C1').name);
    expect(well).not.toContain(V6.indicator('C2').name);
  });
  test('teacher report: NA and IE rows are out, and out of the totals', () => {
    const r = report(v6Form());
    const names = criteria(r).map((c) => c.name);
    expect(names).not.toContain(V6.indicator('C7').name);
    expect(names).not.toContain(V6.indicator('D3').name);
    const d = r.goals.find((g) => g.title.startsWith('Section D'));
    expect(d.maxScore).toBe(4 * 4); // D1 D2 D4 D5 judged; D3 (IE) is not
    expect(d.score).toBe(3 + 4 + 3 + 2);
  });
  test('teacher report: the IE rows are listed as the one line, without a score', () => {
    const r = report(v6Form());
    expect(r.recordingGaps).toEqual([{ name: V6.indicator('D3').name, line: IE_LINE }]);
  });
  test('"work on first" skips an NA pick: the next pick that has a level takes its place', () => {
    const brief = buildBrief(v6Form({ priority: 'C7', also: ['D4', 'wait'] }));
    expect(brief).toContain(`Work on first: *${PRIORITY.D4}*`);
    expect(brief).not.toContain(PRIORITY.C7);
    expect(brief).toContain('Also work on: *Wait time after a question*');
  });
  test('"work on first" skips an IE pick too', () => {
    const brief = buildBrief(v6Form({ priority: 'D3', also: ['C1'] }));
    expect(brief).toContain(`Work on first: *${PRIORITY.C1}*`);
    expect(brief).not.toContain(PRIORITY.D3);
  });
  test('an NA or IE "also" pick is dropped', () => {
    const brief = buildBrief(v6Form({ priority: 'C1', also: ['C7', 'D3'] }));
    expect(brief).not.toContain('Also work on');
  });
});

describe('a broken transcript: no level from the recording, one line, the six coach levels still shown', () => {
  const broken = () => v6Form({ quality: { status: 'broken', coverage: 0.3, issues: [{ type: 'loop', from: '12:00', to: '40:00' }] } });
  const brokenAnalysis = () => {
    const a = buildAnalysis(broken());
    a.observe2.transcript_quality = { status: 'broken', coverage: 0.3, issues: [] };
    return a;
  };
  test('brief: the one line, once; no DC level; the coach levels are there', () => {
    const brief = buildBrief(broken());
    expect(brief.split('\n').filter((l) => l === BROKEN_LINE)).toHaveLength(1);
    for (const c of V6.DC_CODES) expect(brief).not.toContain(V6.indicator(c).name);
    expect(brief).toContain(`• ${V6.indicator('D2').name}: ${V6.TITLES.D2[3]}`);
    expect(brief).toContain(V6.TITLES.D4[2].toLowerCase()); // children's thinking keeps D4 (a coach level)
    expect(brief).not.toContain(IE_LINE);
  });
  test('brief: "work on first" on a DC row moves to a coach row', () => {
    const f = broken();
    f.evidence_review.priority_final = 'C1';
    f.evidence_review.also_final = ['C5'];
    const brief = buildBrief(f);
    expect(brief).toContain(`Work on first: *${PRIORITY.C5}*`);
    expect(brief).not.toContain(PRIORITY.C1);
  });
  test('focus text reads no DC level (wait time is C1 and D1: nothing)', () => {
    expect(focusSeen(broken(), 'wait', S)).toBe('');
    expect(focusSeen(broken(), 'rules', S)).toContain(V6.TITLES.C5[1].toLowerCase()); // C5 is the coach's
  });
  test('teacher report: only the six coach rows, the line, totals over them', () => {
    const r = transformFICOToReportData(SESSION, 'Teacher A', brokenAnalysis());
    const names = r.goals.filter((g) => !g.title.startsWith('Section B')).flatMap((g) => g.criteria.map((c) => c.name));
    const coach = V6.COMBINED_CODES.filter((c) => /^[1-4]$/.test(LEVELS[c])).map((c) => V6.indicator(c).name);
    expect(names.sort()).toEqual(coach.sort());
    expect(r.recordingNote).toBe(BROKEN_LINE);
    const c = r.goals.find((g) => g.title.startsWith('Section C'));
    expect(c).toMatchObject({ score: 3 + 2, maxScore: 2 * 4 }); // C3 C5; C7 is NA
  });
});

describe('totals over numeric levels only, with the denominator', () => {
  test('a v6 section with nothing judged is 0 of 0, never 0 of its full size', () => {
    const levels = { ...LEVELS, F1: 'NA', F2: 'IE', F3: 'NA', F4: 'IE' };
    const r = report(v6Form({ levels }));
    expect(r.goals.find((g) => g.title.startsWith('Section F'))).toMatchObject({ score: 0, maxScore: 0, criteria: [] });
  });
  test('the report total is the sum of the sections, out of the judged rows × 4 (plus Section B as scored)', () => {
    const r = report(v6Form());
    expect(r.totalScore).toBe(r.goals.reduce((s, g) => s + g.score, 0));
    expect(r.maxScore).toBe(r.goals.reduce((s, g) => s + g.maxScore, 0));
    const judged = Object.values(LEVELS).filter((v) => /^[1-4]$/.test(v)).length;
    const rubricMax = r.goals.filter((g) => !g.title.startsWith('Section B')).reduce((s, g) => s + g.maxScore, 0);
    expect(rubricMax).toBe(judged * 4);
    expect(V6.totals(LEVELS)).toMatchObject({ max: judged * 4, counted: judged });
  });
});

describe('the teacher report is held until the six coach levels exist', () => {
  test('a combined code with no level → held, no rubric rows', () => {
    const r = report(v6Form({ levels: { ...LEVELS, D4: '' } }));
    expect(r.held).toBe(true);
    expect(r.goals.filter((g) => !g.title.startsWith('Section B'))).toEqual([]);
  });
  test('all six set (NA and IE count as set) → not held', () => {
    expect(report(v6Form()).held).toBe(false);
  });
});

describe('the DC teacher report (built, not wired: RULINGS R12)', () => {
  const dc = () => {
    const out = {};
    for (const c of V6.DC_CODES) out[c] = { result: 3, because: 'x', evidence: [] };
    out.F1 = { result: 'IE' };
    out.C2 = { result: 'NA' };
    return out;
  };
  test('IE is the one line, not a level', () => {
    const r = buildTeacherReport(dc());
    expect(r.text).toContain(`${V6.indicator('F1').name}: ${IE_LINE}`);
    expect(r.rows.find((x) => x.code === 'F1')).toMatchObject({ result: 'IE', line: `${V6.indicator('F1').name}: ${IE_LINE}` });
  });
  test('broken transcript: no level at all, the one line, still the coach line', () => {
    const r = buildTeacherReport(dc(), { transcriptQuality: { status: 'broken', coverage: 0.2, issues: [] } });
    expect(r.rows).toEqual([]);
    expect(r.text).toContain(BROKEN_LINE);
    for (const c of V6.DC_CODES) expect(r.text).not.toContain(V6.indicator(c).name);
    // bd-ra8xu.41 (operator 11 Nov ~17:50): the six are shown with evidence, not one line; a broken recording has
    // no evidence, so they are named as the coach's.
    expect(r.text).toContain('Combined indicators, set by your coach in the room');
  });
  test('a partial transcript still reports its levels', () => {
    const r = buildTeacherReport(dc(), { transcriptQuality: { status: 'partial', coverage: 0.7, issues: [] } });
    expect(r.rows.length).toBe(10);
  });
});

describe('v5 reads exactly as before (golden captured at origin/sandbox afeab2a69b)', () => {
  test.each(CALLS.map(([k, o], i) => [i, k, o]))('brief %i (%s %j)', (i, k, opts) => {
    expect(buildBrief(FORMS[k], opts)).toBe(GOLDEN.briefs[i].text);
  });
  test.each(Object.keys(FORMS))('focus text, analysis and teacher report: %s', (k) => {
    for (const lang of ['en', 'ur']) {
      for (const id of ['wait', 'manage', 'rules', 'warmup', 'close']) {
        expect(focusSeen(FORMS[k], id, observe2Strings(lang))).toBe(GOLDEN.focus[k][`${lang}:${id}`]);
      }
    }
    const a = buildAnalysis(FORMS[k]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(GOLDEN.analyses[k]));
    expect(JSON.stringify(transformFICOToReportData(SESSION, 'Teacher A', a))).toBe(JSON.stringify(GOLDEN.reports[k]));
  });
});
