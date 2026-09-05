'use strict';
/**
 * bd-mg9c7.10 — the teacher's PDF. PlayWriteReports rules: embedded Nastaliq,
 * RTL for Urdu, per-language chrome, Latin runs isolated. Content: every
 * question shows its SLO, the why, each distractor's misconception and the
 * child guidance.
 */
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');

const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
  slos: [{ id: 'S1', statement: 'آدھے کو کسر میں لکھنا', taught_level: 'recall' },
         { id: 'S2', statement: 'برابر حصوں کی پہچان', taught_level: 'understand' }],
  key_terms: [{ term: 'fraction', as_spoken: 'fraction' }], examples_used: ['آدھی روٹی'],
};
const QUESTIONS = [
  { external_id: 'tq:S1:1', question_text: 'آدھی روٹی کا fraction کیا ہے؟', option_a: '½', option_b: '⅓', option_c: '¼', correct_option: 'A',
    explanation: 'روٹی دو برابر حصوں میں کٹی، ایک حصہ آدھا ہے۔',
    distractor_misconceptions: { B: 'تین حصے سمجھنا', C: 'چار حصے سمجھنا' },
    option_feedback: { correct: 'بالکل — ایک بٹا دو۔', wrong: { 1: 'تین حصے نہیں تھے۔', 2: 'چار حصے نہیں تھے۔' } } },
  { external_id: 'tq:S2:2', question_text: 'کون سے حصے برابر ہیں؟', option_a: 'دو برابر ٹکڑے', option_b: 'ایک بڑا ایک چھوٹا', option_c: 'تین ٹکڑے', correct_option: 'A',
    explanation: 'کسر کے لیے حصے برابر ہونے چاہییں۔', distractor_misconceptions: { B: 'کوئی بھی حصے', C: 'گنتی' },
    option_feedback: { correct: 'ٹھیک — برابر حصے۔', wrong: { 1: 'حصے برابر نہیں۔', 2: 'گنتی نہیں، برابری۔' } } },
];
const BASE = { topic: 'کسریں', teacherName: 'Rifat Noor', date: '5 ستمبر 2026', link: 'https://wa.me/923222482222?text=QUIZ-ABC234', digest: DIGEST, questions: QUESTIONS, language: 'ur' };

describe('Urdu render', () => {
  const html = render(BASE);
  test('<html dir="rtl" lang="ur"> with a non-empty embedded Nastaliq face', () => {
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]{100,}/);
  });
  test('Urdu chrome present, English chrome absent, .ltr rule forces direction', () => {
    expect(html).toMatch(/کوئز/);
    expect(html).not.toMatch(/Why this question/);
    expect(html).toMatch(/\.ltr\{[^}]*direction:ltr/);
  });
  test('every question shows its SLO, the why, each distractor’s misconception and the child guidance', () => {
    expect(html).toMatch(/آدھے کو کسر میں لکھنا/);
    expect(html).toMatch(/روٹی دو برابر حصوں میں کٹی/);
    expect(html).toMatch(/تین حصے سمجھنا/);
    expect(html).toMatch(/چار حصے نہیں تھے/);
    expect(html).toMatch(/بالکل — ایک بٹا دو/);
  });
  test('marks the correct option and isolates Latin runs', () => {
    expect(html).toMatch(/class="opt correct content"/);
    expect(html).toMatch(/<span class="ltr">fraction<\/span>/);
  });
  test('uses the NIETE palette, never the Rumi navy', () => {
    expect(html).toMatch(/#333748/);
    expect(html).toMatch(/#47BA7D/i);
    expect(html).not.toMatch(/#0c1a4e/);
  });
  test('names no grade anywhere', () => {
    expect(html).not.toMatch(/جماعت\s*\d/);
    expect(html).not.toMatch(/Grade\s*\d/);
  });
});

describe('English render', () => {
  const html = render({ ...BASE, language: 'en', topic: 'Fractions', date: '5 Sep 2026' });
  test('ltr, English chrome, Urdu chrome absent', () => {
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Why this question/);
    expect(html).not.toMatch(/یہ سوال کیوں/);
  });
});

/**
 * Round 2 — the teacher's chrome language and the quiz's content language are
 * two different things. Staging shipped a teacher whose preference is English
 * a fully Urdu quiz: because every font-family was keyed on the TEACHER's
 * language, every Urdu question sat on a Latin-only face and rendered as tofu
 * on the Linux container (macOS silently substituted a system font, so the
 * dry runs looked fine).
 */

/** The CSS between <style>…</style>, minus the @font-face blocks (those name
 *  a single family by definition — they ARE the face declarations). */
