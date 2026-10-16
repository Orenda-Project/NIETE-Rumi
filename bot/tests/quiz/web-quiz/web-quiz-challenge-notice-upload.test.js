'use strict';
/**
 * The mic notice is marked seen when the reading is uploaded, not only when the result comes back: the upload already
 * carries `audio_consent: 'notice_shown'`, so a child who taps "Got it", reads, and loses the connection before the
 * result is not shown the notice again on the same phone (x-wq-device) in another browser.
 * The challenge service, the Trail page module, the hub device record and the internal routes run for real on the
 * shared fake Supabase; only the boundaries are faked (R2, Redis, the logger).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}&X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 1000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    set: async (k, v) => { store.set(k, v); return true; },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const TP = require('../../../shared/services/quiz/web-quiz-trail-page');

const KID = '7a7a7a7a-1111-4111-8111-7a7a7a7a7a7a';
const LIST = '7b7b7b7b-2222-4222-8222-7b7b7b7b7b7b';
const DEV = 'FamilyPhoneDeviceRef_7';
const D = { device: DEV };
const ON = (key) => ({ key, value: true });
const NOTICE_ON = ['web_quiz_challenge_v2', 'web_quiz_challenge_audio_consent', 'web_quiz_challenge_keep_audio'].map(ON);

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [ON('web_quiz_challenge')],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Rani Testwala' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  TP._reset();
  jest.clearAllMocks();
  // the Redis fake is one module-level Map for the file: emptied before every test (no test reads another's marks)
  redis._store.clear();
});

const on = (...flags) => flags.forEach((f) => db.app_settings.push(f));
const hub = () => T.sign({ k: 'h', ids: [KID], exp: Math.floor(Date.now() / 1000) + 3600 });
const readCt = async () => (await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).ct;
const menuV2 = async (device = DEV) => { TP._reset(); Ch.__reset(); return (await Ch.menu(hub(), { device, lang: 'en' })).v2; };
const noticeMarks = () => [...redis._store.keys()].filter((k) => k.startsWith('wq:hub:notice:'));
const consentEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.ch_audio_consent');

describe('the upload marks the mic notice seen on this phone', () => {
  test('upload with notice_shown, no result → the next menu has no notice', async () => {
    on(...NOTICE_ON);
    expect(await menuV2()).toMatchObject({ consent: true, notice: TP.NOTICE_V });
    const ct = await readCt();
    const up = await Ch.presignUpload({ ct, type: 'audio/webm', size: 1000, audio_consent: 'notice_shown' }, D);
    expect(typeof up.put_url).toBe('string');
    expect(up.put_url.length).toBeGreaterThan(0);
    // no submit: the result never came back
    const v2 = await menuV2();
    expect(v2.consent).toBe(true);
    expect(v2).not.toHaveProperty('notice');
    expect(v2).not.toHaveProperty('name');
  });

  test('upload with not_asked notes nothing: the next menu still carries the notice', async () => {
    on(...NOTICE_ON);
    const ct = await readCt();
    const up = await Ch.presignUpload({ ct, type: 'audio/webm', size: 1000, audio_consent: 'not_asked' }, D);
    expect(typeof up.put_url).toBe('string');
    expect(noticeMarks()).toEqual([]);
    expect(await menuV2()).toMatchObject({ consent: true, notice: TP.NOTICE_V });
  });

  test("the notice switch off: presign's response is byte-identical to today's and nothing is noted", async () => {
    on(ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_keep_audio'));
    const ct = await readCt();
    const at = jest.spyOn(Date, 'now').mockReturnValue(Date.now());   // one upload moment for both calls (the key carries it)
    try {
      const today = await Ch.presignUpload({ ct, type: 'audio/webm', size: 1000 });
      const withNotice = await Ch.presignUpload({ ct, type: 'audio/webm', size: 1000, audio_consent: 'notice_shown' }, D);
      expect(JSON.stringify(withNotice)).toBe(JSON.stringify(today));
    } finally { at.mockRestore(); }
    expect(noticeMarks()).toEqual([]);
    expect(consentEvents()).toEqual([]);
  });

  test('the route passes the x-wq-device header to presign: the notice is seen on THAT phone after an upload', async () => {
    on(...NOTICE_ON);
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    let server;
    await new Promise((r) => { server = app.listen(0, r); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
      const ct = await readCt();
      const body = { ct, type: 'audio/webm', size: 1000, audio_consent: 'notice_shown', device: 'BodyRefBodyRefBodyRef_' };
      const res = await fetch(`${base}/ch/upload`, { method: 'POST', headers: { 'x-api-key': 'test-internal-key', 'content-type': 'application/json', 'x-wq-device': DEV }, body: JSON.stringify(body) });
      expect(res.status).toBe(200);
      expect(typeof (await res.json()).put_url).toBe('string');
      expect(r2.getPresignedUploadUrl).toHaveBeenCalledTimes(1);
      expect(await menuV2(DEV)).not.toHaveProperty('notice');
      // the body's device is never trusted: one mark (the header's phone); the body's phone still gets the notice
      expect(noticeMarks()).toHaveLength(1);
      expect((await TP.bits({ studentId: KID, device: 'BodyRefBodyRefBodyRef_' })).v2).toMatchObject({ notice: TP.NOTICE_V });
    } finally { await new Promise((r) => server.close(r)); }
  });
});
