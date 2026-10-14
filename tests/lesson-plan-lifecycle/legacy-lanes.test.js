'use strict';
/**
 * The two older lesson-plan lanes still reachable on NIETE leave their lifecycle rows too:
 *
 *   · the Flow's PRE-GENERATED chapter lane (pre_generated_lps; SELECT_TOPIC with a PK- id) —
 *     source pre_gen_chapter, the same source the typed-topic handler's pre-generated hit writes;
 *   · the OXBRIDGE catalogue lane (lesson_plan_catalog; the Flow's OX- ids and the typed-topic
 *     picker) — source niete_oxbridge. Both of its callers go through deliverOxbridgeLp, so that is
 *     where the outcome is recorded; each caller now says whose ask it was.
 *
 * Both lanes deliver fire-and-forget after the Flow has answered, so the tests wait for the send.
 * Driven through the real Flow endpoint and the real Oxbridge service; faked: WhatsApp, R2, the
 * headless-browser PDF step and the logs; Supabase is the in-memory double.
 */

const mockSendMessage = jest.fn();
const mockSendDocument = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockRenderPdf = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocument: (...a) => mockSendDocument(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: (...a) => mockRenderPdf(...a) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: async (u) => `${u}?sig=stub`,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isConnected: () => false, get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn().mockResolvedValue(true),
}));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t), rpc: (...a) => mockDb.rpc(...a) }));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');
const Oxbridge = require('../../bot/shared/services/oxbridge-lp.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const TOKEN = `${TEACHER}:pakistan-lp:1`;
const PREGEN = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001', curriculum: 'pakistan', grade: 3, subject: 'English', chapter_number: 2,
  chapter_title: 'Five Senses Funland!', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/G3_ENG_CH2.pdf', pdf_r2_key_ur: null,
  is_current: true, generation_status: 'completed',
};
const OX = {
  id: 7, source: 'oxbridge', is_active: true, grade: 'Grade Seven', subject: 'Physics', chapter_title: 'Waves and Energy',
  description: '<p><strong>Topic: </strong>Dispersion Of Light</p>', content_html: '<h1>Waves</h1><p>Body</p>',
};

const asks = () => mockDb.table('lesson_plan_requests');
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  mockDb = createMemorySupabase({
    pre_generated_lps: [PREGEN],
    lesson_plan_catalog: [OX],
    users: [{ id: TEACHER, phone_number: '923001234567', preferred_language: 'en' }],
    lesson_plan_requests: [],
  });
  mockSendMessage.mockResolvedValue(true);
  mockSendDocument.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue({ messages: [{ id: 'wamid.DOC' }] });
  mockRenderPdf.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

const pickPregen = () => Endpoint.handlePakistanLpDataExchange(TOKEN, 'SELECT_TOPIC', {
  grade: '3', subject: 'English', chapter: '2', topic: `PK-${PREGEN.id}`,
});
const pickOxbridge = () => Endpoint.handlePakistanLpDataExchange(TOKEN, 'SELECT_TOPIC', {
  grade: '7', subject: 'Physics', chapter: 'Waves and Energy', topic: `OX-${OX.id}`,
});

describe('the Flow\'s pre-generated chapter lane', () => {
  test('switched ON: a sent chapter → ONE completed row, source pre_gen_chapter, naming the pre_generated_lps row', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'pre_gen_chapter';
    const res = await pickPregen();
    expect(res.screen).toBe('SUCCESS');
    await settle();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({
      user_id: TEACHER, phone_number: '923001234567', status: 'completed', source: 'pre_gen_chapter', channel: 'whatsapp',
      artifact_ref: PREGEN.id, grade: 3, subject: 'English', topic: 'Five Senses Funland!', error_code: null,
    }));
    expect(asks()[0].delivered_at).toBeTruthy();
  });

  test('switched ON: a send WhatsApp refused → ONE failed row, DELIVERY_FAILED', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'pre_gen_chapter';
    mockSendDocumentByLink.mockResolvedValue(null);
    await pickPregen();
    await settle();
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'DELIVERY_FAILED', delivered_at: null }));
  });

  test('switched OFF: no row, and the same sends', async () => {
    await pickPregen();
    await settle();
    expect(asks()).toHaveLength(0);
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });
});