function styleRules(html) {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  return css.replace(/@font-face\{[^}]*\}/g, '');
}
function fontFamilyDeclarations(html) {
  return styleRules(html).match(/font-family:[^;}]+/g) || [];
}
/** The body of the first CSS rule whose selector matches `selector`. */
function ruleFor(html, selector) {
  const re = new RegExp(`${selector.replace(/[.[\]()*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = styleRules(html).match(re);
  return m ? m[1] : null;
}

const MIXED = {
  ...BASE, language: 'en', contentLanguage: 'ur', topic: 'کسریں', date: '5 Sep 2026',
};

describe('bd-mg9c7.26 — teacher chrome in one language, quiz content in another', () => {
  const html = render(MIXED);

  test('the document chrome is English but each quiz stem is an RTL .content block', () => {
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Why this question/);
    // the stem element itself carries dir="rtl" and the content class
    expect(html).toMatch(/<div class="stem content" dir="rtl">[^<]*آدھی روٹی/);
  });

  test('the RTL content rule puts NastaliqUrdu first and gives Urdu room to breathe', () => {
    const rule = ruleFor(html, '.content[dir="rtl"]');
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/font-family:'NastaliqUrdu'/);
    expect(rule).toMatch(/line-height:1\.9/);
  });

  test('EVERY font-family declaration names both a Latin family and NastaliqUrdu', () => {
    const decls = fontFamilyDeclarations(html);
    expect(decls.length).toBeGreaterThan(5);
    decls.forEach((d) => {
      expect(d).toMatch(/NastaliqUrdu/);
      expect(d).toMatch(/Lexend|Fraunces/);
    });
  });

  test('options, the why and the distractor meanings are content blocks too', () => {
    expect(html).toMatch(/<div class="opt content[^"]*" dir="rtl">/);
    expect(html).toMatch(/<div class="why"><b>Why this question:<\/b> <span class="whytext content" dir="rtl">/);
  });

  test('Latin isolation is applied to the Urdu CONTENT even though the chrome is English', () => {
    expect(html).toMatch(/<span class="ltr">fraction<\/span>/);
  });
});

describe('bd-mg9c7.26 — NIETE brand hero', () => {
  const html = render(MIXED);

  test('carries the on-dark NIETE mark as an embedded base64 image', () => {
    expect(html).toMatch(/<img class="hero-mark" src="data:image\/png;base64,[A-Za-z0-9+/=]{500,}"/);
  });

  test('draws a diamond lattice behind the hero programmatically', () => {
    expect(html).toMatch(/<svg class="lattice"/);
    expect(html).toMatch(/pattern id="niete-lattice/);
  });

  test('badges the audience with the brand-book lockup line', () => {
    expect(html).toMatch(/FOR TEACHERS/);
  });

  test('markers are diamonds, never round dots or font glyphs', () => {
    expect(html).toMatch(/<svg class="dia"/);
    expect(html).not.toMatch(/○|●|✓/);
  });

  test('uses no Rumi navy and no gold anywhere', () => {
    expect(html).not.toMatch(/#001F3F/i);
    expect(html).not.toMatch(/#F5B301/i);
    expect(html).not.toMatch(/#D9A233/i);
    expect(html).not.toMatch(/#fff4d6|#9a6b00/i);
  });
});

describe('bd-mg9c7.26 — figure slot (filled by the picture engine later)', () => {
  test('a question carrying figureSvg renders it above the stem and above the options', () => {
    const withFigure = {
      ...MIXED,
      questions: [{ ...QUESTIONS[0], figureSvg: '<svg viewBox="0 0 10 10"><line class="numberline"/></svg>' }],
    };
    const html = render(withFigure);
    const figureAt = html.indexOf('class="figure"');
    const stemAt = html.indexOf('class="stem content"');
    const optsAt = html.indexOf('class="opts"');
    expect(figureAt).toBeGreaterThan(-1);
    expect(figureAt).toBeLessThan(stemAt);
    expect(stemAt).toBeLessThan(optsAt);
    expect(html).toMatch(/class="numberline"/);
  });

  test('a question with no figure renders no empty figure wrapper', () => {
    expect(render(MIXED)).not.toMatch(/class="figure"/);
  });
});

describe('bd-mg9c7.26 — contentLanguage defaults to the chrome language', () => {
  test('an Urdu teacher with an Urdu quiz still renders exactly as before', () => {
    const html = render({ ...BASE, language: 'ur' });
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/<div class="stem content" dir="rtl">/);
  });
});

describe('a figure never takes over the page', () => {
  test('the figure box is height-capped so a tall SVG scales down instead of spilling across pages', () => {
    const html = render({ topic: 'x', teacherName: 'T', date: '5 Sep', link: 'https://wa.me/1', digest: { slos: [] },
      questions: [{ question_text: 'q', option_a: 'a', option_b: 'b', option_c: 'c', correct_option: 'A', figureSvg: '<svg viewBox="0 0 100 900"></svg>' }],
      language: 'en', contentLanguage: 'en' });
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(css).toMatch(/\.figure svg[^{]*\{[^}]*max-height:\s*2[0-9]{2}px/);
  });
});
