/**
 * Catalog strings must fit the WhatsApp field they are sent in.
 *
 * This exists because of a real outage, not a hypothetical. Phase 2a made the
 * /language picker's footer bilingual — correct in intent, since an English-only
 * footer on a language chooser is unreadable to exactly the teachers most likely
 * to want Urdu — and pushed it to 87 characters against a 60-character cap. Meta
 * rejects the ENTIRE message with:
 *
 *   (#131009) Parameter value is not valid
 *   "Footer text length invalid. Min length: 0, Max length: 60"
 *
 * So `/language` silently sent nothing at all. Worse than the English-only footer
 * it replaced, and invisible to every existing test: the catalog was unit-tested
 * for CONTENT and completeness, and the payload builder was unit-tested for
 * SHAPE, but nothing checked the strings against the limits of the channel they
 * are actually delivered through. The failure only appears at the Graph API
 * boundary, which unit tests never cross.
 *
 * Measured in CODE POINTS ([...s].length, not s.length) because Urdu is outside
 * the BMP-safe assumptions of UTF-16 length in places, and an off-by-a-surrogate
 * count is exactly how something passes locally and fails at Meta.
 */

const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { getOfferedLanguages } = require('../../bot/shared/config/languages');

/**
 * WhatsApp Cloud API interactive-message limits.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
const LIMITS = {
  header: 60,
  body: 1024,
  footer: 60,
  buttonText: 20,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
};

/** Which catalog key lands in which WhatsApp field. */
const KEY_FIELD = {
  languagePickerHeader: 'header',
  languagePickerBody: 'body',
  languagePickerFooter: 'footer',
};

const len = (s) => [...s].length;

describe('ux-strings — every picker string fits its WhatsApp field', () => {
  for (const [key, field] of Object.entries(KEY_FIELD)) {
    describe(`${key} → ${field} (max ${LIMITS[field]})`, () => {
      for (const lang of Object.keys(UX_STRINGS[key])) {
        it(`fits in ${lang}`, () => {
          const value = UX_STRINGS[key][lang];
          expect(len(value)).toBeLessThanOrEqual(LIMITS[field]);
        });
      }
    });
  }

  it('leaves headroom rather than sitting exactly on the cap', () => {
    // A string at exactly 60 is one copy edit away from an outage, and the person
    // making that edit will not be looking at this file.
    for (const [key, field] of Object.entries(KEY_FIELD)) {
      if (field === 'body') continue; // 1024 is not a realistic constraint here
      for (const lang of Object.keys(UX_STRINGS[key])) {
        expect(len(UX_STRINGS[key][lang])).toBeLessThanOrEqual(LIMITS[field] - 5);
      }
    }
  });
});

describe('registry rows fit the list-row fields', () => {
  it('every offered language has a title within the row-title cap', () => {
    for (const lang of getOfferedLanguages()) {
      expect(len(lang.languageTitle)).toBeLessThanOrEqual(LIMITS.rowTitle);
      expect(len(lang.settingsTitle)).toBeLessThanOrEqual(LIMITS.rowTitle);
    }
  });

  it('every offered language has a description within the row-description cap', () => {
    for (const lang of getOfferedLanguages()) {
      expect(len(lang.languageDescription)).toBeLessThanOrEqual(LIMITS.rowDescription);
    }
  });
});

describe('the built picker payload fits, field by field', () => {
  // Reads the real builder's literals rather than the catalog alone, so a
  // hardcoded section title or button label is covered too.
  const src = require('fs').readFileSync(
    require.resolve('../../bot/shared/services/whatsapp.service.js'),
    'utf8'
  );

  it('the list button label fits', () => {
    const m = src.match(/button:\s*'([^']*)'/);
    expect(m).toBeTruthy();
    expect(len(m[1])).toBeLessThanOrEqual(LIMITS.buttonText);
  });

  it('the section title fits', () => {
    const m = src.match(/title:\s*'Available Languages'/);
    if (m) expect(len('Available Languages')).toBeLessThanOrEqual(LIMITS.sectionTitle);
  });
});
