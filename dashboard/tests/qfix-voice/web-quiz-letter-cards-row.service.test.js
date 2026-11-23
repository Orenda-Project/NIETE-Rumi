/**
 * Three Qaida letter cards sit in one row (wq.css, the rules after `.wq-glyph[lang=ar]`).
 *
 * Before (sandbox, Nov 2026): a 3-card letter item drew its cards 2 + 1 at 152 × 220, so the third card's bottom sat at
 * 720-817 px on a 740 px phone: under the fold on 3 of 4 walk items, and on all 25 card items of keys' K5 set.
 * The rendered proof is outputs/lanes/voice/tools/walk_cards.js (live 2 + 1 → branch: one row, 104 × 154, bottom ≤ 508 px).
 * This file holds what a test can execute without a browser. The 3-up rules are scoped to a grid of exactly three
 * tiles holding a Naskh letter, so no picture grid changes. And the cascade without :has (an older phone) is today's grid.
 */
const postcss = require('postcss');
const { CSS_ROOT, computed, node } = require('./cascade');

const SCOPE = '.wq-pgrid:has(>.wq-ptile:nth-child(3):last-child .wq-glyph[lang=ar])';
const rules = [];
CSS_ROOT.walkRules((r) => { if (r.selector.includes(':has(') && r.selector.includes('.wq-pgrid')) rules.push(r); });
const decl = (r, prop) => (r.nodes.find((d) => d.type === 'decl' && d.prop === prop) || {}).value;
const bySel = (tail) => rules.find((r) => r.selector === SCOPE + tail);

describe('a 3-card Qaida letter item: one row', () => {
  test('every :has rule on the picture grid is scoped to three tiles holding a Naskh letter', () => {
    expect(rules.length).toBe(3);
    for (const r of rules) expect(r.selector.startsWith(SCOPE)).toBe(true);
  });

  test('the grid is three equal columns, and a tile drops the 2 + 1 centring', () => {
    expect(decl(bySel(''), 'grid-template-columns')).toBe('repeat(3,minmax(0,1fr))');
    const tile = bySel('>.wq-ptile');
    expect(decl(tile, 'grid-column')).toBe('auto');
    expect(decl(tile, 'width')).toBe('auto');
  });

  test('the letter keeps a readable size and the tile a big tap: 46 px glyph, 3 × 84 px + gaps fit a 360 px phone', () => {
    const glyph = bySel(' .wq-glyph');
    expect(decl(glyph, 'font-size')).toBe('46px');
    const max = parseFloat(decl(glyph, 'max-width'));
    const gap = parseFloat(decl(bySel(''), 'gap'));
    expect(3 * max + 2 * gap).toBeLessThanOrEqual(360 - 2 * 16);
  });
});

describe('a phone without :has keeps today\'s cards', () => {
  const path = (tile) => [node('html', [], { lang: 'ur' }), node('body'), node('div', ['wq-pgrid']), ...(tile ? [node('button', ['wq-opt', 'wq-ptile'])] : [])];
  test('the grid is still two columns and a tile is still 150 px tall at least', () => {
    expect(computed(path(false), 'grid-template-columns').value).toBe('1fr 1fr');
    expect(computed(path(true), 'min-height').value).toBe('150px');
  });

  test('the style file still parses whole (one bad :has would drop only its own rule, never the sheet)', () => {
    expect(() => postcss.parse(CSS_ROOT.toString())).not.toThrow();
  });
});
