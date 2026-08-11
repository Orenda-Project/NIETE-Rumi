/**
 * The teacher-facing string catalog, and the one clamp.
 *
 * Two defects this closes:
 *
 *   1. The same en/ur clamp was written out inline at 23 call sites. Each was
 *      correct; the architecture guaranteed the 24th would differ or be
 *      forgotten. One function, asserted here.
 *
 *   2. Teacher-facing copy was hardcoded English at the exact moments it mattered
 *      most — the Settings success screen told a teacher who had just switched to
 *      Urdu, in English, that it had worked.
 *
 * An unknown key THROWS rather than returning an empty string or the key name. A
 * missing string is a programmer error caught in test, never a blank bubble sent
 * to a teacher — the failure mode the old getSystemMessage had, which returned ''
 * on an unknown key.
 */

const {
  UX_STRINGS,
  resolveUx,
  clampLanguage,
} = require('../../bot/shared/config/ux-strings');

const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');

describe('clampLanguage — one clamp replacing 23 inline copies', () => {
  it('passes through the languages this deployment serves', () => {
    expect(clampLanguage('ur')).toBe('ur');
    expect(clampLanguage('en')).toBe('en');
  });

  it('collapses anything off-market to the English floor', () => {
    for (const off of ['sw', 'ar', 'es', 'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK', 'ta-LK', 'fr']) {
      expect(clampLanguage(off)).toBe('en');
    }
  });

  it('collapses junk and non-strings to English rather than throwing', () => {
    // Called on every render path, including ones holding a value straight from
    // a vendor payload. It must be total.
    for (const bad of [null, undefined, '', 42, {}, [], 'EN', 'ur-PK']) {
      expect(clampLanguage(bad)).toBe('en');
    }
  });

  it('is behaviour-identical to the inline clamp it replaces', () => {
    // The 23 sites all read `x === 'ur' ? 'ur' : 'en'`. Replacing them is only
    // safe if the two agree on EVERY input, so that is asserted directly rather
    // than assumed.
    const inline = (x) => (x === 'ur' ? 'ur' : 'en');
    for (const v of ['ur', 'en', 'sw', 'ar', 'pa-PK', '', null, undefined, 42, 'UR']) {
      expect(clampLanguage(v)).toBe(inline(v));
    }
  });

  it('accepts an explicit offer, so a caller may narrow but not widen', () => {
    expect(clampLanguage('ur', ['en'])).toBe('en');
    expect(clampLanguage('ur', LANGUAGE_OFFER)).toBe('ur');
  });
});

describe('resolveUx — the catalog', () => {
  it('throws on an unknown key instead of returning something sendable', () => {
    expect(() => resolveUx('noSuchKey', { language: 'en' })).toThrow(/noSuchKey/);
  });

  it('returns the requested language', () => {
    expect(resolveUx('settingsSaved', { language: 'en' })).toBe(UX_STRINGS.settingsSaved.en);
    expect(resolveUx('settingsSaved', { language: 'ur' })).toBe(UX_STRINGS.settingsSaved.ur);
  });

  it('reads the language off a user object when one is passed', () => {
    const urdu = resolveUx('settingsSaved', { user: { preferred_language: 'ur' } });
    expect(urdu).toBe(UX_STRINGS.settingsSaved.ur);
  });

  it('clamps an off-market user preference rather than returning undefined', () => {
    // Phase 1 makes storing pa-PK impossible, but a row written before that, or a
    // caller passing a detected language, must still render something.
    const out = resolveUx('settingsSaved', { user: { preferred_language: 'pa-PK' } });
    expect(out).toBe(UX_STRINGS.settingsSaved.en);
  });

  it('interpolates named params', () => {
    const out = resolveUx('settingsDetails', {
      language: 'en',
      params: { language: 'English', framework: 'OECD 5D' },
    });
    expect(out).toContain('English');
    expect(out).toContain('OECD 5D');
    expect(out).not.toContain('{');
  });

  it('throws when a required param is missing, rather than sending "{language}"', () => {
    // A literal placeholder reaching a teacher is worse than a loud failure in
    // test, because nothing downstream would notice it.
    expect(() => resolveUx('settingsDetails', { language: 'en', params: {} })).toThrow(/param/i);
  });
});

describe('catalog completeness — every key exists in every offered language', () => {
  it('has no partial translations', () => {
    // A partial {en} map is the core i18n bug: it silently degrades Urdu readers
    // to English with no error anywhere.
    const missing = [];
    for (const [key, variants] of Object.entries(UX_STRINGS)) {
      for (const code of LANGUAGE_OFFER) {
        const v = variants[code];
        if (typeof v !== 'string' || v.trim() === '') missing.push(`${key}.${code}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('offers no language outside the deployment offer', () => {
    for (const [key, variants] of Object.entries(UX_STRINGS)) {
      const extra = Object.keys(variants).filter((c) => !LANGUAGE_OFFER.includes(c));
      expect(extra).toEqual([]);
    }
  });

  it('keeps Urdu strings in Urdu script, not Roman transliteration', () => {
    // Guards the failure where an English string is pasted into the ur slot to
    // "fill it in" — which the completeness check above would not catch.
    const PERSO_ARABIC = /[؀-ۿ]/;
    for (const [key, variants] of Object.entries(UX_STRINGS)) {
      if (!variants.ur) continue;
      // Bilingual-by-design entries contain both scripts; require only that some
      // Urdu is present.
      expect(PERSO_ARABIC.test(variants.ur)).toBe(true);
    }
  });
});
