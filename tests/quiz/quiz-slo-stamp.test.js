'use strict';
/**
 * bd-v0toag.9 — stamping a quiz's meta with its SLO codes. Off by default: with the switch off
 * meta comes back untouched. On, a missing code is logged (never invented) and the old label stays.
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Flag = require('../../bot/shared/services/quiz/quiz-v21-flag');
const Stamp = require('../../bot/shared/services/quiz/quiz-slo-stamp');

const DIGEST = { slos: [{ id: 'S1' }, { id: 'S2' }] };
const on = () => { mockDb = makeDb({ app_settings: [{ key: 'quiz_slo_retest_enabled', value: true }] }); };
const off = () => { mockDb = makeDb({ app_settings: [] }); };

beforeEach(() => { jest.clearAllMocks(); Flag._reset(); });

test('switch off → meta untouched, nothing logged', async () => {
  off();
  const meta = { digest: DIGEST };
  const out = await Stamp.stamp(meta, { slideScript: { sloCode: 'M-02-DV-01' }, quizId: 'q1', quizSource: 'lp_v8' });
  expect(out).toBe(meta);
  expect(logEvent).not.toHaveBeenCalled();
});

test('switch on, one code → slo_codes on every SLO, status one_code', async () => {
  on();
  const out = await Stamp.stamp({ digest: DIGEST, step: 'author' }, { slideScript: { sloCode: 'M-02-DV-01' }, quizId: 'q1', quizSource: 'lp_v8' });
  expect(out).toEqual({ digest: DIGEST, step: 'author', slo_codes: { S1: 'M-02-DV-01', S2: 'M-02-DV-01' }, slo_code_status: 'one_code' });
  expect(logEvent).not.toHaveBeenCalledWith('quiz.slo_code_missing', expect.anything());
});

test('switch on, several codes → no codes, logged with the reason', async () => {
  on();
  const out = await Stamp.stamp({ digest: DIGEST }, { slideScript: { sloCode: 'A-01-AB-01, A-01-AB-02' }, quizId: 'q1', quizSource: 'lp_v8' });
  expect(out.slo_codes).toEqual({});
  expect(out.slo_code_status).toBe('several_codes');
  expect(logEvent).toHaveBeenCalledWith('quiz.slo_code_missing', { quizId: 'q1', quiz_source: 'lp_v8', reason: 'several_codes', codes_seen: 2 });
});

test('switch on, a transcript quiz (no slide script) → logged as transcript_quiz', async () => {
  on();
  const out = await Stamp.stamp({ digest: DIGEST }, { slideScript: null, quizId: 'q2', quizSource: 'transcript' });
  expect(out.slo_code_status).toBe('transcript_quiz');
  expect(logEvent).toHaveBeenCalledWith('quiz.slo_code_missing', expect.objectContaining({ quizId: 'q2', reason: 'transcript_quiz' }));
});

test('already stamped → left as it is (a resume does not re-log)', async () => {
  on();
  const meta = { digest: DIGEST, slo_code_status: 'missing', slo_codes: {} };
  expect(await Stamp.stamp(meta, { slideScript: { sloCode: 'M-02-DV-01' }, quizId: 'q1', quizSource: 'lp_v8' })).toBe(meta);
  expect(logEvent).not.toHaveBeenCalled();
});

describe('codeReader (the WhatsApp PDF report reads codes through it)', () => {
  const META = { slo_codes: { S1: 'M-02-DV-01' }, slo_code_status: 'one_code' };
  test('switch off → null, even when codes are stored', async () => {
    off();
    expect(await Stamp.codeReader(META)).toBeNull();
  });
  test('no stored codes → null without reading the switch', async () => {
    mockDb = null; // a read would throw
    expect(await Stamp.codeReader({ digest: DIGEST })).toBeNull();
    expect(await Stamp.codeReader(null)).toBeNull();
  });
  test('switch on → the code for a coded S-id, null otherwise', async () => {
    on();
    const read = await Stamp.codeReader(META);
    expect(read('tq:q1:S1:2')).toBe('M-02-DV-01');
    expect(read('tq:q1:S2:1')).toBeNull();
  });
});
