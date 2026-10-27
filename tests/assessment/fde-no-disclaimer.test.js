/**
 * No FDE paper says it is not an official FDE paper (bd-5jmnfj.4.26).
 *
 * Amena, 23 Oct 2026, on "Practice paper in the FDE Grade I annual assessment
 * pattern (2026-27). Not an official FDE paper.": "this is not needed for other
 * assessments or exams, not even for topic-based assessments". The header line,
 * the footer and the "Covers:" suffix go from every grade, subject and scope.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const DISCLAIMER = /official|سرکاری|practice paper in|مشق کا پرچہ/i;

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('no pattern carries the disclaimer', () => {
  const headers = Patterns.list().flatMap((id) => {
    const P = Patterns.get(id);
    return Object.keys(P.subjects).map((s) => [`${id} ${s}`, P.subjects[s].header]);
  });

  test.each(headers)('%s header', (_, header) => {
    Object.entries(header).forEach(([k, v]) => {
      if (typeof v === 'string') expect(`${k}: ${v}`).not.toMatch(DISCLAIMER);
    });
    expect(header.disclaimer_en).toBeUndefined();
    expect(header.disclaimer_ur).toBeUndefined();
  });
});

describe('a G1 paper prints none of it', () => {
  test.each([
    ['english', require('./fixtures/early/g1-english-exam.json')],
    ['general_knowledge', require('./fixtures/early/g1-general_knowledge-exam.json')],
    ['maths', require('./fixtures/early/g1-maths-exam.json')],
  ])('G1 %s: paper, scheme and footers', (subject, exam) => {
    expect(visible(R.renderPaper({ examJson: exam, grade: 1, subject }))).not.toMatch(DISCLAIMER);
    ['paper', 'scheme'].forEach((kind) => {
      const footer = R.pdfOptions(exam, kind).footerTemplate;
      expect(footer).not.toMatch(DISCLAIMER);
      expect(footer).toContain('class="pageNumber"');
    });
  });
});
