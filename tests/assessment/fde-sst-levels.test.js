/**
 * Social Studies' split by thinking level (bd-5jmnfj.27). Sandbox paper 6e7d3893 came out R46 U30 A24
 * against FDE's 30/40/30. FDE's SST table by question is not in hand, so no question's marks are
 * counted by an assumed split: every item is counted by the level it is tagged. The paper moves to its
 * split because the prompt tells the model the level each slot must test (Q2 map Remember, Q3 and Q4
 * Understand, Q5 Understand, Q6 Apply, Q7 Remember, Q1 eight Remember / six Understand / six Apply).
 *
 * Pure: no model, no network.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { checkBlueprint } = require('../../bot/shared/services/assessment/blueprint-check');
const recorded = require('./fixtures/fde/r27-sst-sandbox-laid.json');

const S = Patterns.get('fde_g5_2027').subjects.social_studies;
const LEVELS = ['Remember', 'Understand', 'Apply'];
const sectionLevels = Object.fromEntries(S.sections.map((s) => [s.id, s.levels]));
const slots = S.sections.flatMap((s) => s.slots);
const sectionPrompt = (id) => {
  const section = S.sections.find((s) => s.id === id);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject: 'social_studies', pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope: { kind: 'fde', chapters: null, pages: null },
  });
};
const count = (levels) => (exam) => {
  const r = checkBlueprint(exam, { tos: S.tos, sectionLevels });
  return { r, pct: LEVELS.map((b) => Math.round(r.levels[b].pct)) };
};
const laid = (mutate) => {
  const exam = JSON.parse(JSON.stringify(recorded));
  exam._layout.sections = JSON.parse(JSON.stringify(S.sections));
  mutate(exam.unseen);
  return count()(exam);
};
const items = (u, slot) => Object.values(u).flatMap((t) => Object.values(t)).flat().filter((q) => q.slot === slot);

describe('the Social Studies pattern carries a split per section, and no assumed split per question', () => {
  it('each section adds up to its marks, and the sections to 30/40/30', () => {
    for (const sec of S.sections) {
      expect(LEVELS.reduce((n, b) => n + sec.levels[b], 0)).toBe(sec.marks);
    }
    for (const b of LEVELS) expect(S.sections.reduce((n, s) => n + s.levels[b], 0)).toBe(S.tos[b]);
  });

  it('no question is counted by a split FDE did not print: every item is counted by its tag', () => {
    expect(slots.filter((s) => s.levels).map((s) => s.slot)).toEqual([]);
  });
});

describe('the prompt tells the model the level each fixed slot must test', () => {
  it('Section A: Q1 is eight Remember, six Understand, six Apply; Q2 (the map) is Remember', () => {
    const text = sectionPrompt('A');
    expect(text).toContain('Q1: exactly 8 Remember items, 6 Understand and 6 Apply');
    expect(text).toContain('Every Q2 item is Remember');
    expect(text).toContain('This section\'s 30 marks split by thinking level as Remember 18, Understand 6, Apply 6');
  });

  it('Section B: the flow chart and the mind map test understanding, not a list to recall', () => {
    const text = sectionPrompt('B');
    expect(text).toContain('Every Q3 item is Understand');
    expect(text).toContain('Every Q4 item is Understand');
    expect(text).toMatch(/Q4[^\n]*not a list of duties/);
  });
});

describe('the recorded sandbox paper is not re-scored: it is counted by its tags', () => {
  it('as recorded it still reads 46/30/24 and the blueprint says so', () => {
    const { r, pct } = laid(() => {});
    expect(pct).toEqual([46, 30, 24]);
    expect(r.problems.some((p) => p.code === 'LEVEL')).toBe(true);
  });

  it('the same paper written as the prompt now asks (Q1 8/6/6, Q4 Understand) reads 30/40/30 by its tags', () => {
    const { r, pct } = laid((u) => {
      items(u, 'social_studies.A.Q1').forEach((q, i) => { q.blooms = i < 8 ? 'Remember' : i < 14 ? 'Understand' : 'Apply'; });
      items(u, 'social_studies.B.Q4').forEach((q) => { q.blooms = 'Understand'; });
    });
    expect(pct).toEqual([30, 40, 30]);
    expect(r.problems).toEqual([]);
  });
});
