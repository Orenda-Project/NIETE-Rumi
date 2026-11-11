'use strict';
/**
 * bd-qix9oh fix-dc (r2) — the DC-side breaks the r1 red team and replay found (CONTRACTS §11.3, RULINGS R22, R23).
 *
 *   T5.1  a model-sent combined_evidence.D2 is never kept: the validator refuses one with a result or non-integer
 *         counts, and computeScores always puts the code count there (spec §5.6) with dc_result null.
 *   T6.3  _preserveFrameworkShape carries observe2 / dc / shadow / transcript_quality / scores.rubric through the
 *         reflection pass for every framework value, not only the non-OECD ones.
 *   T2.2  {"*":"v6","ict":"current"} with the region lookup down resolves to OFF, never to "*".
 *   §6.3  'partial': the TRANSCRIPT GAPS block sits after the transcript, before the closing line, on the first call
 *         and on the retry; 'broken' (an untimed self-recording too) makes no call and logs why at warn.
 *
 * Real: the v6 framework, fico17-v6/shadow.js, the gate, the switch, GPT5MiniService.enhanceAnalysisWithReflections.
 * Mocked: the Supabase client, the region registry (a DB read), the logger, the OpenAI client (enhance) and the DC
 * model call (GPT5MiniService.analyzePedagogy). Synthetic transcripts only.
 */

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-r2-dc';

global.__ROWS = [];
global.__REGION = 'Sihala';
global.__USERS_ERR = null;
global.__REGISTRY_DOWN = false;
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    in: jest.fn(() => Promise.resolve({ data: global.__ROWS, error: null })),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(global.__USERS_ERR
      ? { data: null, error: { message: global.__USERS_ERR } }
      : { data: { region: global.__REGION }, error: null })),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/region-registry', () => ({
  organizationForRegion: jest.fn((client, region) => {
    if (global.__REGISTRY_DOWN) return Promise.reject(new Error('region registry unreadable: timeout'));
    return Promise.resolve(({ sihala: 'niete', tarnol: 'niete' })[String(region || '').toLowerCase()] || null);
  }),
}));

const { logToFile } = require('../../bot/shared/utils/logger');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const shadow = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');
const gate = require('../../bot/shared/services/observe/transcript-quality');
const sw = require('../../bot/shared/services/coaching/fico-rubric-switch');
const rubric = require('../../bot/shared/services/observe/observe2/rubric');
const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

const UUID = 'abcdef12-3456-4789-8abc-def012345678';
const TRANSCRIPT = ['[00:10] Teacher (UR): Why do plants need sunlight?', '[00:20] Student (UR): To grow', '[20:00] Teacher (UR): Good.'].join('\n');

function reply(patch = {}) {
  const levels = Object.fromEntries(V6.DC_CODES.map((c) => [c, { result: 2, because: 'x', evidence: [] }]));
  const combined = Object.fromEntries(fw.EVIDENCE_CODES.map((c) => [c, { result: null, items: [] }]));
  return { rubric: 'fico17_v6', levels, combined_evidence: combined, ...patch };
}
const d2Row = (scored) => Object.values(scored.domains).flatMap((d) => d.indicators).find((i) => i.id === 'D2');

beforeEach(() => {
  sw._resetCache();
  global.__ROWS = []; global.__REGION = 'Sihala'; global.__USERS_ERR = null; global.__REGISTRY_DOWN = false;
  logToFile.mockClear();
});
afterEach(() => jest.restoreAllMocks());

// ─── T5.1 ─────────────────────────────────────────────────────────────
describe('T5.1 D2 comes from code, never the model (spec §5.6, R22)', () => {
  test('the validator refuses a model-sent D2 carrying a result', () => {
    const r = reply();
    r.combined_evidence.D2 = { result: 3, student_turns_first_half: 99, student_turns_second_half: 99 };
    const check = fw.validate(r, TRANSCRIPT);
    expect(check.ok).toBe(false);
    expect(check.errors.join('\n')).toMatch(/D2/);
  });

  test('the validator refuses non-integer D2 counts, and accepts integer counts with no result', () => {
    for (const bad of [{ student_turns_first_half: '12', student_turns_second_half: 3 }, { student_turns_first_half: 2.5, student_turns_second_half: 1 }, { student_turns_first_half: -1, student_turns_second_half: 1 }]) {
      const r = reply();
      r.combined_evidence.D2 = bad;
      expect(fw.validate(r, TRANSCRIPT).ok).toBe(false);
    }
    const ok = reply();
    ok.combined_evidence.D2 = { student_turns_first_half: 4, student_turns_second_half: 2 };
    expect(fw.validate(ok, TRANSCRIPT).ok).toBe(true);
  });

  test('computeScores with a transcript always replaces a model D2 with countD2, and D2 dc_result is null', () => {
    const r = reply();
    r.combined_evidence.D2 = { result: 3, student_turns_first_half: 99, student_turns_second_half: 99 };
    const scored = fw.computeScores(r, false, TRANSCRIPT);
    expect(scored.combined_evidence.D2).toEqual({ student_turns_first_half: 1, student_turns_second_half: 0 });
    expect(d2Row(scored).dc_result).toBeNull();
  });

  test('without a transcript a model D2 still never gives D2 a dc_result', () => {
    const r = reply();
    r.combined_evidence.D2 = { result: 4 };
    expect(d2Row(fw.computeScores(r, false)).dc_result).toBeNull();
  });

  test('the production order (analyzePedagogy runs computeScores with no transcript, then shadow validates) still refuses it', () => {
    const r = reply();
    r.combined_evidence.D2 = { result: 3, student_turns_first_half: 99, student_turns_second_half: 99 };
    const afterCall = fw.computeScores(r, false); // gpt5-mini.service.js analyzePedagogy: framework.computeScores(result, hasLp)
    expect(fw.validate(afterCall, TRANSCRIPT).ok).toBe(false);
  });

  test('shadow.scoreV6: a reply with a numeric D2 is stored as invalid, no level kept', async () => {
    const r = reply();
    r.combined_evidence.D2 = { result: 3, student_turns_first_half: 99, student_turns_second_half: 99 };
    jest.spyOn(GPT5MiniService, 'analyzePedagogy').mockResolvedValue({ analysis: r, usage: null });
    const blob = await shadow.scoreV6(TRANSCRIPT, { duration: 20 * 60 });
    expect(blob.status).toBe('invalid');
    expect(blob.levels).toBeUndefined();
  });
});