describe('the Oxbridge lane', () => {
  test('switched ON, via the Flow: ONE completed row, source niete_oxbridge, naming the catalogue row', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_oxbridge';
    const res = await pickOxbridge();
    expect(res.screen).toBe('SUCCESS');
    await settle();
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({
      user_id: TEACHER, status: 'completed', source: 'niete_oxbridge', channel: 'whatsapp', artifact_ref: '7',
      grade: 7, subject: 'Physics', topic: 'Waves and Energy', error_code: null,
    }));
  });

  test('switched ON: a PDF that could not be made → failed RENDER_FAILED, and the function still answers false', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_oxbridge';
    mockRenderPdf.mockRejectedValue(new Error('browser gone'));
    await expect(Oxbridge.deliverOxbridgeLp('923001234567', OX, 'en', { userId: TEACHER })).resolves.toBe(false);
    expect(asks()[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'RENDER_FAILED', source: 'niete_oxbridge' }));
  });

  test('switched ON: a document WhatsApp refused → failed DELIVERY_FAILED, and the function still answers true, as before', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_oxbridge';
    mockSendDocument.mockResolvedValue(false);
    await expect(Oxbridge.deliverOxbridgeLp('923001234567', OX, 'en', { userId: TEACHER })).resolves.toBe(true);
    expect(asks()[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'DELIVERY_FAILED' }));
    expect(asks()[0].generated_at).toBeTruthy();
  });

  test('switched OFF: no row, and the same answer and sends', async () => {
    await expect(Oxbridge.deliverOxbridgeLp('923001234567', OX, 'en', { userId: TEACHER })).resolves.toBe(true);
    await pickOxbridge();
    await settle();
    expect(asks()).toHaveLength(0);
    expect(mockSendDocument).toHaveBeenCalledTimes(2);
  });
});

describe('a recorder that throws while describing the ask — reported, never silent, the delivery untouched', () => {
  const { logEvent } = require('../../bot/shared/utils/structured-logger');
  const thrownFor = (source) => logEvent.mock.calls.filter((c) => c[0] === 'lesson_plan.lifecycle.write_failed'
    && c[1].code === 'THROWN' && c[1].source === source);

  test('the pre-generated lane, a chapter row whose title is not text: the delivery fails as it always did, and the recorder throw is counted', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'pre_gen_chapter';
    mockDb.tables.pre_generated_lps = [{ ...PREGEN, chapter_title: 42 }];
    await pickPregen().catch(() => null);
    await settle();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(asks()).toHaveLength(0);
    expect(thrownFor('pre_gen_chapter')).toHaveLength(1);
  });

  test('the Oxbridge lane, a context the recorder cannot read: the same answer and send, and the throw is counted', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_oxbridge';
    const ctx = { userId: TEACHER, get correlationId() { throw new TypeError('context unreadable'); } };
    await expect(Oxbridge.deliverOxbridgeLp('923001234567', OX, 'en', ctx)).resolves.toBe(true);
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    expect(asks()).toHaveLength(0);
    expect(thrownFor('niete_oxbridge')).toHaveLength(1);
  });

  test('switched off, the same Oxbridge context: the same answer and send, and nothing is said', async () => {
    const ctx = { userId: TEACHER, get correlationId() { throw new TypeError('context unreadable'); } };
    await expect(Oxbridge.deliverOxbridgeLp('923001234567', OX, 'en', ctx)).resolves.toBe(true);
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    expect(thrownFor('niete_oxbridge')).toHaveLength(0);
  });
});
