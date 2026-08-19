/**
 * bd-osmk0 — an Urdu-content report rendered in the LATIN/LTR branch printed
 * every Urdu glyph as a TOFU BOX on production.
 *
 * How a report ends up there: `hero-report.service.js` resolves
 *   lang = language || analysis.language || session.transcript_language || 'en'
 * and `transcript_language` is an STT label. Since 2026-08-11 Soniox has been
 * labelling Urdu classroom audio as `en` / `hindi` / `javanese`, so `RTL` is
 * false while the LLM body is still Urdu. The template then selected
 *   bodyFam = 'Lexend',sans-serif   headFam = 'Fraunces',serif
 * neither of which covers Urdu, and neither of which names the NastaliqUrdu
 * @font-face the template already embeds. Railway's Chromium has NO system
 * fonts, so the glyphs had nothing to fall back to and painted as boxes.
 * (macOS substitutes a system Nastaliq, which is why it always looked fine
 * locally — verified with CSS.getPlatformFontsForNode: in the LTR branch the
 * Urdu run resolved to the SYSTEM 'Noto Nastaliq Urdu', isCustomFont=false.)
 *
 * 44 already-generated reports carry non-Latin script in a non-ur/ar branch.
 *
 * The fix is the one bd-2644 applied to the coach card: the Urdu/Arabic faces
 * are a PERMANENT FALLBACK in every branch, never gated on the report language.
 */

const fs = require('fs');
const path = require('path');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

const TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'bot', 'shared', 'services', 'coaching', 'report-v2', 'hero-report.template.js',
);

const URDU_AFFIRMATION = 'آپ نے آج بہت اچھا پڑھایا';
const URDU_MOMENT = 'شاباش، بہت خوب';

/** An Urdu-BODY view-model whose `language` is the mislabelled STT code. */
function urduBodyMislabelled(language) {
  return {
    language,
    teacherName: 'mr. muhammad waqas',
    topic: 'ریاضی',
    date: '2026-08-19',
    score: { overall: 74, marks: 110, max: 148 },
    groups: [{ name: 'Lesson Plan Fidelity', score: 32, max: 40, pct: 80 }],
    tryNext: 'اگلی کلاس میں طلبہ سے کھلے سوالات پوچھیں',
    trend: [],
    narrative: {
      affirmation: URDU_AFFIRMATION,
      identity: 'آپ ایک محتاط استاد ہیں',
      moments: [{ quote: URDU_MOMENT, why: 'اچھا لمحہ' }],
      strength_name: 'واضح ہدایات',
      strength_note: 'آپ کی ہدایات واضح تھیں',
      horizon_title: 'مزید سوالات',
      horizon_note: 'مزید کھلے سوالات کریں',
    },
  };
}

/**
 * Pull a declaration's value out of the rendered <style>. We assert on the CSS
 * the browser actually receives, not on the template source — and the source is
 * comment-stripped wherever we do read it (language-protocol §7.1: a source
 * assertion that lands on a comment passes against broken code).
 */
function fontFamilyOf(html, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`${esc}\\{([^}]*)\\}`).exec(html);
  if (!rule) throw new Error(`no CSS rule found for "${selector}"`);
  const decl = /font-family:([^;}]+)/.exec(rule[1]);
  return decl ? decl[1].trim() : null;
}

// Every language code that has actually appeared in transcript_language on prod
// and is NOT ur/ar — each one drives the report into the Latin/LTR branch.
const MISLABELS = ['en', 'hindi', 'javanese', 'sindhi'];

describe('bd-osmk0 — Urdu must never be fontless, whatever the report language is', () => {
  describe.each(MISLABELS)('report language "%s" with an Urdu body', (lang) => {
    const html = buildHeroReportHtml(urduBodyMislabelled(lang));

    it('still carries the Urdu content (guards against the test going vacuous)', () => {
      expect(html).toContain(URDU_AFFIRMATION);
      expect(html).toContain(URDU_MOMENT);
    });

    it('names an Urdu-capable face in the BODY font stack', () => {
      expect(fontFamilyOf(html, '.report')).toMatch(/NastaliqUrdu/);
    });

    it('names an Urdu-capable face in the HEADING font stack', () => {
      expect(fontFamilyOf(html, '.hero h1')).toMatch(/NastaliqUrdu/);
    });

    it('embeds the NastaliqUrdu @font-face with a real, non-empty payload', () => {
      expect(html).toMatch(
        /@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{100,}/,
      );
    });
  });

  it('keeps Nastaliq FIRST for a correctly-labelled Urdu report (no regression)', () => {
    const html = buildHeroReportHtml(urduBodyMislabelled('ur'));
    expect(fontFamilyOf(html, '.report')).toMatch(/^'NastaliqUrdu'/);
    expect(html).toContain('dir="rtl"');
  });

  it('keeps Arabic on Naskh and still reaches it from the Latin branch', () => {
    const ar = buildHeroReportHtml(urduBodyMislabelled('ar'));
    expect(fontFamilyOf(ar, '.report')).toMatch(/^'NaskhArabic'/);
    const en = buildHeroReportHtml(urduBodyMislabelled('en'));
    expect(fontFamilyOf(en, '.report')).toMatch(/NaskhArabic/);
  });

  it('leaves Latin resolving to Lexend/Fraunces FIRST in the Latin branch', () => {
    const html = buildHeroReportHtml(urduBodyMislabelled('en'));
    expect(fontFamilyOf(html, '.report')).toMatch(/^'Lexend'/);
    expect(fontFamilyOf(html, '.hero h1')).toMatch(/^'Fraunces'/);
  });

  it('has no branch that names Lexend or Fraunces as the ONLY family for prose', () => {
    // language-protocol §7.1 — strip comments so the assertion cannot pass on
    // a comment that merely mentions the fix.
    const src = fs.readFileSync(TEMPLATE_PATH, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const bodyFam = /const bodyFam = ([^\n]+)/.exec(src)[1];
    const headFam = /const headFam = ([^\n]+)/.exec(src)[1];
    // The Latin arm of each ternary must not end at a Latin-only family.
    expect(bodyFam).toMatch(/NastaliqUrdu[^\n]*NaskhArabic|NaskhArabic[^\n]*NastaliqUrdu/);
    expect(headFam).toMatch(/NastaliqUrdu[^\n]*NaskhArabic|NaskhArabic[^\n]*NastaliqUrdu/);
  });
});