// ─── T6.3 ─────────────────────────────────────────────────────────────
describe('T6.3 the reflection pass carries the v6 keys for every framework value', () => {
  const realOpenai = GPT5MiniService.openai;
  afterEach(() => { GPT5MiniService.openai = realOpenai; });
  const qa = { questions: [{ question_number: 1, question: 'What went well?', answer: 'The group work.' }] };
  const modelReturns = (obj) => {
    GPT5MiniService.openai = { chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })) } } };
  };
  const QUALITY = { status: 'partial', coverage: 0.6, issues: [{ type: 'short', from: '24:00' }] };
  const blob = (framework) => ({
    ...(framework === undefined ? {} : { framework }),
    scores: { overall_marks: 6, overall_max_marks: 8, overall_percentage: 75, rubric: 'fico17_v6' },
    observe2: { form_id: 'f1', rubric: 'fico17_v6', final_levels: { C1: '3' }, transcript_quality: QUALITY },
    dc: { fico17_v6: { status: 'ok', rubric: 'fico17_v6', mode: 'v6' } },
    shadow: { fico17_v6: { status: 'ok', rubric: 'fico17_v6', mode: 'shadow' } },
    transcript_quality: QUALITY,
  });
  const kept = (a) => ({ observe2: a.observe2, dc: a.dc, shadow: a.shadow, transcript_quality: a.transcript_quality, rubric: a.scores && a.scores.rubric });

  test.each([['absent', undefined], ['oecd', 'oecd'], ['fico', 'fico'], ['fico17_v6', 'fico17_v6']])('framework %s', async (_label, framework) => {
    // The enhance model emits its own scores (no rubric) and nothing else of ours.
    modelReturns({ executive_summary: 'enhanced', scores: { overall_marks: 1, overall_max_marks: 2, overall_percentage: 50 } });
    const before = blob(framework);
    const out = await GPT5MiniService.enhanceAnalysisWithReflections(JSON.parse(JSON.stringify(before)), 'transcript', qa, {}, null, null);
    expect(kept(out)).toEqual(kept(before));
  });

  test('an OECD blob with none of the keys gets none of them', () => {
    const out = GPT5MiniService._preserveFrameworkShape({ executive_summary: 'x', scores: { overall_percentage: 50 } }, { framework: 'oecd', scores: { overall_percentage: 40 } });
    expect(out).toEqual({ framework: 'oecd', executive_summary: 'x', scores: { overall_percentage: 50 } });
  });
});

