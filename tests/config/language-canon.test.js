/**
 * language-canon — normalise a language value at a storage/comparison boundary.
 *
 * The subtle rule worth pinning: this canonicalises but does NOT clamp to the
 * languages the deployment offers. Telemetry has to be able to record that we
 * emitted something off-market — that is how the current leak was found (19
 * Punjabi and 2 Arabic replies to teachers whose stored preference is only ever
 * en or ur). Clamping on write would have hidden it. Restricting to the offer
 * belongs where a language is USED, not where it is RECORDED.
 */

const { canonicalizeLanguageCode } = require('../../bot/shared/utils/language-canon');

describe('language-canon — canonical codes pass through', () => {
  it('keeps the two offered codes', () => {
    expect(canonicalizeLanguageCode('en')).toBe('en');
    expect(canonicalizeLanguageCode('ur')).toBe('ur');
  });

  it('preserves a region-suffixed code where the suffix carries meaning', () => {
    expect(canonicalizeLanguageCode('pa-PK')).toBe('pa-PK');
    expect(canonicalizeLanguageCode('sd-PK')).toBe('sd-PK');
  });
});

describe('language-canon — spelled-out and native labels', () => {
  it('maps the label that caused the parent bot incident', () => {
    expect(canonicalizeLanguageCode('swahili')).toBe('sw');
    expect(canonicalizeLanguageCode('Swahili')).toBe('sw');
  });

  it('maps English and Urdu names, including native script', () => {
    expect(canonicalizeLanguageCode('English')).toBe('en');
    expect(canonicalizeLanguageCode('Urdu')).toBe('ur');
    expect(canonicalizeLanguageCode('اردو')).toBe('ur');
  });

  it('maps bare regional codes seen in vendor payloads', () => {
    expect(canonicalizeLanguageCode('sd')).toBe('sd-PK');
    expect(canonicalizeLanguageCode('pa')).toBe('pa-PK');
  });
});

describe('language-canon — region collapse', () => {
  it('collapses a regional variant onto its base language', () => {
    expect(canonicalizeLanguageCode('ur-PK')).toBe('ur');
    expect(canonicalizeLanguageCode('en_US')).toBe('en');
    expect(canonicalizeLanguageCode('en-GB')).toBe('en');
  });

  it('does not collapse when the base is not a language we know', () => {
    expect(canonicalizeLanguageCode('xx-YY')).toBeNull();
  });
});

describe('language-canon — does NOT clamp to the market offer', () => {
  it('resolves an off-market but real language to itself, so telemetry can record a leak', () => {
    expect(canonicalizeLanguageCode('ar')).toBe('ar');
    expect(canonicalizeLanguageCode('pa-PK')).toBe('pa-PK');
    expect(canonicalizeLanguageCode('hi')).toBe('hi');
  });
});

describe('language-canon — never guesses', () => {
  it('returns null for junk rather than defaulting', () => {
    expect(canonicalizeLanguageCode('gibberish')).toBeNull();
    expect(canonicalizeLanguageCode('mixed')).toBeNull();
    expect(canonicalizeLanguageCode('')).toBeNull();
    expect(canonicalizeLanguageCode('   ')).toBeNull();
  });

  it('returns null for non-strings', () => {
    expect(canonicalizeLanguageCode(null)).toBeNull();
    expect(canonicalizeLanguageCode(undefined)).toBeNull();
    expect(canonicalizeLanguageCode(42)).toBeNull();
    expect(canonicalizeLanguageCode({})).toBeNull();
  });
});
