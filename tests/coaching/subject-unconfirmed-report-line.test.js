/**
 * When the subject could not be established, the report SAYS so.
 *
 * Today a teacher whose subject we cannot read sees a Section F score built from
 * five indicators instead of six, with nothing on the page explaining the missing
 * sixth. "We could not tell the subject" and "your lesson was not a literacy lesson"
 * are different sentences and only one of them is true (Rule 24d — failure copy names
 * the actual state).
 *
 * The line is emitted deterministically in CODE, not asked of the narrative model:
 * a model told to mention something complies most of the time and freestyles the rest.
 */
const { subjectUnconfirmedNote } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { attachSubjectNote } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

describe('the string itself', () => {
  test('exists in the catalogue in both offered languages', () => {
    expect(UX_STRINGS.reportSubjectUnconfirmed).toBeDefined();
    expect(typeof UX_STRINGS.reportSubjectUnconfirmed.en).toBe('string');
    expect(typeof UX_STRINGS.reportSubjectUnconfirmed.ur).toBe('string');
  });

  test('the Urdu variant is in Urdu script, not Roman transliteration', () => {
    expect(/[؀-ۿ]/.test(UX_STRINGS.reportSubjectUnconfirmed.ur)).toBe(true);
  });

  test('it fits a report why-line: under 200 code points in both languages', () => {
    for (const lang of ['en', 'ur']) {
      expect([...UX_STRINGS.reportSubjectUnconfirmed[lang]].length).toBeLessThanOrEqual(200);
    }
  });

  test('it names the state instead of blaming the lesson', () => {
    const en = UX_STRINGS.reportSubjectUnconfirmed.en;
    expect(en).toMatch(/not confirmed/i);
    expect(en).toMatch(/not scored/i);
    expect(en).not.toMatch(/not a literacy/i);
  });

  test('subjectUnconfirmedNote resolves the same catalogue key, per language', () => {
    expect(subjectUnconfirmedNote('en')).toBe(resolveUx('reportSubjectUnconfirmed', { language: 'en' }));
    expect(subjectUnconfirmedNote('ur')).toBe(resolveUx('reportSubjectUnconfirmed', { language: 'ur' }));
    // total on a render path: junk language falls to the floor, never throws
    expect(subjectUnconfirmedNote(null)).toBe(subjectUnconfirmedNote('en'));
    expect(subjectUnconfirmedNote('sw')).toBe(subjectUnconfirmedNote('en'));
  });
});

describe('attachSubjectNote — the line lands on the Section F row', () => {
  const groups = () => ([
    { key: 'B', domainKey: 'lesson_plan_fidelity', why: 'B why' },
    { key: 'F', domainKey: 'teacher_subject_knowledge', why: 'F why' },
  ]);

  test('confidence none → the note is appended to the Section F why-line', () => {
    const g = groups();
    attachSubjectNote(g, { subject_resolution: { confidence: 'none' } }, 'en');
    expect(g[1].why).toContain('F why');
    expect(g[1].why).toContain(subjectUnconfirmedNote('en'));
    expect(g[0].why).toBe('B why');            // no other section touched
  });

  test('no narrative why at all → the note stands alone', () => {
    const g = [{ key: 'F', domainKey: 'teacher_subject_knowledge' }];
    attachSubjectNote(g, { subject_resolution: { confidence: 'none' } }, 'ur');
    expect(g[0].why).toBe(subjectUnconfirmedNote('ur'));
  });

  test('a resolved subject leaves every why-line untouched', () => {
    for (const confidence of ['high', 'medium']) {
      const g = groups();
      attachSubjectNote(g, { subject_resolution: { confidence, code: 'urdu', group: 'literacy' } }, 'en');
      expect(g[1].why).toBe('F why');
    }
  });

  test('a pre-cutover analysis with no subject_resolution key is left alone', () => {
    const g = groups();
    attachSubjectNote(g, { domains: {} }, 'en');
    expect(g[1].why).toBe('F why');
  });

  test('total: null groups / null analysis never throw', () => {
    expect(() => attachSubjectNote(null, null, 'en')).not.toThrow();
    expect(() => attachSubjectNote([], undefined, 'en')).not.toThrow();
  });

  test('idempotent — a second call does not double the line', () => {
    const g = groups();
    const a = { subject_resolution: { confidence: 'none' } };
    attachSubjectNote(g, a, 'en');
    const once = g[1].why;
    attachSubjectNote(g, a, 'en');
    expect(g[1].why).toBe(once);
  });
});
