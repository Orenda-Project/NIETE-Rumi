/**
 * The language registry — one list, two languages, no region dependency.
 *
 * These assertions exist because each one corresponds to a defect measured in
 * production: two pickers offering different sets (5 vs 10), a template send
 * that hard-fails because Meta's code namespace differs from ours, and an offer
 * that would have broken staging had it been keyed by region.
 */

const registry = require('../../bot/shared/config/languages');
const {
  LANGUAGE_OFFER,
  SUPPORTED_LANGUAGES,
  offerDefaultLanguage,
  isOffered,
  getOfferedLanguages,
  getLanguage,
  templateCodeFor,
  languageAnchor,
} = registry;

describe('language registry — the offer', () => {
  it('offers exactly Urdu and English, in that order', () => {
    expect(LANGUAGE_OFFER).toEqual(['ur', 'en']);
  });

  it('offers Urdu first — the picker default and the future registration seed', () => {
    expect(offerDefaultLanguage()).toBe('ur');
    expect(offerDefaultLanguage()).toBe(LANGUAGE_OFFER[0]);
  });

  it('is Urdu, which is deliberately NOT the emergency floor', () => {
    // language-cache's DEFAULT_LANGUAGE is the floor when nothing can be
    // determined (English); this is what a teacher is OFFERED first (Urdu).
    // Conflating them would either seed everyone English again or answer
    // English-preferring teachers in Urdu on a failure. The floor itself is
    // asserted in tests/cache/language-writer.test.js, where the module's redis
    // dependency is mocked — requiring it here would load the real client.
    expect(offerDefaultLanguage()).toBe('ur');
    expect(offerDefaultLanguage()).not.toBe('en');
  });

  it('rejects every language ICT does not serve', () => {
    for (const code of ['sw', 'ar', 'es', 'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK', 'ta-LK', 'hi']) {
      expect(isOffered(code)).toBe(false);
    }
  });

  it('accepts only the two offered codes', () => {
    expect(isOffered('ur')).toBe(true);
    expect(isOffered('en')).toBe(true);
  });

  it('is not fooled by non-strings or near-misses', () => {
    for (const bad of [null, undefined, 42, {}, '', 'EN', 'ur-PK', 'english']) {
      expect(isOffered(bad)).toBe(false);
    }
  });
});

describe('language registry — no region dependency', () => {
  it('exposes no region-keyed lookup', () => {
    // A region-keyed offer would break staging: DEFAULT_REGION is "niete-staging"
    // while REGION is "niete", and nothing normalises between them.
    const exported = Object.keys(registry).join(' ');
    expect(exported).not.toMatch(/region/i);
    expect(exported).not.toMatch(/market/i);
  });

  it('returns the same offer regardless of region environment variables', () => {
    const before = getOfferedLanguages().map((l) => l.code);
    const saved = [process.env.DEFAULT_REGION, process.env.REGION];
    try {
      process.env.DEFAULT_REGION = 'niete-staging';
      process.env.REGION = 'somewhere-else';
      jest.resetModules();
      const reloaded = require('../../bot/shared/config/languages');
      expect(reloaded.getOfferedLanguages().map((l) => l.code)).toEqual(before);
    } finally {
      [process.env.DEFAULT_REGION, process.env.REGION] = saved;
    }
  });
});

describe('language registry — rows carry what surfaces need', () => {
  it('returns full rows in offer order', () => {
    expect(getOfferedLanguages().map((l) => l.code)).toEqual(['ur', 'en']);
  });

  it('every offered language has a title for both pickers', () => {
    for (const lang of getOfferedLanguages()) {
      expect(typeof lang.settingsTitle).toBe('string');
      expect(lang.settingsTitle.length).toBeGreaterThan(0);
      expect(typeof lang.languageTitle).toBe('string');
      expect(lang.languageTitle.length).toBeGreaterThan(0);
    }
  });

  it('carries direction and script so document renderers need no map of their own', () => {
    expect(getLanguage('ur').direction).toBe('rtl');
    expect(getLanguage('ur').script).toBe('Nastaliq');
    expect(getLanguage('en').direction).toBe('ltr');
  });

  it('carries a TTS provider for BOTH languages', () => {
    // English previously had no entry in the voice registry at all and fell
    // through to a hardcoded default — the language ICT serves most was the one
    // the registry did not describe.
    for (const lang of getOfferedLanguages()) {
      expect(lang.ttsProvider).toBeTruthy();
    }
  });

  it('has no row for a language outside the offer', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'ur']);
  });
});

describe('language registry — Meta template codes are their own namespace', () => {
  it('maps English to en_US, not en', () => {
    // A send passing 'en' does NOT match a template approved as 'en_US', and
    // Meta hard-fails rather than falling back.
    expect(templateCodeFor('en')).toBe('en_US');
    expect(templateCodeFor('en')).not.toBe('en');
  });

  it('maps Urdu to ur', () => {
    expect(templateCodeFor('ur')).toBe('ur');
  });

  it('returns null for an unknown code rather than something sendable', () => {
    expect(templateCodeFor('sw')).toBeNull();
    expect(templateCodeFor(undefined)).toBeNull();
  });
});

describe('language registry — the AI language anchor', () => {
  it('anchors Urdu to its native script and forbids transliteration', () => {
    const anchor = languageAnchor('ur');
    expect(anchor).toContain('Urdu');
    expect(anchor).toContain('اردو');
    expect(anchor).toMatch(/transliteration/i);
  });

  it('returns null for English — the well-resourced default needs no instruction', () => {
    expect(languageAnchor('en')).toBeNull();
  });

  it('returns null for a language we do not serve', () => {
    expect(languageAnchor('sw')).toBeNull();
  });
});
