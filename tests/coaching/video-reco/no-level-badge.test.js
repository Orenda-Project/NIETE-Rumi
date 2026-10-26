'use strict';
/**
 * bd-gzfdu9 (COS challenge 18:37Z, eng-surfaces answer): no surface badges the clip with a training LEVEL. 70% of
 * coached teachers have finished the whole ladder; "Aspiring" / "Level 1" on a clip sent to them reads as "you are
 * a beginner". The WhatsApp header card, the image strip, the /cr card and the /v player carry the title only.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const ENV = { ...process.env };
const ROW = { id: '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60', coaching_session_id: '1a2b3c4d-1111-4222-8333-444455556666', user_id: '60530046-7ac3-4ea3-a976-b43c37c23213', status: 'shown', module_id: 51, seg_id: '51-s3', start_s: 82, end_s: 142, reason_en: 'Because.' };
const HIT = { module: { module_id: 51, title: 'Questioning', language: 'ur', cpd_level: null }, segment: { title_en: 'Open questions', title_ur: 'کھلے سوال' } };
beforeEach(() => { jest.resetModules(); process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://p.example' }; });
afterAll(() => { process.env = ENV; });

test.each(['en', 'ur'])('WhatsApp header card (%s): no level label', async (language) => {
  const renderCard = jest.fn(async () => null);
  await require('../../../bot/shared/services/coaching/video-reco/send').sendVideoRecommendation({
    row: ROW, phone: '923000000001', language,
    deps: { whatsapp: { sendCtaUrl: async () => true, sendMessage: async () => true }, store: { markSent: async () => {} }, catalog: { segment: () => HIT }, claimPiece: async () => true, releasePiece: async () => {}, renderCard },
  });
  expect(renderCard.mock.calls[0][0].levelLabel).toBeFalsy();
});

test.each(['en', 'ur'])('image strip (%s): no level label', async (language) => {
  const out = await require('../../../bot/shared/services/coaching/video-reco/strip').stripFor({ coachingSessionId: 's', phone: '920000000000', language, row: ROW, deps: { enabled: () => true, onTeacherApp: async () => false, windowOpen: async () => true, catalog: { segment: () => HIT } } });
  expect(out.levelLabel).toBeFalsy();
});

test('/cr card: no level label', async () => {
  const db = { from: () => { const c = {}; c.select = () => c; c.eq = () => c; c.maybeSingle = async () => ({ data: ROW, error: null }); return c; } };
  const card = await require('../../../dashboard/services/video-reco-events').cardFor(db, ROW.coaching_session_id, ROW.user_id, 'en', { segment: () => HIT });
  expect(card.levelLabel).toBeFalsy();
});

test.each(['Aspiring', 'Level', 'ابتدائی', 'لیول'])('the /v page never shows %p', (word) => {
  const html = require('../../../dashboard/services/video-reco-page').renderPlayer({ language: 'en', title: 'Open questions', reason: 'Because.', startS: 82, endS: 142 });
  expect(html).not.toContain(word);
});
