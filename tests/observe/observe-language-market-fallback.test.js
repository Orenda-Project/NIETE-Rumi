/**
 * The observe stream keeps its own market table, and this deployment's row
 * disagreed with the registry: it fell back to English while the registry offers
 * Urdu first. So a teacher who never chose got her observation notes in English
 * from the human-coach path and in Urdu from every other path.
 *
 * The two floors are separate on purpose — `offerDefaultLanguage()` is what a
 * teacher is offered first, `DEFAULT_LANGUAGE` is the emergency floor — and this
 * is the first of the two.
 *
 * Executes the real resolvers with the users read mocked at the boundary.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__OBS_LANG_ROW, error: null })),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/observe/observe-framework', () => ({
  getObservePack: () => ({ key: 'fico' }),
}));

const { languageFor, marketDefault, marketLangConfig } =
  require('../../bot/shared/services/observe/observe-language');
const { offerDefaultLanguage } = require('../../bot/shared/config/languages');

beforeEach(() => {
  jest.clearAllMocks();
  global.__OBS_LANG_ROW = null;
});

describe('the observe market default agrees with the registry', () => {
  test('the market table and the registry name the same first language', () => {
    expect(marketDefault()).toBe(offerDefaultLanguage());
  });

  test('a teacher with no stored preference resolves to the offer default', async () => {
    const session = { user_id: 't1', observer_user_id: 'c1', analysis_data: {} };
    await expect(languageFor('teacher', session)).resolves.toBe(offerDefaultLanguage());
  });

  test('a coach with no stored preference resolves to the offer default', async () => {
    await expect(languageFor('coach', { observer_user_id: 'c1' })).resolves.toBe(
      offerDefaultLanguage(),
    );
  });

  test('a stated preference still wins over the default', async () => {
    global.__OBS_LANG_ROW = { preferred_language: 'en' };
    await expect(languageFor('coach', { observer_user_id: 'c1' })).resolves.toBe('en');
  });

  test('the offered set is unchanged — only the fallback moved', () => {
    expect(marketLangConfig().offer).toEqual(['ur', 'en']);
  });
});
