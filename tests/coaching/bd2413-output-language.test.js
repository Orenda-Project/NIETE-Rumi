/**
 * bd-2413 (FEAT-106 rows 11,12) — coaching output language must follow the
 * teacher's PREFERRED/LOCKED language, never the transient input language.
 *
 * determineOutputLanguage() used to read the most recent conversations.input_language
 * and return that — so a teacher who answered one reflection in English got an
 * English voice debrief (row 12), and one who asked for Punjabi got Punjabi output
 * (row 11). Both are preferred_language=ur. It must resolve from getUserLanguage
 * (preferred_language, set+locked via /settings) instead.
 */

// language-detector pulls language-cache → supabase/redis at load; stub the leaf
// deps so the pure isMarketLanguage export can be required in isolation.
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn() }), { virtual: true });

let mockGetUserLang;

function load(preferred, inputLang = 'en') {
  jest.resetModules();
  mockGetUserLang = jest.fn().mockResolvedValue(preferred);
  jest.doMock('../../bot/shared/utils/language-cache', () => ({
    getUserLanguage: mockGetUserLang,
    setUserLanguage: jest.fn(),
  }));
  // supabase: the recent conversation's input_language is the TRANSIENT value we
  // must NOT use for output.
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    limit: () => Promise.resolve({ data: [{ input_language: inputLang, output_language: inputLang }] }),
  };
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  return require('../../bot/shared/services/coaching/coaching-helpers.service');
}

describe('bd-2413 — market language gate (general conversation must not flip off-market)', () => {
  const { isMarketLanguage } = require('../../bot/shared/utils/language-detector');
  it('allows en and ur', () => {
    expect(isMarketLanguage('en')).toBe(true);
    expect(isMarketLanguage('ur')).toBe(true);
  });
  it('rejects Punjabi and other off-market languages (row 11)', () => {
    expect(isMarketLanguage('pa')).toBe(false);
    expect(isMarketLanguage('pa-PK')).toBe(false);
    expect(isMarketLanguage('fr')).toBe(false);
    expect(isMarketLanguage(null)).toBe(false);
  });
});

describe('bd-2413 — determineOutputLanguage follows preferred/locked language', () => {
  it('returns the preferred language, NOT the input language (row 12: answered in English)', async () => {
    const H = load('ur', 'en');
    const out = await H.determineOutputLanguage('user-1', 'sess-1', 'ur');
    expect(out).toBe('ur');
  });

  it('does not switch to a requested off-market language (row 11: asked for Punjabi)', async () => {
    const H = load('ur', 'pa');
    const out = await H.determineOutputLanguage('user-1', 'sess-1', 'ur');
    expect(out).toBe('ur');
  });

  it('clamps an unsupported stored preference to the English floor', async () => {
    // Renamed and re-pointed. The old name claimed to test a clamp to Urdu, but
    // it passed only because the TRANSCRIPT it was handed happened to be 'ur' —
    // with any other transcript it returned that instead, so it never tested the
    // clamp at all. It now asserts the clamp directly, and on the one floor this
    // deployment has: English, the same as every other surface.
    const H = load('pa-PK', 'pa');
    const out = await H.determineOutputLanguage('user-1', 'sess-1', 'ur');
    expect(out).toBe('en');
  });

  it('clamps the transcript fall-through instead of emitting an off-market code', async () => {
    // Previously asserted `'sw'` — i.e. it PINNED a coaching report being
    // generated in a language this deployment cannot render: no copy, no TTS
    // voice, no report font. Deliberate change, required by R1 (only en/ur may
    // appear anywhere).
    //
    // Worth knowing: this path is unreachable in production. getUserLanguage
    // never returns falsy — it answers with the floor on every failure — so only
    // this stub reaches the fall-through.
    const H = load(null, 'en');
    const out = await H.determineOutputLanguage('user-1', 'sess-1', 'sw');
    expect(out).toBe('en');
  });

  it('still honours a real preference over the transcript', async () => {
    // The guard that matters most stays: an Urdu-preferring teacher who recorded
    // an English-language lesson gets an Urdu report.
    const H = load('ur', 'en');
    const out = await H.determineOutputLanguage('user-1', 'sess-1', 'en');
    expect(out).toBe('ur');
  });
});
