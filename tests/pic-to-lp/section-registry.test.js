/**
 * Section-registry conformance guard.
 *
 * SECTION_REGISTRY is the single documented source of the illustrated-LP
 * section order/structure. This test pins the canonical order AND asserts that
 * every built prompt (en + ur, page 1 + page 2) actually contains every section
 * label the registry says belongs on that page — a structural conformance guard
 * that catches the prompt body drifting away from the registry.
 *
 * Because both body templates now read their labels from structuralLabelsFor()
 * (the same table the registry's labelKey resolves against), this also guards
 * against the Urdu-body hardcoded-English-label drift returning.
 */

let Builder;
function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  Builder = require('../../bot/shared/services/pic-to-lp/kieai-prompt-builder.service');
}

const base = { grade: 5, subject: 'Math', topic: 'Fractions', ocrText: '' };

afterEach(() => {
  delete process.env.COACHING_WHATSAPP_NUMBER;
  jest.resetModules();
});

// Canonical order: the exact ids, in order, the registry should list per page.
const EXPECTED_PAGE1_IDS = [
  'warmUp', 'hook', 'bigIdea', 'todaysGoal', 'keyWords', 'iDo', 'writeOnBoard',
];
const EXPECTED_PAGE2_IDS = [
  'weDo', 'youDo', 'needHelp', 'challenge', 'exitTicket', 'coachingCorner',
];

describe('SECTION_REGISTRY structure', () => {
  beforeEach(load);

  it('lists page-1 sections in canonical order', () => {
    const ids = Builder.sectionsForPage(1).map((s) => s.id);
    expect(ids).toEqual(EXPECTED_PAGE1_IDS);
  });

  it('lists page-2 sections in canonical order', () => {
    const ids = Builder.sectionsForPage(2).map((s) => s.id);
    expect(ids).toEqual(EXPECTED_PAGE2_IDS);
  });

  it('every descriptor has id/page/labelKey/role and a resolvable label', () => {
    Builder.SECTION_REGISTRY.forEach((s) => {
      expect(typeof s.id).toBe('string');
      expect([1, 2]).toContain(s.page);
      expect(typeof s.labelKey).toBe('string');
      expect(typeof s.role).toBe('string');
      // labelKey resolves against structuralLabelsFor for every language.
      ['en', 'ur', 'sw', 'ar'].forEach((lang) => {
        expect(typeof Builder.sectionLabel(s.labelKey, lang)).toBe('string');
        expect(Builder.sectionLabel(s.labelKey, lang).length).toBeGreaterThan(0);
      });
    });
  });
});

describe('built prompt contains every registry section label', () => {
  beforeEach(load);

  // en + ur for both pages. (en exercises the structural-English body; ur
  // exercises the Urdu body — the two paths that previously could drift.)
  for (const language of ['en', 'ur']) {
    it(`page 1 (${language}) contains all page-1 section labels`, () => {
      const out = Builder.buildPage1Prompt({ ...base, language });
      Builder.sectionsForPage(1).forEach((s) => {
        const label = Builder.sectionLabel(s.labelKey, language);
        expect(out).toContain(label);
      });
    });

    it(`page 2 (${language}) contains all page-2 section labels`, () => {
      const out = Builder.buildPage2Prompt({ ...base, language });
      Builder.sectionsForPage(2).forEach((s) => {
        const label = Builder.sectionLabel(s.labelKey, language);
        expect(out).toContain(label);
      });
    });
  }
});
