/**
 * bd-5jmnfj.23: a named child, or a boy or girl, is never 'they'. Staging papers of 2026-10-20 printed
 * "Hamza … Their whole trip" (Maths Q2 ix) and "A boy … They take it home" (English Q9). 'They'
 * stays for a person the stem gives no name and no sex (RULE.gender, RULE.people are unchanged).
 * Proved through buildPatternUserPrompt, the assembly the engine sends.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ENGLISH_MEDIUM = ['maths', 'english', 'science'];
const NAMED = 'A named child, or a person the stem calls a boy, girl, man or woman, is never \'they\' or \'their\': repeat the name, or use he/his for a boy or man and she/her for a girl or woman (Hamza … his trip). \'They\' is only for a person the stem gives no name and no sex.';

function prompt(subject, sectionId) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope: FDE,
  });
}

describe('a named child is never they (bd-5jmnfj.23)', () => {
  test('every English-medium subject and section carries the rule once', () => {
    for (const subject of ENGLISH_MEDIUM) {
      for (const { id } of P[subject].sections) {
        expect(prompt(subject, id).split(NAMED)).toHaveLength(2);
      }
    }
  });

  test('Urdu-medium papers (Urdu, Social Studies), whose verbs carry gender already, do not', () => {
    for (const subject of ['urdu', 'social_studies']) {
      for (const { id } of P[subject].sections) expect(prompt(subject, id)).not.toContain(NAMED);
    }
  });

  test('the unnamed-person rule is unchanged', () => {
    const text = prompt('maths', 'B');
    expect(text).toContain('A person in a word problem or story who is not named is \'they\' (a carpenter … they)');
    expect(text).not.toContain('a named child keeps a name and needs no pronoun');
  });
});
