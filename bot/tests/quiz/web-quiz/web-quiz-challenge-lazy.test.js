'use strict';
/**
 * The Challenge is not a boot dependency: with the child-test item bank and scorer ABSENT (a promotion that did
 * not carry them), the internal web-quiz router still loads, the rest of the web quiz still answers, and a
 * Challenge route answers a named 503 {error:'unavailable'} — never a crash, never a generic 500.
 *
 * Faked boundaries: Supabase (in-memory). "Absent" = the module throws "Cannot find module" when required.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 1000 })),
  presignKey: jest.fn(async () => null),
  getPresignedUploadUrl: jest.fn(async (k) => `https://r2.test/put/${k}`),
  deleteKey: jest.fn(async () => true),
  uploadBuffer: jest.fn(async () => 'ok'),
}));
jest.mock('../../../shared/services/child-test/item-bank', () => { const e = new Error("Cannot find module '../child-test/item-bank'"); e.code = 'MODULE_NOT_FOUND'; throw e; });
jest.mock('../../../shared/services/child-test/scoring/tasks/common', () => { const e = new Error("Cannot find module '../child-test/scoring/tasks/common'"); e.code = 'MODULE_NOT_FOUND'; throw e; });
jest.mock('../../../shared/services/child-test/scoring/tasks', () => { const e = new Error("Cannot find module '../child-test/scoring/tasks'"); e.code = 'MODULE_NOT_FOUND'; throw e; });
jest.mock('../../../shared/services/child-test/scoring/media', () => { const e = new Error("Cannot find module '../child-test/scoring/media'"); e.code = 'MODULE_NOT_FOUND'; throw e; });

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');

const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
let server; let base; let T;

beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }],
    quiz_share_codes: [{ id: 'sc-x', code: 'EXPD01', quiz_id: 'q', teacher_user_id: 't1', language: 'en', active: false }],
    web_quiz_challenge_runs: [],
    // the family phone has played as the child, so its hub link opens the Challenge (a forwarded one would not)
    quiz_sessions: [{ id: 's-fam', student_id: KID, share_code_id: 'sc-x', quiz_id: 'q', device_ref: 'FamilyPhoneDeviceRef_1', created_at: '2026-10-06T10:00:00Z' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  T = require('../../../shared/services/quiz/web-quiz-token');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => (server ? server.close(r) : r())));

const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json', 'x-wq-device': 'FamilyPhoneDeviceRef_1' };
const hub = () => T.signHub([KID]);

test('the router loads with child-test absent, and the quiz routes still answer', async () => {
  expect(server).toBeTruthy();
  const gone = await fetch(`${base}/quiz/EXPD01`, { headers: KEY });
  expect(gone.status).toBe(410);
});

test('an exercise that needs the item bank answers 503 unavailable, not a crash', async () => {
  const r = await fetch(`${base}/ch/${hub()}/bigger`, { headers: KEY });
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: 'unavailable' });
  const read = await fetch(`${base}/ch/${hub()}/read`, { headers: KEY });
  expect(read.status).toBe(503);
  expect(await read.json()).toEqual({ error: 'unavailable' });
});

test('a submitted run with child-test absent answers 503 unavailable', async () => {
  const ct = T.signChallenge({ studentId: KID, ex: 'bigger', runId: 'r-lazy-1' });
  const r = await fetch(`${base}/ch/result`, { method: 'POST', headers: KEY, body: JSON.stringify({ ct, taps: [], ms: 1000, lang: 'en' }) });
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: 'unavailable' });
});
