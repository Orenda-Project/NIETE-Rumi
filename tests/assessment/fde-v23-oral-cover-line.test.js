/**
 * bd-5jmnfj.4.51.7 (cover part): the how-to-mark box said "Record the oral marks from the oral sheet"
 * on the G2 Maths key, a paper with no oral part. The line appears only when the paper has an oral part.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const C = require('../../bot/shared/services/assessment/patterns/early/chrome');
const maths = require('./fixtures/early/g1-maths-exam.json');

const legendText = (html) => (html.match(/<div class="box legend">[\s\S]*?<\/ul><\/div>/) || [''])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const key = (exam) => R.renderMarkingScheme({ examJson: exam, grade: 1, subject: 'maths', allowShort: true });

describe('bd-5jmnfj.4.51.7 the cover names the oral part only when there is one', () => {
  test('a paper with an oral part still tells the teacher to add the oral marks', () => {
    expect(legendText(key(maths))).toMatch(/oral marks/i);
  });

  test('the same paper without an oral part prints no oral line, in English or Urdu', () => {
    const noOral = JSON.parse(JSON.stringify(maths));
    noOral._layout.oral = null;
    const t = legendText(key(noOral));
    expect(t).not.toMatch(/oral/i);
    expect(t).not.toContain('زبانی');
    expect(t).not.toMatch(/Written marks only/);
  });

  test('the shipped G2 Maths pattern (no oral) carries no oral line in its legend', () => {
    const S = require('../../bot/shared/services/assessment/patterns').subjectOf('fde_g2_2026', 'maths');
    const all = [...S.legend.lines_en, ...S.legend.lines_ur].join(' ');
    expect(all).not.toMatch(/oral/i);
    expect(all).not.toContain('زبانی');
  });

  test('legendFor(key, hasOral) drops the line when hasOral is false', () => {
    expect(C.legendFor('maths', true).lines_en.join(' ')).toMatch(/oral/i);
    expect(C.legendFor('maths', false).lines_en.join(' ')).not.toMatch(/oral/i);
  });
});
