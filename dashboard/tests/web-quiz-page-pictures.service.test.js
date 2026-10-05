/* Web quiz page pictures at 360 px (dashboard/public/wq/wq.js figures + picture options, wq.css).
 *  - The zoom control is a small icon in the picture's corner, named for screen readers. As a
 *    "Make the picture bigger" pill it was wider than many of the pictures it enlarged.
 *  - A picture question with an odd number of options centres the last tile instead of leaving
 *    an empty slot in the grid.
 *  - An unnamed picture option (an emoji option drawn as a picture) is hidden from screen readers
 *    (its button carries the shape's name), never an empty aria-label.
 *  - Picture options are drawn at least 112 px. */
const fs = require('fs');
const path = require('path');
const WQI = require('../public/wq/wq.js');

const CSS = fs.readFileSync(path.join(__dirname, '../public/wq/wq.css'), 'utf8');
const T = { zoom: 'Make the picture bigger', labelHelp: 'Tap the part.', check: 'Check', listen: 'Listen again' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100" fill="#fff"/></svg>';
const PIC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-hidden="true"><circle cx="36" cy="36" r="20" fill="#00D26A"/></svg>';
const rule = (sel) => {
  const i = CSS.indexOf(sel + '{');
  return i < 0 ? '' : CSS.slice(i, CSS.indexOf('}', i) + 1);
};

describe('the zoom control is an icon in the picture corner', () => {
  it('has no visible words, only an accessible name', () => {
    const h = WQI.figureHtml({ figure: { kind: 'svg', svg: SVG, w: 200, h: 100, alt: 'Bars', type: 'fraction_bar' } }, T);
    const btn = /<button class="wq-zoom"[^>]*>([\s\S]*?)<\/button>/.exec(h);
    expect(btn).toBeTruthy();
    expect(btn[0]).toContain('aria-label="Make the picture bigger"');
    expect(btn[1].replace(/<span aria-hidden="true">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').trim()).toBe('');
  });
  it('is a small round icon at the end of the picture card, never laid over the drawing (it hid a bar part)', () => {
    const r = rule('.wq-zoom');
    expect(r).not.toMatch(/position:absolute/);
    expect(r).toMatch(/align-self:flex-end/);
    expect(Number((/width:(\d+)px/.exec(r) || [])[1])).toBeLessThanOrEqual(44);
    expect(r).toMatch(/border-radius:50%/);
  });
});

describe('picture grids', () => {
  it('an odd last tile is centred across the grid, not left beside an empty slot', () => {
    const r = rule('.wq-pgrid>.wq-ptile:last-child:nth-child(odd)');
    expect(r).toMatch(/grid-column:1\s*\/\s*-1/);
    expect(r).toMatch(/justify-self:center/);
  });
  it('picture options are drawn at least 112 px', () => {
    const m = /\.wq-pic\{[^}]*width:(\d+)px/.exec(CSS);
    expect(m && Number(m[1])).toBeGreaterThanOrEqual(112);
  });
  it('an unnamed picture is not announced as an empty name; the button carries the shape name', () => {
    const q = { text: 'Which one is a LEAF?', options: ['A', 'B', 'C'].map((s) => ({ slot: s, text: '🍃', pic: { svg: PIC, name: '', alt: '' } })) };
    expect(WQI.kind(q)).toBe('picture');
    const h = WQI.itemHtml(q, T, 'en');
    expect(h).not.toContain('aria-label=""');
    expect((h.match(/class="wq-pic" aria-hidden="true"/g) || []).length).toBe(3);
    expect((h.match(/class="wq-opt wq-ptile[^"]*"[^>]*aria-label="/g) || []).length).toBe(3);
  });
});
