'use strict';
/**
 * FeatureIntro.introShownCount and the
 * markVideoShown(userId, feature, { incrementIntroCount }) increment path,
 * against a mocked supabase chain. Proves, directly, that an existing caller
 * (no options argument) upserts the exact same shape as before D7.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/constants/feature-videos', () => ({ FEATURE_VIDEO_URLS: {}, FIRST_USE_INTRO_MESSAGES: {} }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const FeatureIntro = require('../../bot/shared/services/feature-intro.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FeatureIntro.introShownCount', () => {
  test('returns 0 when there is no row (PGRST116)', async () => {
    installFrom(supabase.from, { user_feature_first_use: { data: null, error: { code: 'PGRST116', message: 'not found' } } });
    expect(await FeatureIntro.introShownCount('u1', 'transcript_quiz')).toBe(0);
  });

  test('returns 0 when the column is null', async () => {
    installFrom(supabase.from, { user_feature_first_use: { data: [{ intro_shown_count: null }] } });
    expect(await FeatureIntro.introShownCount('u1', 'transcript_quiz')).toBe(0);
  });

  test('returns the stored count', async () => {
    installFrom(supabase.from, { user_feature_first_use: { data: [{ intro_shown_count: 3 }] } });
    expect(await FeatureIntro.introShownCount('u1', 'transcript_quiz')).toBe(3);
  });

  test('returns 0 on any other error rather than failing closed', async () => {
    installFrom(supabase.from, { user_feature_first_use: { data: null, error: { code: 'boom', message: 'x' } } });
    expect(await FeatureIntro.introShownCount('u1', 'transcript_quiz')).toBe(0);
  });
});

describe('FeatureIntro.markVideoShown', () => {
  test('an existing caller (no options) upserts exactly the same shape as before D7', async () => {
    installFrom(supabase.from, { user_feature_first_use: { data: [{}] } });
    await FeatureIntro.markVideoShown('u1', 'reading');
    const calls = supabase.from.callsFor('user_feature_first_use');
    const upsertCall = calls.flat().find((c) => c[0] === 'upsert');
    expect(upsertCall[1]).toEqual({ user_id: 'u1', feature: 'reading', video_shown_at: expect.any(String) });
    expect(upsertCall[2]).toEqual({ onConflict: 'user_id,feature' });
  });

  test('incrementIntroCount:true reads the current count then writes current+1', async () => {
    installFrom(supabase.from, ({
      user_feature_first_use: (calls) => (calls.some((c) => c[0] === 'upsert') ? { data: [{}] } : { data: [{ intro_shown_count: 1 }] }),
    }));
    await FeatureIntro.markVideoShown('u1', 'transcript_quiz', { incrementIntroCount: true });
    const calls = supabase.from.callsFor('user_feature_first_use').flat();
    const upsertCall = calls.find((c) => c[0] === 'upsert');
    expect(upsertCall[1]).toEqual(expect.objectContaining({ intro_shown_count: 2 }));
  });

  test('incrementIntroCount:false (explicit) matches the no-options shape', async () => {
    installFrom(supabase.from, { user_feature_first_use: { data: [{}] } });
    await FeatureIntro.markVideoShown('u1', 'transcript_quiz', { incrementIntroCount: false });
    const upsertCall = supabase.from.callsFor('user_feature_first_use').flat().find((c) => c[0] === 'upsert');
    expect(upsertCall[1].intro_shown_count).toBeUndefined();
  });
});
