'use strict';
/**
 * A swept run reaches the rung job: where the sweeper sets a stuck run to failed, it calls the rung module's
 * onRecordFinal(id) once (a failed record row can light a rung), guarded so a throwing rung job never stops the sweep.
 * The rung module (`web-quiz-rungs`) is not on the base yet: a VIRTUAL mock here, and absent in an isolated registry
 * (the sweep is then exactly what it was).
 * Faked boundaries only: Supabase (the in-memory fake), the logger, the event transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
// global.__absent names the module an isolated registry must not find (the module not deployed)
// held here, not required from the test: the module is not on the base yet, so nothing in this file require()s it
const mockOnRecordFinal = jest.fn(async () => ({ lit: [] }));
jest.mock('../../../shared/services/quiz/web-quiz-rungs', () => {
  if (global.__absent === 'web-quiz-rungs') throw new Error("Cannot find module './web-quiz-rungs'");
  return ({ onRecordFinal: mockOnRecordFinal });
}, { virtual: true });
jest.mock('../../../shared/storage/r2', () => ({ deleteKey: jest.fn(async () => true), listKeys: jest.fn(async () => []), getPresignedUploadUrl: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const S = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');

const NOW = Date.parse('2026-10-15T06:00:00Z');
const ago = (min) => new Date(NOW - min * 60 * 1000).toISOString();
const ON = (key) => ({ key, value: true });
const KID = '44444444-4444-4444-8444-444444444444';
const RUNS = 'web_quiz_challenge_runs';
const settings = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper')];
const runRow = (id, status, minAgo, extra = {}) => ({
  id, student_id: KID, exercise: 'read', grade: 3, lang: 'ur', status, created_at: ago(minAgo), meta: { ms: 1 }, mode: 'check', record: true, ...extra,
});
const fixture = () => [runRow('r-a', 'scoring', 30), runRow('r-b', 'scoring', 15), runRow('r-new', 'scoring', 5), runRow('s-old', 'served', 25 * 60)];

let db;
const installOn = (sb) => {
  db = { app_settings: settings(), [RUNS]: fixture(), web_quiz_strip_weekly: [] };
  Object.assign(sb, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const strip = (rows) => rows.map(({ meta, ...r }) => ({ ...r, meta: { ...meta, swept_at: meta.swept_at ? 'T' : undefined } }));

afterEach(() => { jest.clearAllMocks(); });

test('onRecordFinal is called once per swept run, with the run id; a run not swept is not passed', async () => {
  installOn(supabase);
  const out = await S.sweepStuck({ now: NOW });
  expect(out).toMatchObject({ swept: 2, abandoned: 1 });
  expect(mockOnRecordFinal).toHaveBeenCalledTimes(2);
  expect(mockOnRecordFinal.mock.calls.map((c) => c[0]).sort()).toEqual(['r-a', 'r-b']);
});

test('a throwing rung job never stops the sweep (logged, the next run still swept)', async () => {
  installOn(supabase);
  mockOnRecordFinal.mockImplementationOnce(async () => { throw new Error('rungs table missing'); });
  const out = await S.sweepStuck({ now: NOW });
  expect(out).toMatchObject({ swept: 2 });
  expect(db[RUNS].filter((r) => r.status === 'failed').map((r) => r.id).sort()).toEqual(['r-a', 'r-b']);
  expect(logError).toHaveBeenCalledWith('web_quiz.ch_swept_rung_failed', expect.objectContaining({ run: expect.any(String) }));
});

test('the rung module absent: the sweep is unchanged (same rows, same result)', async () => {
  installOn(supabase);
  const withRungs = await S.sweepStuck({ now: NOW });
  const rowsWith = strip(db[RUNS]);

  mockOnRecordFinal.mockClear();
  // a fresh registry where the rung module cannot be found
  global.__absent = 'web-quiz-rungs';
  jest.resetModules();
  try {
    const sb = require('../../../shared/config/supabase');
    const S2 = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');
    installOn(sb);
    const without = await S2.sweepStuck({ now: NOW });
    expect(without).toEqual(withRungs);
    expect(strip(db[RUNS])).toEqual(rowsWith);
  } finally { delete global.__absent; jest.resetModules(); }
  expect(mockOnRecordFinal).not.toHaveBeenCalled();
});
