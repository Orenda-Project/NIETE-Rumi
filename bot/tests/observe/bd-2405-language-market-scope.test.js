/**
 * bd-2405 — teacher-facing observe copy leaks Kiswahili on NIETE.
 *
 * Two grounded defects (evidence img-014: a NIETE coach's teacher got a full
 * Kiswahili report — "Kutoka kwa Asad", "Ahadi yako", "Tunajivunia kazi yako.
 * Tuko pamoja", "Ripoti yako ya somo… uchunguzi wa Asad"):
 *
 *   1. observe-send.service.js hardcoded `observeStrings('sw')` for the
 *      teacher copy (D6, a Tanzania-era assumption) — so EVERY market's
 *      teacher got Swahili.
 *   2. The `en` string set itself leaked "Tuko pamoja" (Swahili) in
 *      companion_closing.
 *
 * Rule 20: language is market-scoped. NIETE (fico) offers ur/en and must
 * NEVER resolve to sw; Tanzania (mewaka) stays sw.
 *
 * RED-FIRST: both assertions fail against current code.
 * Created: 2026-07-30
 */

// Mock supabase so resolveTeacherLang's teacher-phone lookup is controllable.
let mockTeacherRow = null;
jest.mock('../../shared/config/supabase', () => {
  const chain = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: mockTeacherRow, error: null })),
    single: jest.fn(async () => ({ data: mockTeacherRow, error: null })),
  };
  return chain;
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { observeStrings } = require('../../shared/services/observe/observe-strings');

const SWAHILI_TOKENS = ['Tuko pamoja', 'Asante', 'Ripoti', 'Ahadi yako', 'Kutoka kwa', 'uchunguzi'];

describe('bd-2405 · observe language market-scope', () => {
  afterEach(() => { delete process.env.OBSERVE_FRAMEWORK; mockTeacherRow = null; });

  it('the English string set contains no Kiswahili leak', () => {
    const en = observeStrings('en');
    for (const [key, val] of Object.entries(en)) {
      if (typeof val !== 'string') continue;
      for (const tok of SWAHILI_TOKENS) {
        expect(`${key}=${val}`).not.toContain(tok);
      }
    }
  });

  it('the Urdu string set contains no Kiswahili leak', () => {
    const ur = observeStrings('ur');
    for (const [key, val] of Object.entries(ur)) {
      if (typeof val !== 'string') continue;
      for (const tok of SWAHILI_TOKENS) {
        expect(`${key}=${val}`).not.toContain(tok);
      }
    }
  });

  // UPDATED 2026-08-19 (bd-dy7hs). These three market-scope invariants are
  // unchanged; the function that carries them moved. resolveTeacherLang(delivery,
  // coachLang) is gone — its coach-language fallback was the defect bd-dy7hs
  // removes — and languageFor('teacher', session) owns the question now. The
  // assertions below are the SAME assertions against the new seam.
  describe('the teacher copy is market-scoped (languageFor)', () => {
    let languageFor;
    beforeEach(() => {
      jest.resetModules();
      languageFor = require('../../shared/services/observe/observe-language').languageFor;
    });

    const sessionFor = (phone) => ({
      id: 's', user_id: 'coach', observer_user_id: 'coach',
      analysis_data: { teacher_delivery: { teacher_phone: phone } },
    });

    it('NIETE (fico) never resolves the teacher copy to sw', async () => {
      process.env.OBSERVE_FRAMEWORK = 'fico';
      mockTeacherRow = null; // teacher not registered
      const lang = await languageFor('teacher', sessionFor('923001234567'));
      expect(['ur', 'en']).toContain(lang);
      expect(lang).not.toBe('sw');
    });

    it('NIETE (fico) follows the teacher\'s own Urdu preference when registered', async () => {
      process.env.OBSERVE_FRAMEWORK = 'fico';
      mockTeacherRow = { preferred_language: 'ur' };
      const lang = await languageFor('teacher', sessionFor('923001234567'));
      expect(lang).toBe('ur');
    });

    it('Tanzania (mewaka) still resolves the teacher copy to sw', async () => {
      process.env.OBSERVE_FRAMEWORK = 'mewaka';
      mockTeacherRow = null;
      const lang = await languageFor('teacher', sessionFor('255700000000'));
      expect(lang).toBe('sw');
    });
  });
});
