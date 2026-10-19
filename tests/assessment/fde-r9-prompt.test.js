/**
 * Round-5 prompt rules for board-pattern sections (the panels' round-4 Maths paper defects, and
 * unnamed people on every subject). Each rule is proved through buildPatternUserPrompt, the
 * assembly the engine sends.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const CHAPTERS = { kind: 'chapters', chapters: [1, 2], pages: null };
const PAGES = { kind: 'pages', chapters: null, pages: '31-56' };
const ALL_SCOPES = [FDE, CHAPTERS, PAGES];
const SUBJECTS = ['maths', 'english', 'science', 'social_studies', 'urdu'];


function prompt(subject, sectionId, scope = FDE, extra = {}) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope, ...extra,
  });
}
/** One slot's block in the GENERATE list: its bullet line and the indented lines under it. */
function slotBlock(text, slotId) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('• ') && l.includes(`"slot": "${slotId}"`));
  if (at < 0) return null;
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('  '); i += 1) out.push(lines[i]);
  return out.join('\n');
}

const PAGES_NUMBERS = 'numbers: the sizes these pages use;';
const PEOPLE = 'A person in a word problem or story who is not named is \'they\' (a carpenter … they); a named child keeps a name and needs no pronoun.';

describe('round-5 pattern prompt rules', () => {
  test('maths pages: Q1(b) and Q2 number sizes come from the pages', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      for (const [section, slot] of [['A', 'maths.A.Q1b'], ['B', 'maths.B.Q2']]) {
        const block = slotBlock(prompt('maths', section, scope), slot);
        expect(block).toContain(PAGES_NUMBERS);
        expect(block).not.toMatch(/decimal|denominator/i);
      }
    }
  });

  test('maths fde scope: number sizes unchanged', () => {
    expect(slotBlock(prompt('maths', 'A', FDE), 'maths.A.Q1b')).toContain('numbers: up to 6 digits; 3-place decimals; denominators 2 to 5;');
    expect(slotBlock(prompt('maths', 'B', FDE), 'maths.B.Q2')).toContain('numbers: up to 7 digits; 5-digit ÷ 2-digit; 5-digit × 2-digit; decimals to 2 places;');
  });

  test('maths pages: a grain kind that is not a string does not throw', () => {
    const S = P.maths;
    const section = S.sections.find((s) => s.id === 'B');
    const slots = section.slots.map((s) => (s.slot === 'maths.B.Q2' ? { ...s, grain: { ...s.grain, kind: undefined } } : s));
    const text = Gen.buildPatternUserPrompt({
      grade: 5, subject: 'maths', pageContent: 'Book text.', pageReference: '1-20', section, slots, lang: S.medium, P: S, scope: CHAPTERS,
    });
    expect(slotBlock(text, 'maths.B.Q2')).toContain(PAGES_NUMBERS);
  });

  test('gender: an unnamed person is they, every subject, section and scope', () => {
    for (const subject of SUBJECTS) {
      for (const scope of ALL_SCOPES) {
        for (const { id } of P[subject].sections) {
          const text = prompt(subject, id, scope);
          expect(text.split(PEOPLE)).toHaveLength(2);
        }
      }
    }
  });
});