// ─── T2.2 ─────────────────────────────────────────────────────────────
describe('T2.2 a failed lookup the switch needs resolves to OFF, never to "*"', () => {
  const coachRow = (value) => [{ key: 'fico_coach_rubric', value }, { key: 'fico_dc_rubric', value }];

  test('{"*":"v6","ict":"current"} + region registry down → current / v3', async () => {
    global.__ROWS = coachRow('{"*":"v6","ict":"current"}');
    global.__REGISTRY_DOWN = true;
    expect(await sw.coachRubric({ userId: UUID, region: 'Sihala' })).toBe('current');
    expect(await sw.dcRubric({ userId: UUID, region: 'Sihala' })).toBe('v3');
    expect((await rubric.visitRubric({ observerUserId: UUID, region: 'Sihala' })).rubricVersion).toBe('fico-ict-17-2026-09');
  });

  test('{"*":"v6","ict":"current"} + the users read failing → v3 for a self-recording (the region was needed)', async () => {
    global.__ROWS = coachRow('{"*":"v6","ict":"current"}');
    global.__USERS_ERR = 'connection reset';
    expect(await shadow.modeFor({ id: 's1', user_id: UUID, observation_type: 'self_recording' }, 'fico')).toBe('v3');
    // a user whose region is genuinely empty still gets "*"
    global.__USERS_ERR = null; global.__REGION = null;
    expect(await shadow.modeFor({ id: 's1', user_id: UUID, observation_type: 'self_recording' }, 'fico')).toBe('v6');
  });

  test('controls: registry up → the ICT override; an unknown region (no throw) → "*"; registry down but not needed → "*"', async () => {
    global.__ROWS = coachRow('{"*":"v6","ict":"current"}');
    expect(await sw.coachRubric({ userId: UUID, region: 'Sihala' })).toBe('current');
    expect(await sw.coachRubric({ userId: UUID, region: 'Elsewhere' })).toBe('v6');
    sw._resetCache();
    global.__ROWS = coachRow('{"*":"v6"}');
    global.__REGISTRY_DOWN = true;
    expect(await sw.coachRubric({ userId: UUID, region: 'Sihala' })).toBe('v6');
  });
});

// ─── IE on partial / broken (spec §6.3, CONTRACTS §11.1) ──────────────
describe('the gate reaches the DC prompt on every path', () => {
  const PARTIAL_TRANSCRIPT = [
    '[00:05] Teacher (UR): Today we learn about plants.',
    '[01:10] Student (UR): Plants grow.',
    '[02:00] Teacher (UR): Why do they need water?',
    '[24:10] Teacher (UR): Write it down.',
  ].join('\n');
  const partial = () => gate.assess({ transcript: PARTIAL_TRANSCRIPT, periodMinutes: 40 });

  test('snapshot: a partial lesson\'s user prompt is context, transcript, gaps, then the closing line', () => {
    const quality = partial();
    expect(quality.status).toBe('partial');
    const prompt = fw.buildAnalysisPrompt(PARTIAL_TRANSCRIPT, { grade: '4', subject: 'Science', duration: 2400, transcriptQuality: quality });
    expect(prompt).toBe([
      'Grade: 4',
      'Subject: Science',
      'Recording length: 40 minutes',
      '',
      'TRANSCRIPT:',
      PARTIAL_TRANSCRIPT,
      '',
      gate.promptGaps(quality),
      '',
      'Score Part 1 and report Part 2 for this lesson. Return only the JSON.',
    ].join('\n'));
    const at = (s) => prompt.indexOf(s);
    expect(at('TRANSCRIPT GAPS:')).toBeGreaterThan(at('[24:10]'));
    expect(at('TRANSCRIPT GAPS:')).toBeLessThan(at('Score Part 1'));
    expect(prompt).toMatch(/no speech after 24:10/);
  });

  test('scoreV6 sends the gaps block on the first call and on the retry', async () => {
    const spy = jest.spyOn(GPT5MiniService, 'analyzePedagogy')
      .mockRejectedValueOnce(new Error('JSON parsing failed: Unexpected token'))
      .mockResolvedValueOnce({ analysis: reply(), usage: null });
    const blob = await shadow.scoreV6(PARTIAL_TRANSCRIPT, { duration: 2400 });
    expect(blob.status).toBe('ok');
    expect(blob.transcript_quality.status).toBe('partial');
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [transcript, meta] of spy.mock.calls) {
      expect(fw.buildAnalysisPrompt(transcript, meta)).toMatch(/TRANSCRIPT GAPS:[\s\S]*no speech after 24:10/);
    }
    expect(spy.mock.calls[1][1].retry).toBe(true);
  });

  test('an untimed self-recording is broken: no call, 11 × IE, logged at warn with the reason', async () => {
    const spy = jest.spyOn(GPT5MiniService, 'analyzePedagogy');
    const blob = await shadow.scoreV6('Teacher: Good morning children.\nStudent: Good morning.', { duration: 1800, coachingSessionId: 's1' });
    expect(spy).not.toHaveBeenCalled();
    expect(blob.status).toBe('broken');
    expect(V6.DC_CODES.map((c) => blob.levels[c].result)).toEqual(Array(11).fill('IE'));
    const warn = logToFile.mock.calls.find(([msg, , level]) => /broken/.test(msg) && level === 'warn');
    expect(warn).toBeTruthy();
    expect(warn[1].reason).toBe('untimed');
  });

  test('a looping transcript is broken with reason loop', async () => {
    const loop = ['[00:10] Teacher (UR): Today we learn about plants.'];
    for (let s = 60; s <= 40 * 60; s += 20) loop.push(`[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}] Student (UR): جی جی جی`);
    const blob = await shadow.scoreV6(loop.join('\n'), { duration: 2400 });
    expect(blob.status).toBe('broken');
    const warn = logToFile.mock.calls.find(([msg, , level]) => /broken/.test(msg) && level === 'warn');
    expect(warn[1].reason).toBe('loop');
  });
});
