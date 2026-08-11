/**
 * getConfirmedLanguage's blind fallback — when neither Soniox nor GPT can
 * tell us anything — must land on the English floor, not Urdu.
 *
 * The catch-block comment already says the intent is "fall back to the
 * deployment's default rather than a hardcoded code" — but it reached for
 * offerDefaultLanguage() (the registry's first-OFFERED language, Urdu) where
 * language-cache's DEFAULT_LANGUAGE (the actual emergency floor, English) was
 * meant. Since 99.6% of users are unlocked, this value flows straight into
 * voice-message.handler.js's reply language for that message — so an
 * English-preferring teacher whose GPT call fails would be answered in Urdu.
 */

let openaiCreateMock;

function load() {
  jest.resetModules();
  openaiCreateMock = jest.fn();
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: openaiCreateMock } } }),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  // language-detector.service now reads DEFAULT_LANGUAGE from language-cache,
  // which connects to real Redis/Supabase at module load — stub both so this
  // stays a fast unit test instead of hanging on a real connection.
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn(), set: jest.fn(), delete: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }));
  return require('../../bot/shared/services/language-detector.service');
}

describe('language-detector.service — the blind fallback is English, not Urdu', () => {
  it('lands on English when Soniox has nothing and GPT throws', async () => {
    const Service = load();
    openaiCreateMock.mockRejectedValue(new Error('rate limited'));

    const result = await Service.getConfirmedLanguage('some transcript', null);

    expect(result).toBe('en');
  });

  it("does not use the registry's offered-first language as the emergency floor", async () => {
    // Regression guard for the exact bug: offerDefaultLanguage() is 'ur' for
    // this deployment, which would silently reproduce the failure above even
    // if a future edit swaps which constant this reads from.
    const { offerDefaultLanguage } = require('../../bot/shared/config/languages');
    expect(offerDefaultLanguage()).toBe('ur');

    const Service = load();
    openaiCreateMock.mockRejectedValue(new Error('timeout'));
    const result = await Service.getConfirmedLanguage('some transcript', null);

    expect(result).not.toBe(offerDefaultLanguage());
  });

  it('still trusts an explicit Soniox result over the floor', async () => {
    const Service = load();
    openaiCreateMock.mockRejectedValue(new Error('unused in this branch'));
    // 'ur' triggers the GPT-confirmation branch (Soniox 'ur' is ambiguous with
    // Sindhi/Balochi/Pashto); if GPT throws, Soniox's own result should still
    // win over any floor.
    const result = await Service.getConfirmedLanguage('کچھ متن', 'ur');
    expect(result).toBe('ur');
  });
});
