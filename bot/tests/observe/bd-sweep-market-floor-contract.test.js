/**
 * The observe market floor and the language registry are ONE decision.
 *
 * WHY THIS EXISTS
 * ---------------
 * `observe-language.js` keeps its own per-market table, and its `fallback` is
 * the language a person with no usable stated preference is addressed in. On
 * this deployment that value was hardcoded 'en' while `config/languages.js`
 * offers Urdu first — so the same teacher, with nothing stated, got Urdu from
 * every surface except the human-coach path, which answered her in English.
 *
 * Four suites in this folder had each written the old literal into their own
 * assertions, in a different test tree from the one the fix was measured on, so
 * changing the floor turned all four red at once with nothing pointing at the
 * cause. This test is the pin: the floor is asserted ONCE, against the
 * registry, so the next move of it is a one-line change here and not six
 * mystery failures across two trees.
 *
 * RED-FIRST: at 15776744 (pre-sweep staging) `MARKET_LANGS.fico.fallback` was
 * the literal 'en' and `offerDefaultLanguage()` was 'ur' — the first assertion
 * below fails there, and it executes the changed line.
 * Created: 2026-09-15 (DC/HITL sweep merge integration)
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';   // NIETE / ICT

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const { languageFor, clampToMarket, marketDefault } =
  require('../../shared/services/observe/observe-language');
const { offerDefaultLanguage, isOffered } = require('../../shared/config/languages');

/** A users table with no rows at all: every lookup answers "not found". */
function noRows() {
  supabase.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  }));
}

describe('the observe market floor is the language registry, not a literal', () => {
  it('fico falls back to the registry first offer', () => {
    expect(marketDefault()).toBe(offerDefaultLanguage());
  });

  it('the floor is a language this deployment actually serves', () => {
    expect(isOffered(marketDefault())).toBe(true);
    expect(clampToMarket(marketDefault())).toBe(marketDefault());
  });

  it('both audiences land on that one floor when nothing is stated', async () => {
    noRows();
    const session = {
      id: 's1', user_id: 'teacher-1', observer_user_id: 'coach-1',
      analysis_data: { teacher_delivery: { teacher_phone: '923009998888' } },
    };
    await expect(languageFor('teacher', session)).resolves.toBe(offerDefaultLanguage());
    await expect(languageFor('coach', session)).resolves.toBe(offerDefaultLanguage());
  });
});
