/* The animal badge on a name chip ("Whose turn is it?") sits inside its 40 px circle in Urdu too. On an Urdu page
 * the body font is the Nastaliq stack with its tall line box; the emoji inherited it and dropped below the circle.
 * The badge takes the Latin face and a line height of 1, so the circle and the emoji share one box. */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rulesFor = (sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim().endsWith(sel))).map((m) => m[2]).join(';');

describe('wq.css: the animal badge keeps its own face and line box', () => {
  test('.wq-ani sets font-family to the Latin face and line-height 1', () => {
    const r = rulesFor('.wq-ani');
    expect(r).toMatch(/font-family\s*:\s*var\(--f\)/);
    expect(r).toMatch(/line-height\s*:\s*1(?![.\d])/);
  });
});
