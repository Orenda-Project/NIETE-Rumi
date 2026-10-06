/* The render matrix (item 10: "whatever the engine emits must render").
 *
 * Every question SHAPE the engine can hand the page (tests/render-matrix/shapes.js — built from
 * the code's own lists: web-quiz-items TYPES, the figure engine's ALLOWED_TYPES, the rows with no
 * web item) × the mutations that break layouts (2-4 options, long stem, long option, maths incl.
 * the TeX commands prod rows carry, empty why, a pictogram that does not exist, a missing figure
 * file, Latin inside Urdu, an Urdu option with a number, a hint) × EN + UR. Each case is a
 * quiz_questions row made into the page payload by the server's own questionPayload().
 *
 * 1. Always (no browser): every case renders through question() and both feedback screens without
 *    throwing, every option shows a word or a picture, and no maths reaches the child as raw TeX or
 *    as a TeX command spelled out in letters.
 * 2. With a Chromium (playwright-core from the bot's dependencies): the same cases at 360×740,
 *    muted — no sideways scroll, nothing off the screen, no overlapping text or answers, labels
 *    inside their buttons, pictures loaded, Urdu in Nastaliq, figure or its fallback present.
 *    Skipped, with the reason printed, when no browser is installed.
 * Hand run with PNGs: node dashboard/tests/render-matrix/run.js --png <dir>
 */
// The molecule figure's openchemlib ships as ESM this jest cannot load: the root suite's stub stands in
// (a molecule question then plays without its drawing here; run.js draws it with the real package).
try {
  jest.doMock(require.resolve('openchemlib', { paths: [require('path').join(__dirname, '../../bot')] }), () => require('../../tests/__mocks__/openchemlib.js'));
} catch (_) { /* the bot's dependencies are not installed: nothing to stand in for */ }
const fs = require('fs');
const path = require('path');
const { cases } = require('./render-matrix/shapes');
const E2 = require('./render-matrix/e2');
const V = require('./render-matrix/vm-page');
const B = require('./render-matrix/browser');

const ALL = cases();
const WQI = require('../public/wq/wq.js');
const CSS = fs.readFileSync(path.join(__dirname, '../public/wq/wq.css'), 'utf8');

describe('the matrix covers what the engine can emit', () => {
  test('every web item type, every drawable figure kind, both languages', () => {
    const shapes = new Set(ALL.map((c) => c.shape));
    ['web_single', 'web_picture', 'web_listen', 'web_multi', 'web_tf', 'web_order', 'web_match', 'web_label', 'web_glyph',
      'row_text', 'row_multi', 'row_emoji', 'row_option_images', 'row_question_image', 'row_figure_undrawable', 'row_match_figure', 'row_stim']
      .forEach((s) => expect(shapes.has(s)).toBe(true));
    const { ALLOWED_TYPES } = require('../../bot/shared/services/quiz/transcript-quiz-figure');
    ALLOWED_TYPES.forEach((t) => expect(shapes.has(`fig_${t}`)).toBe(true));
    expect(new Set(ALL.map((c) => c.lang))).toEqual(new Set(['en', 'ur']));
  });
  test('every case is served (none dropped as unplayable)', () => {
    expect(ALL.filter((c) => !E2.question(c)).map((c) => c.id)).toEqual([]);
  });
});

describe('every shape renders through the page (no browser)', () => {
  test.each(ALL.map((c) => [c.id, c]))('%s', (id, c) => {
    const q = E2.question(c);
    const { faults } = V.renderCase(c, q, E2.payload(c, q));
    expect(faults).toEqual([]);
  });
});

