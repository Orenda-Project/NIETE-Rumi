'use strict';
/**
 * A first-use intro film arrives as ONE message: the film, with its introducing
 * line as the caption.
 *
 * It used to be a text naming the film («تین منٹ میں دیکھیں NIETE ڈیجیٹل کوچ کیا
 * کرتا ہے — …») and then, a second later, the film with no caption: two billed
 * messages for one thing. Production, 24-30 Sep 2026: 331 first-use intros on the
 * AI-coaching chip alone.
 *
 * Drives the real FeatureIntroService; only Supabase and the WhatsApp sender are
 * stubbed.
 */
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);

const { FEATURE_VIDEO_URLS, FIRST_USE_INTRO_MESSAGES } = require('../../bot/shared/constants/feature-videos');
const FeatureIntro = require('../../bot/shared/services/feature-intro.service');

const PHONE = '923002220000';
const cp = (s) => [...String(s)].length;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = makeDb({ user_feature_first_use: [] });
});

describe('first use of the AI coach', () => {
  test.each(['ur', 'en'])('one message: the film, captioned with the introducing line (%s)', async (lang) => {
    const sent = await FeatureIntro.sendFirstUseIntroIfNeeded('u-1', PHONE, 'ai_coaching', lang);
    expect(sent).toBe(true);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
    expect(mockWa.sendVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(mockWa.sendVideoFromUrl).toHaveBeenCalledWith(PHONE, FEATURE_VIDEO_URLS.ai_coaching, FIRST_USE_INTRO_MESSAGES.ai_coaching[lang]);
  }, 15000);

  test('every intro line fits a video caption (1,024 code points)', () => {
    for (const byLang of Object.values(FIRST_USE_INTRO_MESSAGES)) {
      for (const line of Object.values(byLang)) expect(cp(line)).toBeLessThanOrEqual(1024 - 5);
    }
  });

  test('a returning teacher gets nothing, as before', async () => {
    mockDb = makeDb({ user_feature_first_use: [{ id: 'r1', user_id: 'u-1', feature: 'ai_coaching', intro_shown_count: 1 }] });
    const sent = await FeatureIntro.sendFirstUseIntroIfNeeded('u-1', PHONE, 'ai_coaching', 'ur');
    expect(sent).toBe(false);
    expect(mockWa.sendVideoFromUrl).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });
});
