/**
 * The small end of the same rule: three readers whose floor or lock handling
 * disagreed with the registry.
 *
 *  - the coaching step messages floored to English while the registry offers
 *    Urdu first;
 *  - `isUserLanguageLocked()` was written as "the missing reader", exported, and
 *    never called by anything in production — tested dead code, which the suite
 *    reports as covered;
 *  - the video rate-limit message branched on the lock and returned the same
 *    value either way, so the lock read decided nothing.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const { offerDefaultLanguage } = require('../../bot/shared/config/languages');

describe('coaching step messages floor to the offer default', () => {
  jest.mock('../../bot/shared/config/supabase', () => {
    const builder = {
      select: jest.fn(() => builder),
      update: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      single: jest.fn(() => Promise.resolve({ data: null, error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve) => resolve({ data: null, error: null }),
    };
    return { from: jest.fn(() => builder) };
  });

  const ReportGenerator = require('../../bot/shared/services/coaching/report-generator.service');

  test('a session whose teacher never chose resolves to Urdu, not English', () => {
    expect(ReportGenerator._languageFromSession({ users: { preferred_language: null } }))
      .toBe(offerDefaultLanguage());
  });

  test('a stated preference still wins', () => {
    expect(ReportGenerator._languageFromSession({ users: { preferred_language: 'en' } }))
      .toBe('en');
  });

  test('an unreadable session still returns something renderable', () => {
    expect(['ur', 'en']).toContain(ReportGenerator._languageFromSession(null));
  });
});

describe('the lock has no reader that decides nothing', () => {
  test('language-cache no longer exports a reader nothing calls', () => {
    const cache = require('../../bot/shared/utils/language-cache');
    expect(cache.isUserLanguageLocked).toBeUndefined();
  });

  test('the shared mock does not advertise it either', () => {
    const mock = require('../../bot/shared/utils/__mocks__/language-cache');
    expect(mock.isUserLanguageLocked).toBeUndefined();
  });
});
