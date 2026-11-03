/**
 * A sentence box closes inside the right margin and sits under a large picture
 * (bd-5jmnfj.4.58.2, v26 finding 2).
 *
 * v26 G1 English Q12 and G1 Urdu Q10: `.q.pic-cell.wide { width: 100% }` is a content-box width on
 * an element that also has `.q`'s 6mm start padding, so the cell and its box ran 6mm past the
 * margin and the box lost its end border; the picture stayed the 28mm thumbnail over a box of two
 * lines. The cell is now border-box, the picture 44mm high, the box three lines (28mm).
 */

const fs = require('fs');
const path = require('path');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v26', `${n}-trimmed.json`), 'utf8'));
const css = (html) => html.slice(html.indexOf('<style'), html.lastIndexOf('</style>'));
const rule = (html, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css(html).match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

describe.each([
  ['G1 English Q12', R.renderPaper({ examJson: load('g1-english'), grade: 1, subject: 'english' }), 'g1.english.C.Q12'],
  ['G1 Urdu Q10', R.renderPaper({ examJson: load('g1-urdu'), grade: 1, subject: 'urdu' }), 'g1.urdu.B.Q10'],
])('%s', (_, html, slot) => {
  test('the cells are wide and five in number', () => {
    expect(html.match(new RegExp(`class="q pic-cell wide" data-slot="${slot.replace(/\./g, '\\.')}"`, 'g'))).toHaveLength(5);
  });
  test('the wide cell is border-box, so its width includes the start padding and closes inside the margin', () => {
    const r = rule(html, '.q.pic-cell.wide');
    expect(r).toMatch(/width:\s*100%/);
    expect(r).toMatch(/box-sizing:\s*border-box/);
  });
  test('the picture in a wide cell is at least 40mm high, not the 28mm thumbnail', () => {
    const h = rule(html, '.q.pic-cell.wide .pic img').match(/height:\s*(\d+)mm/);
    expect(h && Number(h[1])).toBeGreaterThanOrEqual(40);
  });
  test('each sentence box is three lines tall (28mm)', () => {
    const at = html.indexOf(`data-slot="${slot}"`);
    const boxes = [...html.slice(at).matchAll(/class="write-box" style="height:(\d+)mm"/g)].slice(0, 5).map((m) => Number(m[1]));
    expect(boxes).toEqual([28, 28, 28, 28, 28]);
  });
});
