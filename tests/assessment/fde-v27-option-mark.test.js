/**
 * An option that is a bare mark keeps its mark (bd-5jmnfj.4.58.2, v26 finding 5).
 *
 * v26 g5-urdu Q1 item 15: option «الف) ۔ (ختمہ)» printed only «(ختمہ)». bareOption's Urdu
 * label strip `^\s*\(?(الف|ب|ج|د)\)?\s*[.):۔]\s*` takes the label «الف)» with `\)?` and then
 * `[.):۔]` takes the «۔» that is the option itself. The other three options start with «؟ ، !»,
 * which the class does not hold, so they kept their marks.
 */

const fs = require('fs');
const path = require('path');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const exam = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v26', 'g5-urdu-trimmed.json'), 'utf8'));
const html = R.renderPaper({ examJson: exam, grade: 5, subject: 'urdu' });
const optionCells = (h) => [...h.matchAll(/<span class="opt"><span class="ol">([^<]*)<\/span> ([\s\S]*?)<\/span>(?=<span class="opt">|<\/div>)/g)];

describe('Q1 item 15 (the full stop option)', () => {
  const cells = optionCells(html).filter((m) => /ختمہ/.test(m[2]));
  test('the paper prints the option', () => {
    expect(cells).toHaveLength(1);
  });
  test('the option prints its mark «۔» before «(ختمہ)»', () => {
    expect(cells[0][2]).toContain('۔');
    expect(cells[0][2].indexOf('۔')).toBeLessThan(cells[0][2].indexOf('ختمہ'));
  });
  test('a label with a dot or colon is still stripped: «الف۔ بادل» prints «بادل»', () => {
    const e = JSON.parse(JSON.stringify(exam));
    e.unseen.objective.MCQs[0].options = ['الف۔ بادل', 'ب) برف', 'ج: بارش', '(د) دھوپ'];
    const h = R.renderPaper({ examJson: e, grade: 5, subject: 'urdu' });
    const first = optionCells(h).slice(0, 4).map((m) => m[2].replace(/<[^>]*>/g, '').trim());
    expect(first).toEqual(['بادل', 'برف', 'بارش', 'دھوپ']);
  });
});
