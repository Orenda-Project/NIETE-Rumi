/**
 * Round-5 prompt rule for Social Studies board-pattern papers: Q5 and Q7 never re-ask a fact
 * that Section A or Q6 already tests. Round-2 sandbox papers re-asked them as paraphrases, which
 * the stem-level "no repeats" rule lets through: a chapters paper's Q7 asked «پاکستان میں شامل
 * ہونے والا پہلا صوبہ کون سا تھا؟», the fact its Q1 MCQ keys (سندھ); a full paper's Q7 asked
 * where the world's second-largest salt mine is, which its Q1 stem names and keys (کھیوڑہ).
 * Each test builds one section's user prompt through buildPatternUserPrompt, the same assembly
 * the engine sends. The sections are written in parallel, so the rule carries no other
 * section's items; it applies to every section holding Q5 or Q7 (C holds Q5, D holds Q6 and Q7).
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const CHAPTERS = { kind: 'chapters', chapters: [4, 6], pages: null };
const PAGES = { kind: 'pages', chapters: null, pages: '26-33' };
const ALL_SCOPES = [FDE, CHAPTERS, PAGES];
const SUBJECTS = ['maths', 'english', 'science', 'social_studies', 'urdu'];

function prompt(subject, sectionId, scope = FDE) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope,
  });
}
const sectionIds = (subject) => P[subject].sections.map((s) => s.id);
const holds = (subject, id, re) => P[subject].sections.find((s) => s.id === id).slots.some((s) => re.test(s.slot));

const NO_REASK = 'Q5 and Q7 never ask a fact that a Section A item (stem or key) or a Q6 item on this paper already tests.';

describe('round-5 Social Studies prompt rule', () => {
  test('sst Q5/Q7: never re-ask a Section A or Q6 fact, every scope', () => {
    // Where the slots live is read from the pattern, not assumed.
    const withQ57 = sectionIds('social_studies').filter((id) => holds('social_studies', id, /\.Q[57]$/));
    expect(withQ57).toEqual(['C', 'D']);
    for (const scope of ALL_SCOPES) {
      for (const id of sectionIds('social_studies')) {
        const text = prompt('social_studies', id, scope);
        if (withQ57.includes(id)) {
          expect(text).toContain(NO_REASK);
          // Once, among the rules, before the closing JSON-only line.
          expect(text.split(NO_REASK)).toHaveLength(2);
          expect(text.indexOf(NO_REASK)).toBeLessThan(text.indexOf('Return the JSON only.'));
        } else {
          expect(text).not.toContain(NO_REASK);
        }
      }
    }
  });

  test('sst Q5/Q7 rule: no other subject carries it', () => {
    for (const subject of SUBJECTS.filter((s) => s !== 'social_studies')) {
      for (const scope of ALL_SCOPES) {
        for (const id of sectionIds(subject)) expect(prompt(subject, id, scope)).not.toContain(NO_REASK);
      }
    }
  });

  test('sst Q5/Q7 rule: the existing Social Studies rules stay', () => {
    const c = prompt('social_studies', 'C', CHAPTERS);
    const d = prompt('social_studies', 'D', CHAPTERS);
    for (const text of [c, d]) {
      expect(text).toContain('No item repeats another item\'s content, numbers or answer on this paper, in any section.');
      expect(text).toContain('Q5 and Q6 are situations, \'why\' questions and comparisons');
    }
  });
});
