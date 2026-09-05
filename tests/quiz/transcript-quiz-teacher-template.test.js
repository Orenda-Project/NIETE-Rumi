'use strict';
/**
 * The teacher's pre-send PDF.
 *
 * Round 1 (bd-mg9c7.10) established the PlayWriteReports rules: embedded
 * Nastaliq, RTL for Urdu, Latin runs isolated, and one card per question
 * carrying the SLO, the why and every distractor's meaning.
 *
 * Round 4 (PLAN_R4 D1/D4/D5) reshapes what is ON that sheet:
 *   D1  ONE language per document — the quiz's. The round-2 chrome/content
 *       split put Urdu labels around English questions.
 *   D4  the author call also emits `lesson_summary` and per-question
 *       `selected_because`; both open the document / close each card.
 *   D5  three pages for eight questions: no per-distractor "child hears"
 *       prose, options in the order the CHILD sees them, one compressed line
 *       per wrong option.
 */
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const VideoRender = require('../../bot/shared/services/quiz/video-quiz-render.service');

const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
  slos: [{ id: 'S1', statement: 'آدھے کو کسر میں لکھنا', taught_level: 'recall' },
         { id: 'S2', statement: 'برابر حصوں کی پہچان', taught_level: 'understand' }],
  key_terms: [{ term: 'fraction', as_spoken: 'fraction' }], examples_used: ['آدھی روٹی'],
};
const QUESTIONS = [
  { external_id: 'tq:q-1:S1:1', question_text: 'آدھی روٹی کا fraction کیا ہے؟', option_a: '½', option_b: '⅓', option_c: '¼', correct_option: 'A',
    explanation: 'روٹی دو برابر حصوں میں کٹی، ایک حصہ آدھا ہے۔',
    media: { selected_because: 'جب آپ نے بورڈ پر روٹی دو حصوں میں کاٹی' },
    distractor_misconceptions: { B: 'تین حصے سمجھنا', C: 'چار حصے سمجھنا' },
    option_feedback: { correct: 'بالکل — ایک بٹا دو۔', wrong: { 1: 'تین حصے نہیں تھے۔', 2: 'چار حصے نہیں تھے۔' } } },
  { external_id: 'tq:q-1:S2:2', question_text: 'کون سے حصے برابر ہیں؟', option_a: 'دو برابر ٹکڑے', option_b: 'ایک بڑا ایک چھوٹا', option_c: 'تین ٹکڑے', correct_option: 'A',
    explanation: 'کسر کے لیے حصے برابر ہونے چاہییں۔', selected_because: 'برابر اور غیر برابر ٹکڑوں کی مثال',
    distractor_misconceptions: { B: 'کوئی بھی حصے', C: 'گنتی' },
    option_feedback: { correct: 'ٹھیک — برابر حصے۔', wrong: { 1: 'حصے برابر نہیں۔', 2: 'گنتی نہیں، برابری۔' } } },
];
const SUMMARY_UR = 'آپ نے آدھی روٹی سے شروع کیا اور بورڈ پر برابر حصے دکھائے۔ پھر بچوں سے proper fraction لکھوایا۔';
const SUMMARY_EN = 'You started with half a roti and drew equal parts on the board. Then the class wrote proper fractions for the shaded parts.';
const BASE = {
  topic: 'کسریں', teacherName: 'Rifat Noor', grade: '4', date: '5 ستمبر 2026',
  link: 'https://wa.me/923222482222?text=QUIZ-ABC234', digest: DIGEST, questions: QUESTIONS,
  language: 'ur', lessonSummary: SUMMARY_UR,
};

describe('Urdu render', () => {
  const html = render(BASE);
  test('<html dir="rtl" lang="ur"> with a non-empty embedded Nastaliq face', () => {
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]{100,}/);
  });
  test('Urdu chrome present, English chrome absent, .ltr rule forces direction', () => {
    expect(html).toMatch(/کوئز/);
    expect(html).not.toMatch(/What this quiz checks/);
    expect(html).toMatch(/\.ltr\{[^}]*direction:ltr/);
  });
  test('every question shows its SLO, the options and each distractor’s meaning', () => {
    expect(html).toMatch(/آدھے کو کسر میں لکھنا/);
    expect(html).toMatch(/تین حصے سمجھنا/);
    expect(html).toMatch(/آدھی روٹی کا/);
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
});

