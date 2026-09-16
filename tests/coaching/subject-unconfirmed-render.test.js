/**
 * The "subject not confirmed" line as it actually RENDERS.
 *
 * The template is untouched by this change: the note is appended to the Section F
 * group's existing `why`, which the shipped why-line renderer already paints under the
 * bar in both languages. What this suite pins is that the note survives that renderer
 * intact — in particular that the Urdu variant carries no Latin or numeric run, so it
 * cannot hit the bidi reorder class that ate a footer date once already, and that the
 * RTL document actually declares itself RTL around it.
 *
 * What a text-matching test cannot see is paint order and glyph coverage. The note
 * carries no Latin, no digits and no entity, and it renders in the same element and
 * font branch as the `domain_whys` lines already verified visually for that slot — so
 * there is no new render surface here to look at, only new content in a proven one.
 */
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { attachDomainWhys, attachSubjectNote } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
const { subjectUnconfirmedNote } = require('../../bot/shared/services/coaching/report-v2/narrative.service');

const SECTION_F = () => ({
  key: 'F', domainKey: 'teacher_subject_knowledge',
  name: 'Teacher Subject Knowledge', score: 15, max: 20, pct: 75,
});

const vm = (lang, groups) => ({
  language: lang, brand: 'niete', teacherName: 'Sana', topic: 'اردو', date: '2026-09-15',
  score: { overall: 63, marks: 90, max: 140 },
  groups, narrative: { affirmation: 'x', moments: [] }, trend: [],
});

const NO_SUBJECT = { subject_resolution: { confidence: 'none', code: null, source: 'no_signal' } };

describe('the note reaches the rendered page', () => {
  it('en: it paints inside the Section F why line', () => {
    const groups = [SECTION_F()];
    attachSubjectNote(groups, NO_SUBJECT, 'en');
    const html = buildHeroReportHtml(vm('en', groups));
    expect(html).toContain('class="sc-why"');
    expect(html).toContain('Subject not confirmed');
    expect(html).toContain('was not scored');
  });

  it('ur: it paints in Urdu script inside an RTL document', () => {
    const groups = [SECTION_F()];
    attachSubjectNote(groups, NO_SUBJECT, 'ur');
    const html = buildHeroReportHtml(vm('ur', groups));
    expect(html).toMatch(/<html dir="rtl"/);
    expect(html).toContain('class="sc-why"');
    // The renderer escapes and Latin-isolates the text; the Urdu words must survive.
    expect(html).toContain('مضمون کی تصدیق نہیں ہو سکی');
    expect(html).toContain('نمبر نہیں دیے گئے');
  });

  it('the Urdu note has nothing for the bidi algorithm to reorder', () => {
    const ur = subjectUnconfirmedNote('ur');
    expect(ur).not.toMatch(/[A-Za-z]/);   // no Latin run → no .ltr span needed
    expect(ur).not.toMatch(/[0-9٠-٩۰-۹]/); // no digits → no direction:ltr needed
    expect(ur).not.toMatch(/&[a-zA-Z]+;|&#\d+;/); // no entity → no double-escape risk
  });

  it('it sits alongside the narrative why rather than replacing it', () => {
    const groups = [SECTION_F()];
    attachDomainWhys(groups, { teacher_subject_knowledge: 'This was proficient because pupils reread the passage.' });
    attachSubjectNote(groups, NO_SUBJECT, 'en');
    const html = buildHeroReportHtml(vm('en', groups));
    expect(html).toContain('pupils reread the passage');
    expect(html).toContain('Subject not confirmed');
  });

  it('a resolved subject renders no such line', () => {
    const groups = [SECTION_F()];
    attachSubjectNote(groups, { subject_resolution: { confidence: 'high', code: 'urdu', group: 'literacy' } }, 'ur');
    const html = buildHeroReportHtml(vm('ur', groups));
    expect(html).not.toContain('class="sc-why"');
    expect(html).not.toContain('مضمون کی تصدیق');
  });
});
