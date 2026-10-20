/**
 * English's split by thinking level, counted the way FDE counts it (bd-5jmnfj.26). FDE splits the
 * marks INSIDE each English question across levels (GRADE V MODEL PAPERS CAE 2026, pp.34-36): Q2's
 * 20 marks are R8 U6 A6, a letter is R4 U3 A3. One tag per item swung a whole question to one level:
 * staging paper 2026-10-20 read R35 U43 A22, all 20 of Q2 counted as Understand.
 *
 * Pure: no model, no network.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { checkBlueprint } = require('../../bot/shared/services/assessment/blueprint-check');
const staging = require('./fixtures/fde/r26-english-staging-laid.json');

const P = Patterns.get('fde_g5_2027').subjects;
const E = P.english;
const LEVELS = ['Remember', 'Understand', 'Apply'];
const sectionLevels = (S) => Object.fromEntries(S.sections.map((s) => [s.id, s.levels]));
const slot = (id) => E.sections.flatMap((s) => s.slots).find((s) => s.slot === id);

// FDE's table, R/U/A marks per question.
const FDE = {
  'english.B.Q2': [8, 6, 6], 'english.C.Q3': [2, 2, 1], 'english.C.Q4': [4, 3, 3], 'english.C.Q5': [2, 1, 1],
  'english.C.Q6': [2, 2, 1], 'english.C.Q7': [4, 3, 3], 'english.C.Q8': [4, 3, 3], 'english.C.Q9': [2, 1, 2],
  'english.C.Q10': [2, 2, 2],
};

describe('the English pattern carries FDE\'s split per question', () => {
  it.each(Object.entries(FDE))('%s', (id, want) => {
    const s = slot(id);
    expect(LEVELS.map((b) => s.levels[b])).toEqual(want);
    expect(want.reduce((a, b) => a + b, 0)).toBe(s.attempt * s.marks_each);
  });

  it('and per section, adding up to 40/30/30', () => {
    expect(sectionLevels(E)).toEqual({
      A: { Remember: 10, Understand: 7, Apply: 8 },
      B: { Remember: 8, Understand: 6, Apply: 6 },
      C: { Remember: 22, Understand: 17, Apply: 16 },
    });
    for (const sec of E.sections) expect(LEVELS.reduce((n, b) => n + sec.levels[b], 0)).toBe(sec.marks);
    for (const b of LEVELS) expect(E.sections.reduce((n, s) => n + s.levels[b], 0)).toBe(E.tos[b]);
  });

  it('Section A is asked for its own split', () => {
    const section = E.sections.find((s) => s.id === 'A');
    const text = Gen.buildPatternUserPrompt({
      grade: 5, subject: 'english', pageContent: 'Book text.', pageReference: '1-20',
      section, slots: section.slots, lang: E.medium, P: E, scope: { kind: 'fde', chapters: null, pages: null },
    });
    expect(text).toContain('This section\'s 25 marks split by thinking level as Remember 10, Understand 7, Apply 8');
  });
});

describe('the blueprint counts a fixed-split question by FDE\'s split, not its tag', () => {
  const layout = JSON.parse(JSON.stringify(staging));
  layout._layout.sections = JSON.parse(JSON.stringify(E.sections));
  const r = checkBlueprint(layout, { tos: E.tos, sectionLevels: sectionLevels(E) });

  it('the staging paper reads within 5 points of 40/30/30', () => {
    expect(r.problems).toEqual([]);
    expect(Math.round(r.levels.Remember.pct)).toBe(40);
    expect(Math.round(r.levels.Understand.pct)).toBe(31);
    expect(Math.round(r.levels.Apply.pct)).toBe(29);
  });

  it('Q2 tagged Understand still counts R8 U6 A6', () => {
    const B = r.sections.find((s) => s.id === 'B');
    expect(LEVELS.map((b) => B.levels[b].marks)).toEqual([8, 6, 6]);
  });

  it('a fixed-split slot left short counts nothing for its missing marks', () => {
    const short = JSON.parse(JSON.stringify(layout));
    for (const ts of Object.values(short.unseen)) {
      for (const list of Object.values(ts)) if (Array.isArray(list)) list.forEach((q) => { if (q.slot === 'english.B.Q2') q.removed = true; });
    }
    const B = checkBlueprint(short, { tos: E.tos }).sections.find((s) => s.id === 'B');
    expect(LEVELS.map((b) => B.levels[b].marks)).toEqual([0, 0, 0]);
  });

  it('a slot with no fixed split still counts by its items\' tags', () => {
    const A = r.sections.find((s) => s.id === 'A');
    expect(LEVELS.map((b) => A.levels[b].marks)).toEqual([10, 8, 7]);
  });
});
