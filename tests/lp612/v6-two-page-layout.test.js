/**
 * bd-f01ob — THE v6 TWO-PAGE LAYOUT: page 1 teaches, page 2 supports, and nothing is mixed.
 *
 * Operator, on the v5 one-page mockup (2026-09-24): *"board plan to go into 2nd page, its not the
 * most imperative thing to see, keep it 2 pages, 1 page teaching, next page teacher suppport,
 * dont mix it up / ensure the visuals to show come where its needed either in development or in
 * practice"* — then *"approved"* on v6. Earlier on the same mockup: *"next period should lso be
 * gone"*.
 *
 * This REVERSES bd-a8veu.7, which moved the board plan into the Introduction. The board plan is
 * the first support section again; `S()` letters it A and the rest close up behind it
 * (render-law 15). Mistakes and differentiation stay in the flow (bd-a8veu.10) — v6 keeps them
 * on page 1. The sequence strip loses its `Next:` leg: the teacher needs where this lesson came
 * from and where it is checked, not the next one.
 *
 * Render-only. `page2.board_final` and `sequence.next` stay in the document and the schema, so a
 * stored lesson re-renders into this layout at no model cost.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

const buildAll = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) });
/** Everything after the stylesheet — CSS comments ship verbatim and would satisfy a needle. */
const body = (html) => html.slice(html.lastIndexOf('</style>') + 8);
const split = (d, lang) => {
  const b = body(buildAll(d, lang).html);
  const at = b.indexOf('class="p2head');
  if (at < 0) throw new Error('no support-page header in the render');
  return { teach: b.slice(0, at), support: b.slice(at) };
};
const seqStrip = (html) => {
  const b = body(html);
  // `atom()` appends `sp-N` to the class attribute, so match the word, not the closing quote
  const i = b.search(/class="seq\b/);
  return b.slice(i, b.indexOf('</div>', i));
};

const BOARD_STEP = 'Write the two matrices side by side';
const ORD = 'class="ord"';

describe('the board plan is teacher support, not teaching', () => {
  test.each(['en', 'ur'])('the draw-order card is on the support page, not the teach page (%s)', (lang) => {
    const { teach, support } = split(load(), lang);
    expect(teach).not.toContain(ORD);
    expect(support).toContain(ORD);
    if (lang === 'en') expect(support).toContain(BOARD_STEP);
  });

  test('it is the FIRST support section — lettered A, before every other one', () => {
    const { support } = split(load(), 'en');
    expect(support).toMatch(/data-sec="p2-A"[\s\S]{0,200}class="nm">The board at the end of the lesson</);
    expect(support.indexOf(ORD)).toBeLessThan(support.indexOf('data-sec="p2-B"'));
  });

  test('the board diagram travels with the order, and leads it', () => {
    const { teach, support } = split(load(), 'en');
    const fig = support.indexOf('<figure class="dg"');
    expect(fig).toBeGreaterThan(-1);
    expect(fig).toBeLessThan(support.indexOf(ORD));
    // exactly one draw-order card in the whole plan — a move, not a copy
    expect((teach + support).match(/class="ord"/g)).toHaveLength(1);
  });

  test('a board plan with no diagram still lands on the support page', () => {
    const d = load();
    delete d.page2.board_final.diagram;
    const { teach, support } = split(d, 'en');
    expect(teach).not.toContain(ORD);
    expect(support).toContain(ORD);
  });

  test('the section name is printed once — the bar, not a second label under it', () => {
    const { support } = split(load(), 'en');
    expect(support.split('The board at the end of the lesson').length - 1).toBe(1);
  });
});

describe('the sequence strip names where the lesson sits, not the next period', () => {
  test.each(['en', 'ur'])('no Next leg is painted (%s)', (lang) => {
    const d = load();
    d.sequence.next = 'ZZ_SEQ_NEXT_SENTINEL_ZZ';
    const html = buildAll(d, lang).html;
    expect(body(html)).not.toContain('ZZ_SEQ_NEXT_SENTINEL_ZZ');
    expect(seqStrip(html)).not.toContain('Next:');
  });

  test('Last, this lesson and Checkpoint stay, with no arrow hanging off this lesson', () => {
    const d = load();
    const s = seqStrip(buildAll(d, 'en').html);
    expect(s).toContain('Last:');
    expect(s).toContain('Checkpoint:');
    expect(s).toContain(d.sequence.this.replace(/&/g, '&amp;'));
    // one arrow: previous -> this. Nothing after this lesson for an arrow to point at.
    expect([...s.matchAll(/class="arrow"/g)]).toHaveLength(1);
    expect(s).not.toMatch(/class="now"[^>]*>[\s\S]*?class="arrow"[\s\S]*?<\/span>\s*<\/span>/);
  });
});

/** Atoms of a part in paint order, each tagged with the section bar above it (flow-placement). */
const walk = (part) => {
  let sec = null;
  return part.split('data-atom').slice(1).map((html) => {
    const m = /class="(?:bar|p2bar)[^"]*"\s*data-sec="([^"]+)"/.exec(html);
    if (m) sec = m[1];
    return { sec, html };
  });
};
const secsOf = (part, re) => walk(part).filter((a) => re.test(a.html)).map((a) => a.sec);

describe('everything used while teaching stays on page 1', () => {
  test('common mistakes and differentiation are on the teach page, none on the support page', () => {
    const { teach, support } = split(load(), 'en');
    expect(secsOf(teach, /class="mis\b/).length).toBeGreaterThan(0);
    expect(secsOf(teach, /class="mis\b/).every((s) => s === 'development')).toBe(true);
    expect(secsOf(support, /class="mis\b/)).toEqual([]);
    expect(teach).toContain('If stuck');
    expect(support).not.toContain('If stuck');
  });

  test('visuals render where they are used — Development and practice — never on page 2', () => {
    const d = load();
    d.sections
      .find((s) => s.id === 'activity')
      .blocks.unshift({ type: 'textbook_figure', ref: 'ZZ_FIG', figure_label: 'ZZ_FIG_LABEL', page: '83' });
    const { teach, support } = split(d, 'en');
    expect(secsOf(teach, /ZZ_FIG_LABEL/)).toEqual(['activity']);
    expect(support).not.toContain('ZZ_FIG_LABEL');
    // the fixture's own development diagram stays in development
    // (a figure is an atom root: `walk` splits on `data-atom`, so its chunk opens on ` class="dg sp-N"`)
    // Every teach-page figure sits where it is taught: the fixture's diagram in development, the
    // injected book figure in activity — and none in the Introduction, where the board plan was.
    expect(secsOf(teach, /^\s*class="dg\b/).sort()).toEqual(['activity', 'development']);
  });
});
