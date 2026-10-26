'use strict';
/** NIGHTLY_JOB §6 (the phonics score in code), §4 stage 10 (drift audit), the κ gate (coachip_phonics_state CHECKs) and
 * ANALYSES §2.2. fetch is mocked; the transcript is a fictional placeholder and is never written or logged. */
const P = require('../../lib/insights/phonics');
const M = require('../../lib/insights/model');
const X = require('./fixtures/model');

const SID = '00000000-0000-4000-8000-000000000003';
const { Q, TRANSCRIPT, phonicsOut } = X;

describe('buildPhonicsInput', () => {
  test('lesson meta plus the transcript, in memory', () => {
    const input = P.buildPhonicsInput({ transcriptText: TRANSCRIPT, meta: { lessonId: 'fictional_lesson', subject: 'urdu', grade: 2, goal: 'g', name: 'x' } });
    expect(input).toEqual({ lesson_meta: { lesson_id: 'fictional_lesson', subject: 'urdu', grade: 2, goal: 'g' }, transcript: TRANSCRIPT });
    const msg = P.phonicsUserMessage(input);
    expect(msg.startsWith('LESSON META:\n')).toBe(true);
    expect(msg).toContain('\n\nTRANSCRIPT:\n');
  });
});

describe('groundAndScore: grounding', () => {
  test('a quote is found after normalising whitespace, punctuation and diacritics; at_s comes from its transcript line', () => {
    const r = P.groundAndScore(phonicsOut({ stages: [['sound', Q.sound, '99:99'], ['blend', Q.blend]] }), TRANSCRIPT);
    expect(r.stages_heard).toEqual([{ stage: 'sound', at_s: 130 }, { stage: 'blend', at_s: 330 }]);
  });

  test('an ungrounded quote is dropped', () => {
    const r = P.groundAndScore(phonicsOut({ stages: [['sound', Q.ungrounded], ['segment', Q.segment]], score: 1 }), TRANSCRIPT);
    expect(r.stages_heard).toEqual([{ stage: 'segment', at_s: 545 }]);
  });

  test('an empty or missing quote grounds nothing', () => {
    const r = P.groundAndScore(phonicsOut({ stages: [['sound', ''], ['blend', '۔ ، .']] }), TRANSCRIPT);
    expect(r.stages_heard).toEqual([]);
    expect(r.score).toBe(0);
  });

  test('the result carries no quote and no model prose', () => {
    const r = P.groundAndScore(phonicsOut({ stages: [['sound', Q.sound]], routines: [['hijje', Q.hijje]] }), TRANSCRIPT);
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/quote|placeholder prose|زبر/);
    expect(Object.keys(r).sort()).toEqual(['applicable', 'letter_name_routine_only', 'read_alone_s', 'routines_heard', 'score', 'stages_heard']);
  });

  test('read_alone_s is the model\'s clock in seconds (minutes past 59 too)', () => {
    expect(P.groundAndScore(phonicsOut({ readAlone: '14:20' }), TRANSCRIPT).read_alone_s).toBe(860);
    expect(P.groundAndScore(phonicsOut({ readAlone: '61:05' }), TRANSCRIPT).read_alone_s).toBe(3665);
    expect(P.groundAndScore(phonicsOut({ readAlone: null }), TRANSCRIPT).read_alone_s).toBeNull();
  });
});

describe('groundAndScore: the F8 truth table', () => {
  const S3 = [['sound', Q.sound], ['blend', Q.blend], ['segment', Q.segment]];
  test.each([
    ['nothing grounded', {}, 0, false],
    ['a claimed stage that is not in the transcript', { stages: [['blend', Q.ungrounded]], score: 2 }, 0, false],
    ['spoken syllable work only', { routines: [['syllable_chant', Q.syllable]] }, 1, false],
    ['hijje only', { routines: [['hijje', Q.hijje]] }, 0, true],
    ['tor-jor only', { routines: [['tor_jor', Q.hijje]] }, 0, true],
    ['letter-name spelling only', { routines: [['letter_spelling', Q.hijje]] }, 0, true],
    ['an ungrounded hijje', { routines: [['hijje', Q.ungrounded]] }, 0, false],
    ['one grounded stage', { stages: [['sound', Q.sound]] }, 1, false],
    ['one stage plus hijje', { stages: [['sound', Q.sound]], routines: [['hijje', Q.hijje]], score: 1 }, 1, false],
    ['three stages, children audible (model 2)', { stages: S3, score: 2 }, 2, false],
    ['three stages, teacher only (model 1)', { stages: S3, score: 1 }, 1, false],
    ['three claimed, one ungrounded, model 2', { stages: [['sound', Q.sound], ['blend', Q.ungrounded], ['segment', Q.segment]], score: 2 }, 1, false],
  ])('%s → %i', (_n, o, score, routineOnly) => {
    const r = P.groundAndScore(phonicsOut(o), TRANSCRIPT);
    expect(r.applicable).toBe(true);
    expect(r.score).toBe(score);
    expect(r.letter_name_routine_only).toBe(routineOnly);
  });

  test('not a literacy lesson → not applicable, no score', () => {
    expect(P.groundAndScore(phonicsOut({ applicable: false, score: 0 }), TRANSCRIPT))
      .toEqual({ applicable: false, score: null, stages_heard: [], routines_heard: [], letter_name_routine_only: false, read_alone_s: null });
  });

  test('a non-object answer is null (the caller marks the run failed)', () => {
    expect(P.groundAndScore('nonsense', TRANSCRIPT)).toBeNull();
  });
});

