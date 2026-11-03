/**
 * A picture question's heading never sits alone at the foot of a page (bd-5jmnfj.4.50.6).
 *
 * v22 printed "Q7. Write the name of each shape." as the last line of a page with every picture
 * on the next: G1 English Q7, G1 Maths Q7, G2 Maths Q5. The heading has break-after: avoid, but
 * Chromium starts a flex grid on the heading's page and pushes only its cells, so the rule never
 * held. The cells now sit in lines, which move with the heading, and the word bank keeps with them.
 */

const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const maths = require('./fixtures/early/g1-maths-exam.json');
const english = require('./fixtures/early/g1-english-exam.json');

/** The declarations of the first CSS rule whose selector is exactly `selector`. */
function rule(html, selector) {
  const css = html.slice(html.indexOf('<style'), html.lastIndexOf('</style>'));
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

describe.each([
  ['G1 Maths', R.renderPaper({ examJson: maths, grade: 1, subject: 'maths' }), 'g1.maths.B.Q7'],
  ['G1 English', R.renderPaper({ examJson: english, grade: 1, subject: 'english' }), 'g1.english.B.Q7'],
])('%s picture grid', (_, html, slot) => {
  test('the slot prints as a picture grid', () => {
    expect(html).toContain(`<div class="q pic-cell" data-slot="${slot}"`);
  });

  test('the grid is not a flex container, so its first row can follow the heading to a new page', () => {
    expect(rule(html, '.pic-grid')).not.toMatch(/display:\s*(inline-)?flex/);
  });

  test('each picture cell is an unbreakable inline block, so cells still sit side by side', () => {
    const cell = rule(html, '.q.pic-cell');
    expect(cell).toMatch(/display:\s*inline-block/);
    expect(cell).toMatch(/break-inside:\s*avoid/);
  });

  test('one row on either side of a break is enough, so a row is not pulled away from its heading', () => {
    const grid = rule(html, '.pic-grid');
    expect(grid).toMatch(/orphans:\s*1/);
    expect(grid).toMatch(/widows:\s*1/);
  });

  test('the heading and the word bank keep with what follows them', () => {
    expect(rule(html, '.slot-head')).toMatch(/break-after:\s*avoid/);
    expect(rule(html, '.word-box.bank')).toMatch(/break-after:\s*avoid/);
  });
});
