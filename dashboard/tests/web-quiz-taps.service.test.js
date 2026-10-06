/* A quick second tap must land. On a phone, two taps close together can be read as a double-tap-to-zoom
 * and the second one never reaches the page (the ORDER item: tap B then A with no pause). The page turns
 * double-tap zoom off for the whole document; pinch zoom stays on (touch-action: manipulation). */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('wq.css: taps are never eaten by double-tap zoom', () => {
  test('the document is touch-action: manipulation', () => {
    const rule = css.match(/(^|})\s*html\s*(,[^{]*)?\{([^}]*)\}/m);
    expect(rule).not.toBeNull();
    expect(rule[3]).toMatch(/touch-action\s*:\s*manipulation/);
  });
  test('nothing switches it back on (no touch-action: auto anywhere)', () => {
    expect(css).not.toMatch(/touch-action\s*:\s*auto/);
  });
});
