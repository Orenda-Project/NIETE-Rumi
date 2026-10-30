/**
 * A question's label never breaks inside itself (bd-5jmnfj.33.7.1, round 6).
 *
 * v40 G4 Urdu Q6: the two-line instruction squeezed the label, so «سوال ۶» broke between the word
 * and the number and «۶» printed alone on the second line under the marks. The label keeps whole.
 */

const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const maths = require('./fixtures/early/g1-maths-exam.json');

function rule(html, selector) {
  const css = html.slice(html.indexOf('<style'), html.lastIndexOf('</style>'));
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

test('the slot-head label never wraps and never shrinks', () => {
  const html = R.renderPaper({ examJson: maths, grade: 1, subject: 'maths' });
  const lab = rule(html, '.slot-head .lab');
  expect(lab).toMatch(/white-space: nowrap/);
  expect(lab).toMatch(/flex: none/);
});