describe('maths: the TeX commands prod questions carry are typeset, never spelled out', () => {
  const letters = (h) => [...h.matchAll(/<mi>([^<]*)<\/mi>/g)].map((m) => m[1]).filter((t) => [...t].length > 1);
  test.each([
    ['\\Omega', '$60\\ \\Omega$', 'Ω'],
    ['\\dots', '$67, 62, 57, \\dots$', '…'],
    ['\\neq', '$9 \\div 3 \\neq 3 \\div 9$', '≠'],
    ['\\rightleftharpoons', '$A \\rightleftharpoons B$', '⇌'],
    ['\\xrightarrow', '$14 \\xrightarrow{\\div 2} 7$', '→'],
  ])('%s', (cmd, src, glyph) => {
    const h = WQI.tex(src);
    expect(letters(h)).toEqual([]);
    expect(h).toContain(glyph);
  });
  test('a column sum (\\begin{array}) is a table of its rows, the answer row under a rule', () => {
    const h = WQI.tex('$\\begin{array}{rr} & 712 \\\\ - & 460 \\\\ \\hline & \\end{array}$');
    expect(letters(h)).toEqual([]);
    expect(h).toMatch(/<mtable/);
    expect((h.match(/<mtr/g) || []).length).toBe(3);
    expect(h).toContain('<mn>712</mn>');
    expect(h).toContain('<mn>460</mn>');
    expect(h).toMatch(/border-top/);
    expect(h).not.toMatch(/[&]amp;|\\\\/);
  });
  test('\\text keeps its spaces ("Rs 40", not "Rs40")', () => {
    expect(WQI.tex('$\\text{Rs } 40$')).toContain('<mtext>Rs </mtext>');
  });
  test('a maths line never pushes past its bubble: it scrolls inside it', () => {
    const r = (/(^|\n)\.wq-mx\{([^}]*)\}/.exec(CSS) || [])[2] || '';
    expect(WQI.tex('$x$')).toMatch(/^<span class="wq-mx"><math/);
    expect(r).toMatch(/max-width:100%/);
    expect(r).toMatch(/overflow-x:auto/);
  });
});

describe('a picture option that could not be drawn', () => {
  const PIC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="20"/></svg>';
  const q = { type: 'picture', text: 'Which one is a mango?', correct_slot: 'A', options: [
    { slot: 'A', text: 'apple', name: 'apple', pic: { svg: PIC, name: 'apple' } },
    { slot: 'B', text: 'banana', name: 'banana' },
    { slot: 'C', text: 'carrot', name: 'carrot', pic: { svg: PIC, name: 'carrot' } }] };
  test('the question plays as words (its word was set at emoji size and pushed the page sideways)', () => {
    expect(WQI.kind(q)).toBe('single');
    const h = WQI.itemHtml(q, { listen: 'Listen' }, 'en');
    expect(h).not.toMatch(/wq-emoji">banana/);
    expect(h).toMatch(/<span class="wq-lab">banana<\/span>/);
  });
  test('a picture question whose every option is drawn stays a picture grid', () => {
    const all = { ...q, options: q.options.map((o) => ({ ...o, pic: { svg: PIC, name: o.name } })) };
    expect(WQI.kind(all)).toBe('picture');
  });
});

describe('a figure file that does not arrive', () => {
  test('the figure hides itself instead of showing a broken picture and its alt text', () => {
    const h = WQI.figureHtml({ figure: { kind: 'img', url: '/api/wq/media/AB12CD/q1?k=q', alt: 'A picture' } }, { zoom: 'Zoom' });
    const img = (/<img[^>]*>/.exec(h) || [''])[0];
    expect(img).toMatch(/onerror="[^"]*closest\('figure'\)[^"]*display='none'/);
  });
});

const av = B.available();
const describeBrowser = av.ok ? describe : describe.skip;
if (!av.ok) {
  // eslint-disable-next-line no-console
  console.warn(`render matrix (browser) SKIPPED: ${av.why}. The vm subset above still ran.`);
}
describeBrowser('every shape at 360×740 in Chromium, EN + UR', () => {
  let results = [];
  beforeAll(async () => { results = await B.run(ALL); }, 170000);
  test('ran every served case', () => { expect(results.length).toBe(ALL.length); });
  test('no case fails a layout check', () => {
    const bad = results.filter((r) => r.faults.length).map((r) => `${r.id}: ${r.faults.join(' | ')}`);
    expect(bad).toEqual([]);
  });
});
