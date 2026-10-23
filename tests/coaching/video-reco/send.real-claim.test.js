'use strict';
/**
 * bd-gzfdu9 (staging/main port): the clip sender with its REAL once-per-session claim (report-piece-once.js), only
 * Redis mocked. A shown row must reach WhatsApp; a second run for the same session must not send again. On a tier
 * without report-piece-once.js, defaults() throws MODULE_NOT_FOUND inside the try and the clip silently never goes.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockKeys = new Set();
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async (k) => { if (mockKeys.has(k)) return false; mockKeys.add(k); return true; }),
  delete: jest.fn(async (k) => { mockKeys.delete(k); return true; }),
}));

const ENV = { ...process.env };
const ROW = {
  id: '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60', coaching_session_id: '1a2b3c4d-1111-4222-8333-444455556666',
  user_id: '60530046-7ac3-4ea3-a976-b43c37c23213', status: 'shown', arm: 'video', module_id: 63, seg_id: '63-s2',
  start_s: 95, end_s: 229, reason_en: 'At 12:40 you asked "What is a noun?" and moved on.', reason_ur: 'آپ نے 12:40 پر پوچھا۔',
};
const HIT = {
  module: { module_id: 63, title: 'Questioning', language: 'ur', cpd_level: 1, thumb: 'video-thumbs/63.jpg' },
  segment: { seg_id: '63-s2', title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال', start_s: 95, end_s: 229 },
};

beforeEach(() => {
  jest.resetModules();
  mockKeys.clear();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk' };
});
afterAll(() => { process.env = ENV; });

test('shown row, real claimPiece: sent once; a second run for the same session sends nothing', async () => {
  const send = require('../../../bot/shared/services/coaching/video-reco/send');
  const wa = { sendCtaUrl: jest.fn(async () => true), sendMessage: jest.fn(async () => true) };
  const deps = {
    whatsapp: wa,
    store: { readForSession: jest.fn(async () => ROW), markSent: jest.fn(async () => undefined) },
    catalog: { segment: jest.fn(() => HIT) },
    renderCard: jest.fn(async () => Buffer.from('PNG')),
  };
  const first = await send.sendVideoRecommendation({ row: ROW, phone: '923000000001', language: 'en', deps });
  expect(first.sent).toBe(true);
  expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
  const again = await send.sendVideoRecommendation({ row: ROW, phone: '923000000001', language: 'en', deps });
  expect(again.sent).toBe(false);
  expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
});