describe('detectPhonics: the run row', () => {
  const meta = { lessonId: 'fictional_lesson', subject: 'urdu', grade: 2 };
  const deps = (fetch) => ({ fetch, apiKey: 'k', sessionId: SID, jobRunId: null });

  test('Haiku, phonics_v2, the stored output is the scored result with no quote', async () => {
    const fetch = X.scriptedFetch([X.ok(phonicsOut({ stages: [['sound', Q.sound]] }), { cost: 0.002 })]);
    const out = await P.detectPhonics({ transcriptText: TRANSCRIPT, meta, ledger: M.createLedger({}), deps: deps(fetch) });
    expect(fetch.calls[0].body.model).toBe('anthropic/claude-haiku-5.5');
    expect(out.row).toMatchObject({ analysis: 'phonics', prompt_version: 'phonics_v2', target: '-', status: 'ok', cost_usd: 0.002 });
    expect(out.row.output).toEqual(out.result);
    expect(out.result.score).toBe(1);
    expect(JSON.stringify(out.row)).not.toMatch(/quote|آواز|placeholder prose/);
  });

  test('not literacy → row not_applicable', async () => {
    const fetch = X.scriptedFetch([X.ok(phonicsOut({ applicable: false }))]);
    const out = await P.detectPhonics({ transcriptText: TRANSCRIPT, meta, ledger: M.createLedger({}), deps: deps(fetch) });
    expect(out.row.status).toBe('not_applicable');
  });

  test('an empty transcript is input_missing with no call', async () => {
    const fetch = X.scriptedFetch([]);
    const out = await P.detectPhonics({ transcriptText: '  ', meta, ledger: M.createLedger({}), deps: deps(fetch) });
    expect(fetch.calls).toHaveLength(0);
    expect(out.row).toMatchObject({ status: 'failed', failure_class: 'input_missing' });
  });

  test('the transcript never reaches a log line', async () => {
    const logs = [];
    const fetch = X.scriptedFetch([X.ok('not json'), X.ok('not json')]);
    await P.detectPhonics({ transcriptText: TRANSCRIPT, meta, ledger: M.createLedger({}), deps: { ...deps(fetch), log: (s) => logs.push(s) } });
    expect(logs.join('\n')).not.toMatch(/آواز|Teacher:/);
  });
});

describe('the κ gate and the drift audit', () => {
  test.each([
    [{ current: 'testing', kappa: 0.85, readCount: 30, signedOffBy: 'u1' }, 'ok'],
    [{ current: 'testing', kappa: 0.80, readCount: 30, signedOffBy: 'u1' }, 'ok'],
    [{ current: 'testing', kappa: 0.79, readCount: 30, signedOffBy: 'u1' }, 'testing'],
    [{ current: 'testing', kappa: 0.90, readCount: 29, signedOffBy: 'u1' }, 'testing'],
    [{ current: 'testing', kappa: 0.90, readCount: 30, signedOffBy: null }, 'testing'],
    [{ current: 'ok', kappa: 0.90, readCount: 30, signedOffBy: 'u1', pausedBy: 'u2' }, 'paused'],
    [{ current: 'paused', kappa: 0.90, readCount: 30, signedOffBy: null }, 'paused'],
    [{ current: 'paused', kappa: 0.90, readCount: 30, signedOffBy: 'u1' }, 'ok'],
    [{ current: 'paused', kappa: 0.60, readCount: 30, signedOffBy: 'u1' }, 'testing'],
    [{ current: 'ok', kappa: 0.90, readCount: 30, signedOffBy: 'u1' }, 'ok'],
  ])('%j → %s', (input, want) => {
    expect(P.phonicsState(input)).toBe(want);
  });

  test('readCount defaults to the blind 30', () => {
    expect(P.phonicsState({ current: 'testing', kappa: 0.81, signedOffBy: 'u1' })).toBe('ok');
  });

  test('driftAuditSlice: 5 + 5 a night over the first four runs of the month, nothing after', () => {
    expect(P.driftAuditSlice(1, 1)).toEqual({ detector: 5, gloss: 5, isLast: false });
    expect(P.driftAuditSlice(4, 4)).toEqual({ detector: 5, gloss: 5, isLast: true });
    expect(P.driftAuditSlice(6, 5)).toEqual({ detector: 0, gloss: 0, isLast: false });
    expect(P.driftAuditSlice(3, 0)).toEqual({ detector: 0, gloss: 0, isLast: false });
  });

  test('driftVerdict: κ < 0.70 on the 20, or any name in a stored gloss, pauses', () => {
    expect(P.driftVerdict(0.69, false)).toEqual({ pause: true, reason: 'upstream' });
    expect(P.driftVerdict(0.70, false)).toEqual({ pause: false, reason: null });
    expect(P.driftVerdict(0.95, true)).toEqual({ pause: true, reason: 'gate' });
    expect(P.driftVerdict(null, false)).toEqual({ pause: false, reason: null });
  });

  test('cohenKappa matches the x-analysis formula', () => {
    expect(P.cohenKappa(['0', '1', '2', '1'], ['0', '1', '2', '1'])).toBe(1);
    expect(P.cohenKappa(['0', '1', '1', '0'], ['0', '1', '0', '1'])).toBe(0);
  });
});
