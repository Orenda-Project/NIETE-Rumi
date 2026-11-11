/**
 * bd-eal7zn.11 / bd-0pka0 / bd-b12c2m — the Urdu "نمبر" beside the marks fraction
 * was drawn in Lexend (no Urdu glyphs) and came out as tofu. It must sit in a span
 * whose font is NastaliqUrdu; the numerals stay in the Lexend line.
 */
const { buildHeroReportHtml } = require('../../shared/services/coaching/report-v2/hero-report.template');

const vm = (language) => ({
  language, teacherName: 'T', topic: 'F', date: 'd',
  score: { overall: 75, marks: 111, max: 148 },
  groups: [], narrative: { affirmation: 'x', moments: [] }, trend: [], photoB64: '',
});

describe('hero report marks word font', () => {
  it('ur: "نمبر" is inside the Urdu-font span, numerals outside it', () => {
    const html = buildHeroReportHtml(vm('ur'));
    expect(html).toMatch(/111\/148<span class="marks-word">\s*نمبر<\/span>/);
    expect(html).toMatch(/\.marks-word\{[^}]*font-family:'NastaliqUrdu'/);
    expect(html).not.toMatch(/<span class="ltr">[^<]*نمبر/);
  });

  it('en: no marks-word span, plain " marks"', () => {
    const html = buildHeroReportHtml(vm('en'));
    expect(html).toContain('111/148 marks</div>');
    expect(html).not.toContain('<span class="marks-word">');
  });
});
