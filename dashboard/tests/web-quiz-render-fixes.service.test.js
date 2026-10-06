/* What the render matrix's extension found on the page (dashboard/public/wq/wq.js WQI, wq.css).
 *  - Maths from real questions: \Omega, \dots, \neq, \rightleftharpoons, \xrightarrow and \begin{array}
 *    column sums (107 of 40,000 prod rows) were spelled out in letters ("60 Omega", "beginarray");
 *    \text lost its spaces ("Rs40").
 *  - A long maths line ran past the feedback bubble and off the screen (MathML does not wrap).
 *  - A figure file that does not arrive showed a broken-picture icon and its alt text.
 *  - A label item whose hotspots sit outside its drawing put its answer rings off the picture. */
const fs = require('fs');
const path = require('path');
const WQI = require('../public/wq/wq.js');

const CSS = fs.readFileSync(path.join(__dirname, '../public/wq/wq.css'), 'utf8');
const letters = (h) => [...h.matchAll(/<mi>([^<]*)<\/mi>/g)].map((m) => m[1]).filter((t) => [...t].length > 1);

describe('maths: the TeX commands prod questions carry are typeset, never spelled out', () => {
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
    expect(h).not.toMatch(/&amp;|\\\\/);
  });
  test('\\text keeps its spaces ("Rs 40", not "Rs40")', () => {
    expect(WQI.tex('$\\text{Rs } 40$')).toContain('<mtext>Rs </mtext>');
  });
  test('a maths line sits in a box that scrolls inside its line, opening at its start', () => {
    expect(WQI.tex('$x$')).toMatch(/^<span class="wq-mx"><math/);
    const r = (/(^|\n)\.wq-mx\{([^}]*)\}/.exec(CSS) || [])[2] || '';
    expect(r).toMatch(/max-width:100%/);
    expect(r).toMatch(/overflow-x:auto/);
    expect(r).toMatch(/direction:ltr/);
  });
});

describe('a figure file that does not arrive', () => {
  test('the figure hides itself instead of showing a broken picture and its alt text', () => {
    const h = WQI.figureHtml({ figure: { kind: 'img', url: '/api/wq/media/AB12CD/q1?k=q', alt: 'A picture' } }, { zoom: 'Zoom' });
    const img = (/<img[^>]*>/.exec(h) || [''])[0];
    expect(img).toMatch(/onerror="[^"]*closest\('figure'\)[^"]*display='none'/);
  });
});

describe('a label item plays only when its hotspots sit on its drawing', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>';
  const q = (hotspots) => ({ type: 'label', text: 'Where is the leaf?', correct_slot: 'B',
    options: [{ slot: 'A', text: 'root' }, { slot: 'B', text: 'leaf' }],
    figure: { kind: 'svg', svg: SVG, w: 200, h: 100, hotspots } });
  test('hotspots inside the drawing: a label item with its rings', () => {
    const it = q([{ slot: 'A', x: 50, y: 50 }, { slot: 'B', x: 150, y: 50 }]);
    expect(WQI.kind(it)).toBe('label');
    expect((WQI.itemHtml(it, { labelHelp: 'Tap the part.' }, 'en').match(/class="wq-hot"/g) || []).length).toBe(2);
  });
  test('a hotspot outside the drawing: the parts are offered as words, no ring is drawn off the picture', () => {
    const it = q([{ slot: 'A', x: 50, y: 50 }, { slot: 'B', x: 450, y: 50 }]);
    expect(WQI.kind(it)).toBe('single');
    const h = WQI.itemHtml(it, { labelHelp: 'Tap the part.' }, 'en');
    expect(h).not.toMatch(/class="wq-hot"/);
    expect((h.match(/class="wq-opt /g) || []).length).toBe(2);
  });
  test('a label item with no hotspots offers its parts as words (it had no answer control at all)', () => {
    expect(WQI.kind(q([]))).toBe('single');
  });
});

describe('WQI.TEX_SUPPORTED: the one list of TeX commands the page typesets (the author gate reads it)', () => {
  const sample = (c) => {
    if (c === 'frac') return '$\\frac{1}{2}$';
    if (c === 'sqrt' || c === 'xrightarrow') return `$\\${c}{4}$`;
    if (/^(text|textrm|mathrm)$/.test(c)) return `$\\${c}{cm}$`;
    if (c === 'begin') return '$\\begin{array}{r} 1 \\\\ 2 \\end{array}$';
    if (c === 'end' || c === 'hline' || c === '\\') return '$\\begin{array}{r} 1 \\\\ \\hline 2 \\end{array}$';
    return `$1 \\${c} 2$`;
  };
  test('it is exported and covers the commands prod rows carry', () => {
    expect(Array.isArray(WQI.TEX_SUPPORTED)).toBe(true);
    ['frac', 'times', 'div', 'text', 'Omega', 'dots', 'neq', 'rightleftharpoons', 'xrightarrow', 'begin', 'end', 'hline', 'circ', 'cdot']
      .forEach((c) => expect(WQI.TEX_SUPPORTED).toContain(c));
  });
  test('every command on the list is typeset, never spelled out', () => {
    const bad = WQI.TEX_SUPPORTED.filter((c) => letters(WQI.tex(sample(c))).length);
    expect(bad).toEqual([]);
  });
  test('a command NOT on the list is spelled out: the list is the boundary the gate needs', () => {
    expect(WQI.TEX_SUPPORTED).not.toContain('overline');
    expect(letters(WQI.tex('$\\overline{AB}$'))).toEqual(['overline']);
  });
});
