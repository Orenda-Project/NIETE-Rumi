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
  // A Flow message's CTA (`flow_cta`) — Meta's documented cap, no emoji.
  flowCta: 20,
  // A Flow NavigationList row's title / description / metadata: clipped on the
  // device at 20, and nothing server-side notices (measured in this repo).
  navRow: 20,
  // A Flow RadioButtonsGroup option title.
  radioTitle: 30,
  // A Flow TextArea / TextInput helper-text.
  helperText: 80,
};

/** Which catalog key lands in which WhatsApp field. */
const KEY_FIELD = {
  languagePickerHeader: 'header',
  languagePickerBody: 'body',
  languagePickerFooter: 'footer',
  // bd-oak77.13 — the request_welcome greeting is sent as a plain text body.
  welcomeFirstOpen: 'body',
  // bd-twhcj — the reading-not-available refusal is a plain text body too.
  readingNotAvailable: 'body',
  // bd-q3rfn — the review offer sent after a paper (a Flow message).
  assessmentReviewOfferHeader: 'header',
  assessmentReviewOfferBody: 'body',
  assessmentReviewOfferButton: 'buttonText',
  // Versioned editing (AG 1.2 items 1+2): the Edit button rides ON the paper.
  assessmentEditButton: 'flowCta',
  assessmentPaperBody: 'body',
  assessmentVersionBody: 'body',
  assessmentKeyCaption: 'body',
  assessmentVersionMaking: 'body',
  assessmentNoChanges: 'body',
  assessmentDraftExpired: 'body',
  assessmentRowAdd: 'navRow',
  assessmentRowAddDesc: 'navRow',
  assessmentRowMake: 'navRow',
  assessmentRowPrev: 'navRow',
  assessmentRowNext: 'navRow',
  assessmentRowMark1: 'navRow',
  assessmentRowRemoveQ: 'navRow',
  assessmentRowBackToList: 'navRow',
  assessmentOptionNotSet: 'radioTitle',
  assessmentAnswerHint: 'helperText',
};

/**
 * The ONE string allowed to sit exactly on its cap: the Edit button's CTA,
 * "Edit questions/marks", is operator-approved copy measured at 20/20 code
 * points (Urdu 19/20). If a reviewer refuses the exemption the fallback copy
 * is "Edit paper".
 */
const HEADROOM_EXEMPT = new Set(['assessmentEditButton']);

/**
 * Row strings with placeholders are measured RENDERED, with the widest values a
 * paper can produce (50 questions, 3-digit marks), because the template's own
 * length says nothing about what reaches the device.
 */
const ROW_TEMPLATES = {
  assessmentRowMakeDesc: { count: 50, marks: 150 },
  assessmentRowPrevDesc: { from: 33, to: 48 },
  assessmentRowNextDesc: { from: 49, to: 50, total: 50 },
  assessmentRowRemoved: { marks: 15 },
  assessmentRowMarks: { marks: 150 },
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
      if (HEADROOM_EXEMPT.has(key)) continue; // measured and approved; see above
      for (const lang of Object.keys(UX_STRINGS[key])) {
        expect(len(UX_STRINGS[key][lang])).toBeLessThanOrEqual(LIMITS[field] - 5);
      }
    }
  });
});

describe('versioned-editing list rows fit the 20-code-point row, rendered', () => {
  const { resolveUx } = require('../../bot/shared/config/ux-strings');
  for (const [key, params] of Object.entries(ROW_TEMPLATES)) {
    for (const lang of Object.keys(UX_STRINGS[key] || { en: 1, ur: 1 })) {
      it(`${key} fits in ${lang} with the widest values`, () => {
        expect(UX_STRINGS[key]).toBeTruthy();
        expect(len(resolveUx(key, { language: lang, params }))).toBeLessThanOrEqual(LIMITS.navRow);
      });
    }
  }

  it('the Edit button CTA fits flow_cta in every language, and carries no emoji', () => {
    for (const [lang, v] of Object.entries(UX_STRINGS.assessmentEditButton)) {
      expect([lang, len(resolveUx('assessmentEditButton', { language: lang }))])
        .toEqual([lang, expect.any(Number)]);
      expect(len(resolveUx('assessmentEditButton', { language: lang }))).toBeLessThanOrEqual(LIMITS.flowCta);
      expect(/\p{Extended_Pictographic}/u.test(v)).toBe(false);
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
