/**
 * bd-5jmnfj.14: Science Section C's level rule follows FDE's table of specification
 * (GRADE V MODEL PAPERS CAE 2026, PDF p19, printed page 17): Part A short questions are
 * 3 Remember / 4 Understand / 3 Apply; Part B long questions are 2 Remember / 1 Apply,
 * none Understand. Q3(a) is the short part and Q3(b) the long part in the pattern.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const PAT = Patterns.get('fde_g5_2027');
const FDE = { kind: 'fde', chapters: null, pages: null };
const prompt = (subject, id) => {
  const S = PAT.subjects[subject];
  const section = S.sections.find((s) => s.id === id);
  return Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'PAGE', pageReference: 'p', section, slots: section.slots, lang: S.medium, P: S, scope: FDE });
};
const sentenceOf = (text, head) => (text.split(/\n|(?<=\.)\s+(?=Q3\()/).map((s) => s.replace(/^\s*•\s*/, ''))
  .find((s) => s.startsWith(head)) || '');

describe('Science Q3 level rule follows FDE\'s ToS (bd-5jmnfj.14)', () => {
  const C = prompt('science', 'C');

  it('slots: Q3(a) is the ten short questions, Q3(b) the five long ones', () => {
    const slots = PAT.subjects.science.sections.find((s) => s.id === 'C').slots;
    expect(slots.find((s) => s.slot === 'science.C.Q3a').generate).toBe(10);
    expect(slots.find((s) => s.slot === 'science.C.Q3b').generate).toBe(5);
  });

  it('Q3(a) short questions: three Remember, four Understand, three Apply', () => {
    const a = sentenceOf(C, 'Q3(a)');
    expect(a).toMatch(/short questions/);
    expect(a).toMatch(/three Remember/);
    expect(a).toMatch(/four Understand/);
    expect(a).toMatch(/three Apply/);
    expect(a).not.toMatch(/long questions/);
  });

  it('Q3(b) long questions: Remember and Apply, never Understand', () => {
    const b = sentenceOf(C, 'Q3(b)');
    expect(b).toMatch(/long questions/);
    expect(b).toMatch(/three Remember/);
    expect(b).toMatch(/two Apply/);
    expect(b).toMatch(/none Understand/);
    expect(b).not.toMatch(/short questions/);
  });

  it('the old rule (long questions on Q3(a), one Understand) is gone', () => {
    expect(C).not.toMatch(/Q3\(a\): two of the three long questions/);
  });

  it('stays on Science Section C only', () => {
    expect(prompt('science', 'B')).not.toMatch(/Q3\(a\)/);
    expect(prompt('social_studies', 'C')).not.toMatch(/Q3\(b\): the long questions/);
  });
});
