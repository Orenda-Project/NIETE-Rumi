'use strict';
/**
 * bd-qix9oh.2 — the transcript quality gate on the DC side (deploy spec §6.3, §5.3, §5.4, §5.5; CONTRACTS §3, §7).
 *
 * The gate (observe/transcript-quality.js, real, not mocked) runs before the v6 DC call:
 *   broken  → no model call; all 11 levels 'IE', the five evidence rows 'IE' with no items, status 'broken'
 *   partial → the call runs, and its prompt carries the gate's TRANSCRIPT GAPS block
 *   ok      → the call runs, no gaps block
 * Every stored blob carries transcript_quality, written by code, never taken from the model's reply (§5.4).
 * Only the model boundary (GPT5MiniService) is mocked; its stand-in builds the prompt with the framework's own
 * buildAnalysisPrompt, as the real call does.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/fico-rubric-switch', () => ({
  dcRubric: jest.fn(() => Promise.resolve(global.__DC)),
  regionOfUser: jest.fn(() => Promise.resolve('Sihala')),
  isAnySet: jest.fn(() => Promise.resolve(true)),
}));

const mockAnalyze = jest.fn();
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
}));

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const gate = require('../../bot/shared/services/observe/transcript-quality');
const shadow = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');

// ─── Synthetic transcripts (no PII), 40-minute period ────────────────────
const mm = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const span = (from, to, fn) => { const o = []; for (let s = from; s <= to; s += 30) o.push(fn(s)); return o; };
const talk = (s) => (s % 60 === 0
  ? `[${mm(s)}] Teacher (ur): Question number ${s / 60}, why does it work?`
  : `[${mm(s)}] Student (ur): Because the parts are the same size ${s}.`);

const OK = span(10, 2370, talk).join('\n');                       // to 39:30 of 40
const PARTIAL = span(10, 1440, talk).join('\n');                  // stops at 23:40 of 40
const BROKEN = [...span(10, 700, talk), ...span(720, 2400, (s) => `[${mm(s)}] Student (ur): ٹھیک`)].join('\n'); // loop 12:00-40:00
const META = { coachingSessionId: 'sess-gate', duration: 2400, grade: 3, subject: 'math', teacherFirstName: 'X' };

function reply(transcript) {
  const first = transcript.split('\n')[1];
  const time = first.slice(1, 6);
  const quote = first.slice(first.indexOf(': ') + 2);
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 3, because: 'seen', evidence: [{ time, quote }] };
  const combined_evidence = {};
  for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) combined_evidence[c] = { result: null, items: [] };
  return { levels, combined_evidence };
}

let prompts;
function answerWith(make = (t) => reply(t)) {
  mockAnalyze.mockImplementation((transcript, metadata, lp, framework) => {
    prompts.push(framework.buildAnalysisPrompt(transcript, metadata, lp, null));
    return Promise.resolve({ analysis: framework.computeScores(make(transcript), false), usage: { cost: 0.01 } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  prompts = [];
  global.__DC = 'shadow';
  answerWith();
});

const STORED_KEYS = ['coverage', 'issues', 'status'];

describe('broken transcript → no DC call, every level IE (spec §6.3)', () => {
  test('no analyzePedagogy call; status broken; 11 levels IE; 5 evidence rows IE with no items', async () => {
    const out = await shadow.scoreV6(BROKEN, META);
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(out.status).toBe('broken');
    expect(out.rubric).toBe('fico17_v6');
    expect(out.prompt_version).toBe(v6.DC_PROMPT_VERSION);
    expect(Object.keys(out.levels).sort()).toEqual([...v6.DC_CODES].sort());
    for (const c of v6.DC_CODES) {
      expect(out.levels[c]).toEqual({ result: 'IE', because: 'the recording could not be used', evidence: [] });
    }
    for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) expect(out.combined_evidence[c]).toEqual({ result: 'IE', items: [] });
    // IE is never a level: nothing counted, nothing to total.
    expect(out.scores.counted).toBe(0);
    expect(out.scores.overall_marks).toBe(0);
    expect(out.usage).toBeNull();
  });

  test('transcript_quality is the gate\'s stored three fields', async () => {
    const out = await shadow.scoreV6(BROKEN, META);
    expect(Object.keys(out.transcript_quality).sort()).toEqual(STORED_KEYS);
    expect(out.transcript_quality).toEqual(gate.stored(gate.assess({ transcript: BROKEN, periodMinutes: 40 })));
    expect(out.transcript_quality.status).toBe('broken');
  });
});

describe('partial / ok transcripts → scored, gaps passed to the prompt (spec §5.3)', () => {
  test("partial: one call, the prompt carries the gate's TRANSCRIPT GAPS block; status ok, quality partial", async () => {
    const out = await shadow.scoreV6(PARTIAL, META);
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    const q = gate.assess({ transcript: PARTIAL, periodMinutes: 40 });
    expect(q.status).toBe('partial');
    expect(prompts[0]).toContain(gate.promptGaps(q));
    expect(prompts[0]).toContain('no speech after 23:40 of a 40-minute period');
    expect(out.status).toBe('ok');
    expect(out.transcript_quality).toEqual(gate.stored(q));
  });

  test('ok: one call, no gaps block; quality ok is stored', async () => {
    const out = await shadow.scoreV6(OK, META);
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(prompts[0]).not.toContain('TRANSCRIPT GAPS');
    expect(out.status).toBe('ok');
    expect(out.transcript_quality).toEqual({ status: 'ok', coverage: expect.any(Number), issues: [] });
  });

  test('the period is the recording length: duration / 60 minutes (a 24-minute lesson that ends at 23:40 is ok)', async () => {
    const out = await shadow.scoreV6(PARTIAL, { ...META, duration: 24 * 60 });
    expect(out.transcript_quality.status).toBe('ok');
    expect(prompts[0]).not.toContain('TRANSCRIPT GAPS');
  });

  test('transcript_quality is written by code: a model reply that claims its own is ignored', async () => {
    answerWith((t) => ({ ...reply(t), transcript_quality: { status: 'ok', coverage: 1, issues: [] } }));
    const out = await shadow.scoreV6(PARTIAL, META);
    expect(out.transcript_quality.status).toBe('partial');
  });

  test('the gaps block never reaches the system prompt, so prompt_version and the cached prompt stay put', async () => {
    const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
    const sys = fw.getSystemPrompt();
    await shadow.scoreV6(PARTIAL, META);
    expect(fw.getSystemPrompt()).toBe(sys);
    expect(sys).not.toContain('TRANSCRIPT GAPS');
  });
});

describe('every stored blob carries transcript_quality', () => {
  test('invalid reply: stored as invalid, with transcript_quality, no level', async () => {
    answerWith((t) => { const r = reply(t); delete r.levels.F4; return r; });
    const out = await shadow.scoreV6(PARTIAL, META);
    expect(out.status).toBe('invalid');
    expect(out.levels).toBeUndefined();
    expect(out.transcript_quality.status).toBe('partial');
  });

  test('both calls fail: start() stores failed, with transcript_quality, no level', async () => {
    mockAnalyze.mockImplementation(() => Promise.reject(new Error('provider down')));
    const out = await shadow.start({ session: { id: 's', user_id: 'u' }, metadata: META, frameworkKey: 'fico', transcript: PARTIAL });
    expect(out.status).toBe('failed');
    expect(out.levels).toBeUndefined();
    expect(out.transcript_quality.status).toBe('partial');
  });

  test('a slow reply: the timeout blob keeps transcript_quality and the mode', async () => {
    global.__DC = 'v6';
    mockAnalyze.mockImplementation(() => new Promise(() => {}));
    const task = shadow.start({ session: { id: 's', user_id: 'u' }, metadata: META, frameworkKey: 'fico', transcript: OK });
    await new Promise((r) => setImmediate(r));
    const out = await shadow.settle(task, 5);
    expect(out.status).toBe('timeout');
    expect(out.mode).toBe('v6');
    expect(out.transcript_quality.status).toBe('ok');
  });

  test('broken through start(): no call, mode kept', async () => {
    const out = await shadow.start({ session: { id: 's', user_id: 'u' }, metadata: META, frameworkKey: 'fico', transcript: BROKEN });
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(out.status).toBe('broken');
    expect(out.mode).toBe('shadow');
  });
});

describe('the one retry (spec §5.5 step 1)', () => {
  const LINE = 'Your last reply was not valid JSON. Return only the JSON.';

  test('a reply that would not parse is retried once with the same prompt plus the §5.5 line', async () => {
    let n = 0;
    mockAnalyze.mockImplementation((transcript, metadata, lp, framework) => {
      prompts.push(framework.buildAnalysisPrompt(transcript, metadata, lp, null));
      n += 1;
      if (n === 1) return Promise.reject(new Error('JSON parsing failed: Unexpected token. Response may be truncated.'));
      return Promise.resolve({ analysis: framework.computeScores(reply(transcript), false), usage: null });
    });
    const out = await shadow.scoreV6(PARTIAL, META);
    expect(mockAnalyze).toHaveBeenCalledTimes(2);
    expect(prompts[0]).not.toContain(LINE);
    expect(prompts[1]).toBe(`${prompts[0]}\n\n${LINE}`);
    expect(out.status).toBe('ok');
  });

  test('any other failure is retried once with the same prompt, unchanged', async () => {
    let n = 0;
    mockAnalyze.mockImplementation((transcript, metadata, lp, framework) => {
      prompts.push(framework.buildAnalysisPrompt(transcript, metadata, lp, null));
      n += 1;
      if (n === 1) return Promise.reject(new Error('socket hang up'));
      return Promise.resolve({ analysis: framework.computeScores(reply(transcript), false), usage: null });
    });
    await shadow.scoreV6(OK, META);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0]);
  });

  test('the v6 call still never carries the teacher name or photos', async () => {
    await shadow.scoreV6(OK, { ...META, photo: { mode: 'image', images: [{ base64: 'x' }] } });
    const meta = mockAnalyze.mock.calls[0][1];
    expect(meta.photo).toBeUndefined();
    expect(meta.teacherFirstName).toBeUndefined();
  });
});