describe('English render', () => {
  const html = render({ ...BASE, language: 'en', topic: 'Fractions', date: '5 Sep 2026', lessonSummary: SUMMARY_EN });
  test('ltr, English chrome, Urdu chrome absent', () => {
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/What this quiz checks/);
    expect(html).not.toMatch(/یہ کوئز کیا جانچتا ہے/);
  });
});

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

const MIXED = { ...BASE, language: 'en', contentLanguage: 'ur', topic: 'کسریں', date: '5 Sep 2026' };

/**
 * D1. The operator opened an English PDF and found Urdu down the side of it.
 * A document now speaks ONE language: the quiz's. `language` is what the
 * teacher's menu is in — it decides her WhatsApp messages, never this sheet.
 */
describe('PLAN_R4 D1 — one language per document', () => {
  test('an Urdu quiz sent to an English-reading teacher is an ENTIRELY Urdu document', () => {
    const html = render(MIXED);
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/یہ کوئز کیا جانچتا ہے/);
    expect(html).toMatch(/آپ نے کیا پڑھایا/);
    expect(html).not.toMatch(/What this quiz checks/);
    expect(html).not.toMatch(/What you taught/);
    expect(html).not.toMatch(/From your lesson/);
  });

  test('and the mirror: an English quiz for an Urdu-reading teacher is an ENTIRELY English document', () => {
    const html = render({
      ...BASE, language: 'ur', contentLanguage: 'en', topic: 'Proper fractions', lessonSummary: SUMMARY_EN,
      questions: [{ external_id: 'tq:q-1:S1:1', question_text: 'Which fraction is shaded?', option_a: '3/4', option_b: '1/4', option_c: '4/3', correct_option: 'A', selected_because: 'the roti you shaded on the board', distractor_misconceptions: { B: 'counted the unshaded part instead' } }],
      digest: { ...DIGEST, slos: [{ id: 'S1', statement: 'Name the fraction that is shaded', taught_level: 'recall' }] },
    });
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/What this quiz checks/);
    expect(html).not.toMatch(/یہ کوئز کیا جانچتا ہے/);
    expect(html).not.toMatch(/سیکھنے کے مقاصد/);
  });

  test('contentLanguage still defaults to the single-language caller’s language', () => {
    const html = render({ ...BASE, language: 'ur' });
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
  });

  test('a NAME keeps the script it was typed in, whatever the document’s language', () => {
    const html = render({ ...BASE, language: 'en', contentLanguage: 'en', topic: 'Fractions', teacherName: 'رفعت نور', lessonSummary: SUMMARY_EN });
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/<span class="nm" dir="rtl">رفعت نور<\/span>/);
    expect(ruleFor(html, '.nm')).toMatch(/font-family:'NastaliqUrdu'/);
  });

  test('a Latin name inside an Urdu document is isolated LTR', () => {
    const html = render(BASE);
    expect(html).toMatch(/<span class="nm" dir="ltr">Rifat Noor<\/span>/);
  });

  test('EVERY font-family declaration still names both a Latin family and NastaliqUrdu', () => {
    const decls = fontFamilyDeclarations(render(MIXED));
    expect(decls.length).toBeGreaterThan(5);
    decls.forEach((decl) => {
      expect(decl).toMatch(/NastaliqUrdu/);
      expect(decl).toMatch(/Lexend|Fraunces/);
    });
  });

  test('the RTL content rule puts NastaliqUrdu first and gives Urdu room to breathe', () => {
    const rule = ruleFor(render(MIXED), '.content[dir="rtl"]');
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/font-family:'NastaliqUrdu'/);
    expect(rule).toMatch(/line-height:1\.85/);
  });
});

/**
 * D4/D5. "In the beginning of the report there needs to be a nice section
 * that tells the teacher what they taught that led to these questions."
 */
