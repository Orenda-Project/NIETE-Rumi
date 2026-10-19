/**
 * Story Time's intro under the adventure look (the Games land screen, data-screen="intro"): Jugnu above a big centred
 * bubble, in English as in Urdu. Before, the stacked look applied only to the light (.wqc-mid) screens, and the land
 * intro stacked in Urdu only because its longer line wrapped; the English line sat small beside Jugnu.
 * The rules are scoped to html.wq-adv, so a page without the look is today's. Invented content only.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-challenge.js'), 'utf8');
const rule = (sel) => (new RegExp(`'[^']*${sel.replace(/[.[\]()=*+?^$|\\]/g, '\\$&')}[^']*\\{([^}]*)\\}'`).exec(SRC) || [])[1] || '';
const LAND = 'html.wq-adv .wqc-land[data-screen=intro] .wq-jug.wq-big';

describe('Story Time intro (land) with the look: Jugnu above a big bubble, any language', () => {
  test('Jugnu and the bubble stack in a centred column', () => {
    expect(rule(LAND)).toMatch(/flex-direction:column;align-items:center/);
  });
  test('the bubble is the big centred one, its tail pointing up at Jugnu', () => {
    expect(rule(`${LAND} .wq-say`)).toMatch(/text-align:center;font-size:var\(--fs-5,24px\)/);
    expect(rule(`${LAND} .wq-say::after`)).toMatch(/top:-9px/);
  });
  test('Tap to hear sits centred under it', () => {
    expect(rule('html.wq-adv .wqc-land[data-screen=intro] .wqc-hear')).toMatch(/align-self:center/);
  });
});
