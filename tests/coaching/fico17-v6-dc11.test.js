'use strict';
/**
 * Queue #282 — the Digital Coach on a teacher's own recording scores FICO17 v6 with ONLY the 11 indicators it can set
 * (C1 C2 C4 C6 C8 D1 D5 F1 F2 F3 F4). The operator, 25 Nov: "lets get DC live for Islamabad on Fico v6, with just the
 * 11 indicators". The six combined ones (C3 C5 C7 D2 D3 D4) are not asked of the model at all, not stored, and not in
 * her report: no level, no evidence, no student-turn count, no row.
 *
 *   dc11Variant()    the scorer: a prompt with the 11 level blocks and nothing else; a reply that brings anything for
 *                    the six is refused; the stored analysis has no row, no evidence and no count for them.
 *   shadow.start     every self-recording read ('shadow' or 'v6') goes through dc11Variant.
 *   teacherFacing    a dc11 read becomes a report analysis with the 11 rows only, stamped indicator_set 'dc11'.
 *   grade gate       'v6' reaches a recording of grades 1-5 (the operator, 11 Nov: "for primary, both HITL and DC is
 *                    FICO v6"). Grades 6-12 are not decided for the DC: they stay V3 unless app_settings.fico_dc_grades
 *                    says 'all' for that teacher. An unknown grade goes by the teacher's band: PRIMARY only → v6;
 *                    anything else stays V3 (in doubt nothing moves).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));

let mockSettings = {};
let mockUsers = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _t: table, _id: null };
    q.select = () => q;
    q.eq = (col, v) => { if (col === 'id') q._id = v; return q; };
    q.in = () => q;
    q.maybeSingle = async () => ({ data: q._t === 'users' ? (mockUsers[q._id] || null) : null, error: null });
    q.then = (res) => res({
      data: q._t === 'app_settings' ? Object.entries(mockSettings).map(([key, value]) => ({ key, value })) : [],
      error: null,
    });
    return q;
  },
}));

let mockReply = null;
let mockSeenFramework = null;
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(async (_t, _m, _lp, fw) => {
    mockSeenFramework = fw;
    return { analysis: JSON.parse(JSON.stringify(mockReply)), usage: { cost: 0.01 } };
  }),
}));

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const shadow = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');

const SIX = ['C3', 'C5', 'C7', 'D2', 'D3', 'D4'];
const ELEVEN = ['C1', 'C2', 'C4', 'C6', 'C8', 'D1', 'D5', 'F1', 'F2', 'F3', 'F4'];
const TRANSCRIPT = [
  '[00:10] Teacher (ur): Ali, what is half of ten?',
  '[00:15] Student (ur): Five.',
  '[05:00] Teacher (ur): Why is it five?',
  '[05:05] Student (ur): Because two fives make ten.',
  '[30:00] Student (ur): I agree.',
].join('\n');

function elevenReply() {
  const levels = {};
  for (const c of ELEVEN) levels[c] = { result: 3, because: 'heard it', evidence: [{ time: '00:15', quote: 'Five.' }] };
  levels.C2 = { result: 'NA', because: 'no wrong answer', evidence: [] };
  return { rubric: 'fico17_v6', levels };
}

beforeEach(() => {
  mockSettings = {};
  mockUsers = {};
  mockReply = elevenReply();
  mockSeenFramework = null;
  Switch._resetCache();
});

describe('dc11Variant — the scorer asks, keeps and adds up the 11 only', () => {
  const dc11 = fw.dc11Variant();

  test('the DC codes are exactly the 11 and the combined ones exactly the six', () => {
    expect(v6.DC_CODES).toEqual(ELEVEN);
    expect(v6.COMBINED_CODES.slice().sort()).toEqual(SIX.slice().sort());
  });

  test('the prompt has the 11 level blocks and nothing for the six', () => {
    const p = dc11.getSystemPrompt();
    for (const c of ELEVEN) expect(p).toContain(`### Indicator: ${c} `);
    for (const c of SIX) {
      expect(p).not.toContain(`Indicator: ${c} `);
      expect(p).not.toContain(`Evidence: ${c} `);
      expect(p).not.toMatch(new RegExp(`"${c}"`));
    }
    expect(p).not.toMatch(/combined_evidence|PART 2|How many children spoke/);
    expect(dc11.promptVersion).toMatch(/^fico17-v6-dc11-/);
    expect(dc11.promptVersion).not.toBe(fw.promptVersion);
    expect(dc11.name).toBe('fico17_v6');
    expect(dc11.dc11).toBe(true);
  });

  test('a reply with the 11 levels and no evidence part passes', () => {
    const r = dc11.validate(elevenReply(), TRANSCRIPT);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('a reply that brings anything for the six is refused', () => {
    const withEvidence = { ...elevenReply(), combined_evidence: { C3: { result: null, items: [] } } };
    expect(dc11.validate(withEvidence, TRANSCRIPT).ok).toBe(false);
    const withLevel = elevenReply();
    withLevel.levels.D3 = { result: 2, because: 'x', evidence: [] };
    expect(dc11.validate(withLevel, TRANSCRIPT).ok).toBe(false);
  });

  test('a missing one of the 11 is still refused', () => {
    const r = elevenReply();
    delete r.levels.F4;
    expect(dc11.validate(r, TRANSCRIPT).ok).toBe(false);
  });

  test('the stored analysis has rows for the 11 only: no row, evidence or count for the six', () => {
    const a = dc11.computeScores(elevenReply(), false, TRANSCRIPT);
    const rows = Object.values(a.domains).flatMap((d) => d.indicators.map((i) => i.id));
    expect(rows.slice().sort()).toEqual(ELEVEN.slice().sort());
    expect(a.combined_evidence).toBeUndefined();
    expect(JSON.stringify(a)).not.toMatch(/student_turns/);
    for (const c of SIX) expect(a.levels[c]).toBeUndefined();
    expect(a.indicator_set).toBe('dc11');
    expect(a.prompt_version).toBe(dc11.promptVersion);
    expect(a.scores.rubric).toBe('fico17_v6');
    // 10 numeric levels of 3 (C2 is N/A, outside both sides of the ratio).
    expect(a.scores.overall_marks).toBe(30);
    expect(a.scores.overall_max_marks).toBe(40);
  });

  test('the full v6 scorer (coach visits) is unchanged: it still asks evidence for the combined ones', () => {
    expect(fw.getSystemPrompt()).toMatch(/PART 2 – EVIDENCE ONLY/);
    expect(fw.getSystemPrompt()).toContain('### Evidence: C3 ');
  });
});

describe('shadow — every self-recording read goes through the 11-only scorer', () => {
  const SESSION = { id: 's1', user_id: 'u-prim', observation_type: null, users: { region: 'Sihala' } };

  test("'v6' on a grade 3 recording: the model is called with dc11, and the blob is 11-only", async () => {
    mockSettings = { fico_dc_rubric: { ict: 'v6' } };
    mockUsers = { 'u-prim': { id: 'u-prim', region: 'Sihala', teacher_level: ['PRIMARY'], role: 'teacher' } };
    const task = shadow.start({ session: { ...SESSION, users: { region: 'ict' } }, metadata: { grade: '3', duration: 1800 }, frameworkKey: 'fico', transcript: TRANSCRIPT });
    const blob = await shadow.settle(task, 2000);
    expect(blob.mode).toBe('v6');
    expect(blob.status).toBe('ok');
    expect(mockSeenFramework && mockSeenFramework.dc11).toBe(true);
    expect(blob.indicator_set).toBe('dc11');
    expect(blob.combined_evidence).toBeUndefined();
    expect(Object.keys(blob.levels).sort()).toEqual(ELEVEN.slice().sort());
  });

  test('teacherFacing turns a dc11 read into a report analysis with the 11 rows only', async () => {
    const dc11 = fw.dc11Variant();
    const scored = dc11.computeScores(elevenReply(), false, TRANSCRIPT);
    const blob = { status: 'ok', mode: 'v6', indicator_set: 'dc11', levels: scored.levels, transcript_quality: { status: 'ok' } };
    const a = shadow.teacherFacing(blob, { topic: 'Halves', subject: 'maths' }, TRANSCRIPT);
    expect(a.framework).toBe('fico17_v6');
    expect(a.indicator_set).toBe('dc11');
    expect(a.topic).toBe('Halves');
    const rows = Object.values(a.domains).flatMap((d) => d.indicators.map((i) => i.id));
    expect(rows.slice().sort()).toEqual(ELEVEN.slice().sort());
    expect(a.combined_evidence).toBeUndefined();
    expect(JSON.stringify(a)).not.toMatch(/student_turns/);
  });

  test('a broken transcript under dc11 stores no row and no count for the six', async () => {
    mockSettings = { fico_dc_rubric: { '*': 'v6' } };
    mockUsers = { 'u-prim': { id: 'u-prim', region: 'Sihala', teacher_level: ['PRIMARY'], role: 'teacher' } };
    const task = shadow.start({ session: SESSION, metadata: { grade: '2' }, frameworkKey: 'fico', transcript: '' });
    const blob = await shadow.settle(task, 2000);
    expect(blob.status).toBe('broken');
    expect(blob.combined_evidence).toBeUndefined();
    expect(Object.keys(blob.levels).sort()).toEqual(ELEVEN.slice().sort());
  });
});

describe('grade gate — v6 for grades 1-5; grades 6-12 wait for the operator', () => {
  const S = (uid) => ({ id: 's1', user_id: uid, observation_type: null, users: { region: 'Sihala' } });
  beforeEach(() => {
    mockUsers = {
      'u-prim': { id: 'u-prim', region: 'Sihala', teacher_level: ['PRIMARY'], role: 'teacher' },
      'u-mid': { id: 'u-mid', region: 'Sihala', teacher_level: ['PRIMARY', 'MIDDLE'], role: 'teacher' },
      'u-none': { id: 'u-none', region: 'Sihala', teacher_level: [], role: 'teacher' },
    };
  });

  test.each([
    ['grade 1', 'u-mid', '1', 'v6'],
    ['grade 5', 'u-mid', '5', 'v6'],
    ['grade 6', 'u-prim', '6', 'v3'],
    ['grade 8', 'u-prim', '8', 'v3'],
    ['grade 10', 'u-prim', '10', 'v3'],
    ['unknown grade, PRIMARY-only teacher', 'u-prim', null, 'v6'],
    ['unknown grade, PRIMARY+MIDDLE teacher', 'u-mid', null, 'v3'],
    ['unknown grade, no band', 'u-none', null, 'v3'],
    ['ECE written in Urdu (not a number), PRIMARY-only teacher', 'u-prim', 'ای سی ڈی', 'v6'],
  ])('%s → %s', async (_l, uid, grade, want) => {
    mockSettings = { fico_dc_rubric: { '*': 'v6' } };
    expect(await shadow.modeFor(S(uid), 'fico', { grade })).toBe(want);
  });

  test("fico_dc_grades 'all' lets grades 6-12 through (for that key only)", async () => {
    mockSettings = { fico_dc_rubric: { '*': 'v6' }, fico_dc_grades: { 'user:u-prim': 'all' } };
    expect(await shadow.modeFor(S('u-prim'), 'fico', { grade: '7' })).toBe('v6');
    expect(await shadow.modeFor(S('u-mid'), 'fico', { grade: '7' })).toBe('v3');
  });

  test("'shadow' is not grade gated (stored only, never sent)", async () => {
    mockSettings = { fico_dc_rubric: { '*': 'shadow' } };
    expect(await shadow.modeFor(S('u-prim'), 'fico', { grade: '8' })).toBe('shadow');
  });

  test('switch off: v3 with no user read at all', async () => {
    expect(await shadow.modeFor(S('u-prim'), 'fico', { grade: '3' })).toBe('v3');
  });

  test('a coach visit is never this switch\'s business', async () => {
    mockSettings = { fico_dc_rubric: { '*': 'v6' } };
    expect(await shadow.modeFor({ ...S('u-prim'), observation_type: 'leader_observation' }, 'fico', { grade: '3' })).toBe('v3');
  });
});