describe('PLAN_R4 D4 — what you taught, and why each question was chosen', () => {
  test('the lesson summary opens the document under its own label', () => {
    const html = render({ ...BASE, language: 'en', contentLanguage: 'en', topic: 'Fractions', lessonSummary: SUMMARY_EN });
    const labelAt = html.indexOf('What you taught');
    const summaryAt = html.indexOf('You started with half a roti');
    const checksAt = html.indexOf('What this quiz checks');
    expect(labelAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeGreaterThan(labelAt);
    expect(checksAt).toBeGreaterThan(labelAt);
    expect(html.indexOf('class="qs"')).toBeGreaterThan(summaryAt);
  });

  test('no summary, no empty panel', () => {
    const html = render({ ...BASE, lessonSummary: '' });
    expect(html).not.toMatch(/آپ نے کیا پڑھایا/);
  });

  test('every question carries its one-line “from your lesson”, read from either shape', () => {
    const html = render(BASE);
    expect(html).toMatch(/آپ کے سبق سے/);
    expect(html).toMatch(/جب آپ نے بورڈ پر روٹی دو حصوں میں کاٹی/);   // media.selected_because
    expect(html).toMatch(/برابر اور غیر برابر ٹکڑوں کی مثال/);          // q.selected_because
  });
});

/**
 * D5. Nine pages for eight questions, because every distractor carried three
 * lines of prose. The child-facing feedback belongs on the phone.
 */
describe('PLAN_R4 D5 — the sheet is scannable', () => {
  const html = render(BASE);

  test('the per-distractor “what the child is told” prose is gone', () => {
    expect(html).not.toMatch(/تین حصے نہیں تھے/);
    expect(html).not.toMatch(/بچے کو بتایا جائے گا/);
    expect(html).not.toMatch(/the child is told/i);
  });

  test('the “when they get it right” prose is gone too', () => {
    expect(html).not.toMatch(/بالکل — ایک بٹا دو/);
  });

  test('each wrong option is ONE compressed line: the option, then ≤8 words of meaning', () => {
    const long = { ...QUESTIONS[0], distractor_misconceptions: { B: 'the child is counting every single piece on the board instead of the shaded ones' } };
    const out = render({ ...BASE, language: 'en', contentLanguage: 'en', questions: [long] });
    expect(out).toMatch(/the child is counting every single piece on…/);
    expect(out).not.toMatch(/instead of the shaded ones/);
  });

  test('cards never break across a page', () => {
    expect(ruleFor(html, '.card')).toMatch(/break-inside:\s*avoid/);
  });

  test('the hero names her class', () => {
    const out = render({ ...BASE, language: 'en', contentLanguage: 'en', grade: '4' });
    expect(out).toMatch(/Grade 4/);
  });
});

/**
 * The teacher and the child must agree about which option is "B". The sender
 * shuffles display position with a shuffle seeded on external_id.
 */
describe('PLAN_R4 D5 — the options are in the order the CHILD sees them', () => {
  const ROW = {
    external_id: 'tq:q-9:S1:3', question_text: 'Which number comes after 29?',
    option_a: '31', option_b: '28', option_c: '30', correct_option: 'C',
    distractor_misconceptions: { A: 'counting past the range', B: 'the number before' },
    selected_because: 'the count from 26 to 30 you led aloud',
  };
  const html = render({ ...BASE, language: 'en', contentLanguage: 'en', topic: 'Numbers', questions: [ROW], digest: { slos: [] } });

  test('the letters follow the sender’s displayOrder, not the stored A/B/C', () => {
    const labels = VideoRender.optionLabels(ROW);
    const order = VideoRender.displayOrder(ROW, labels);
    const rendered = [...html.matchAll(/<span class="otext">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(rendered).toEqual(order.map((stored) => labels[stored]));
  });

  test('the correct option is the highlighted one, wherever the shuffle put it', () => {
    const labels = VideoRender.optionLabels(ROW);
    const order = VideoRender.displayOrder(ROW, labels);
    const correctPos = order.indexOf(2);   // stored 'C' = '30'
    const marked = [...html.matchAll(/<div class="opt( correct)? content"/g)].map((m) => Boolean(m[1]));
    expect(marked[correctPos]).toBe(true);
    expect(marked.filter(Boolean)).toHaveLength(1);
  });

  test('the correct row is marked by its ground and a word, never a font glyph', () => {
    expect(html).toMatch(/class="opt correct content"[^>]*><span class="mark"><span class="dia2">/);
    expect(html).toMatch(/<span class="tag">correct<\/span>/);
    expect(html).not.toMatch(/○|●|✓|→/);
  });

  test('EVERY option keeps its letter — the child taps a letter, not a tick', () => {
    const letters = [...html.matchAll(/<span class="dia2"><span>([A-C])<\/span>/g)].map((m) => m[1]);
    expect(letters).toEqual(['A', 'B', 'C']);
  });
});

/**
 * On the Urdu sheet `x^2` printed as "²x" and `H2O` as "O₂H". richNotation ran
 * first, its <sup> split the Latin run into two isolates, and an RTL paragraph
 * lays two isolates out right-to-left. One run, one isolate, one direction.
 */
describe('notation inside an Urdu document', () => {
  const html = render({
    ...BASE,
    questions: [{ external_id: 'tq:q-1:S1:1', question_text: 'یہاں x^2 اور H2O دیکھیں', option_a: 'x^2', option_b: 'H2O', option_c: 'ٹھیک', correct_option: 'A', selected_because: 'بورڈ والا لمحہ' }],
  });

  test('a notation token is ONE ltr isolate, tags and all', () => {
    expect(html).toMatch(/<span class="ltr">x<sup>2<\/sup><\/span>/);
    expect(html).toMatch(/<span class="ltr">H<sub>2<\/sub>O<\/span>/);
  });

  test('and never two isolates the paragraph can reorder', () => {
    expect(html).not.toMatch(/<span class="ltr">x<\/span><sup>/);
    expect(html).not.toMatch(/<\/span><sup>2<\/sup>/);
  });
});

describe('NIETE brand hero', () => {
  const html = render(MIXED);

  test('carries the on-dark NIETE mark as an embedded base64 image', () => {
    expect(html).toMatch(/<img class="hero-mark" src="data:image\/png;base64,[A-Za-z0-9+/=]{500,}"/);
  });

  test('draws a diamond lattice behind the hero programmatically', () => {
    expect(html).toMatch(/<svg class="lattice"/);
    expect(html).toMatch(/pattern id="niete-lattice/);
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

describe('the figure slot', () => {
  test('a question carrying figureSvg renders it before the stem and before the options', () => {
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

  test('a wide figure takes the full column above the stem; a square one sits beside it', () => {
    const wideSvg = '<svg viewBox="0 0 1080 260"><line class="numberline"/></svg>';
    const squareSvg = '<svg viewBox="0 0 400 380"><rect class="grid"/></svg>';
    const wide = render({ ...MIXED, questions: [{ ...QUESTIONS[0], figureSvg: wideSvg }] });
    const square = render({ ...MIXED, questions: [{ ...QUESTIONS[0], figureSvg: squareSvg }] });
    expect(wide).toMatch(/class="figure wide"/);
    expect(wide.indexOf('class="figure wide"')).toBeLessThan(wide.indexOf('class="cmain"'));
    expect(square).toMatch(/class="figure"/);
    expect(square.indexOf('class="cmain"')).toBeLessThan(square.indexOf('class="figure"'));
  });

  test('the figure box is height-capped so a tall SVG scales down instead of spilling across pages', () => {
    const html = render({ topic: 'x', teacherName: 'T', date: '5 Sep', link: 'https://wa.me/1', digest: { slos: [] },
      questions: [{ question_text: 'q', option_a: 'a', option_b: 'b', option_c: 'c', correct_option: 'A', figureSvg: '<svg viewBox="0 0 100 900"></svg>' }],
      language: 'en', contentLanguage: 'en' });
    expect(ruleFor(html, '.figure svg,.figure img')).toMatch(/max-height:\s*1[0-9]{2}px/);
  });
});
