/**
 * The blueprint check (bd-5jmnfj.2): after a board-pattern paper is laid out, recompute what it
 * actually carries — the paper total, each section's marks, each slot's count, and the marks split
 * by thinking level — and say where it misses the pattern and FDE's table of specification.
 *
 * The prompt asks for the split; until now nothing read it back. Haroon's own G5 fixtures show why:
 * the Maths paper is 60% Understand against FDE's 50, the Science paper 26% Apply against 40.
 *
 * Pure: no model, no network.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { checkBlueprint } = require('../../bot/shared/services/assessment/blueprint-check');

const P = Patterns.get('fde_g5_2027');
const TOS = {
  maths: { Remember: 10, Understand: 50, Apply: 40 },
  science: { Remember: 30, Understand: 30, Apply: 40 },
};

function laid(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  return applyLayout(raw, P.subjects[name], { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;
}

const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat()
  .filter((q) => q.slot === slot);
const codes = (r) => r.problems.map((p) => p.code);
const level = (r, band) => r.problems.find((p) => p.code === 'LEVEL' && p.level === band);

describe('Haroon\'s G5 Maths fixture', () => {
  const r = checkBlueprint(laid('maths'), { tos: TOS.maths });

  it('carries the full 100 and every section its pattern marks', () => {
    expect(r.total).toBe(100);
    expect(r.sections.map((s) => [s.id, s.marks, s.expected])).toEqual([['A', 40, 40], ['B', 40, 40], ['C', 20, 20]]);
    expect(codes(r)).not.toContain('TOTAL');
    expect(codes(r)).not.toContain('SECTION');
    expect(codes(r)).not.toContain('SLOT_SHORT');
  });

  it('counts a choice slot by the marks a child answers, not the items printed', () => {
    // Q2 prints 12 and the child answers 8 of 5 marks: 40, never 60.
    expect(r.sections.find((s) => s.id === 'B').marks).toBe(40);
  });

  it('reads the split by level: 5 Remember, 60 Understand, 35 Apply', () => {
    expect(r.levels.Remember.pct).toBeCloseTo(5, 5);
    expect(r.levels.Understand.pct).toBeCloseTo(60, 5);
    expect(r.levels.Apply.pct).toBeCloseTo(35, 5);
  });

  it('flags Understand 10 over FDE\'s 50, and lets the two misses of exactly 5 stand', () => {
    expect(level(r, 'Understand')).toMatchObject({ target: 50 });
    expect(level(r, 'Understand').off).toBeCloseTo(10, 5);
    expect(level(r, 'Remember')).toBeUndefined();
    expect(level(r, 'Apply')).toBeUndefined();
    expect(r.ok).toBe(false);
  });
});

describe('Haroon\'s G5 Science fixture', () => {
  it('flags all three levels off FDE\'s 30/30/40', () => {
    const r = checkBlueprint(laid('science'), { tos: TOS.science });
    expect(r.levels.Apply.pct).toBeCloseTo(26.2, 1);
    expect(level(r, 'Apply').off).toBeCloseTo(-13.8, 1);
    expect(level(r, 'Understand').off).toBeCloseTo(22.3, 1);
    expect(level(r, 'Remember').off).toBeCloseTo(-8.5, 1);
  });
});

describe('a paper on its blueprint', () => {
  it('passes when every level sits on target', () => {
    const exam = laid('maths');
    // 20 MCQs of 1 + 10 of 2 = 40 marks of section A; Q2 = 40; Q3 + Q4-8 = 20.
    items(exam, 'maths.A.Q1a').forEach((q, i) => { q.blooms = i < 10 ? 'Remember' : 'Understand'; });
    items(exam, 'maths.A.Q1b').forEach((q) => { q.blooms = 'Understand'; });
    items(exam, 'maths.B.Q2').forEach((q, i) => { q.blooms = i < 6 ? 'Understand' : 'Apply'; });
    items(exam, 'maths.C.Q3').forEach((q) => { q.blooms = 'Apply'; });
    items(exam, 'maths.C.Q4-8').forEach((q) => { q.blooms = 'Apply'; });
    const r = checkBlueprint(exam, { tos: TOS.maths });
    expect(r.levels.Remember.marks).toBeCloseTo(10, 5);
    expect(r.levels.Understand.marks).toBeCloseTo(50, 5);
    expect(r.levels.Apply.marks).toBeCloseTo(40, 5);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('skips the level check when the subject has no table of specification', () => {
    const r = checkBlueprint(laid('maths'), {});
    expect(codes(r)).not.toContain('LEVEL');
    expect(r.ok).toBe(true);
  });

  it('takes a wider tolerance when given one', () => {
    const r = checkBlueprint(laid('maths'), { tos: TOS.maths, tolerance: 10 });
    expect(level(r, 'Understand')).toBeUndefined();
  });
});

describe('what the check catches', () => {
  it('an item with no level, named by slot, counted in no level', () => {
    const exam = laid('maths');
    items(exam, 'maths.A.Q1a')[0].blooms = 'Evaluate';
    const r = checkBlueprint(exam, { tos: TOS.maths });
    expect(r.problems).toContainEqual(expect.objectContaining({ code: 'UNTAGGED', slot: 'maths.A.Q1a', count: 1 }));
    expect(r.levels.Remember.marks + r.levels.Understand.marks + r.levels.Apply.marks).toBeCloseTo(99, 5);
  });

  it('a slot a removal took below its count, its section and the total', () => {
    const exam = laid('maths');
    items(exam, 'maths.C.Q3')[0].removed = true;
    const r = checkBlueprint(exam, { tos: TOS.maths });
    expect(r.problems).toContainEqual(expect.objectContaining({ code: 'SLOT_SHORT', slot: 'maths.C.Q3', live: 0, attempt: 1 }));
    expect(r.problems).toContainEqual(expect.objectContaining({ code: 'SECTION', section: 'C', marks: 15, expected: 20 }));
    expect(r.problems).toContainEqual(expect.objectContaining({ code: 'TOTAL', total: 95, expected: 100 }));
    expect(r.ok).toBe(false);
  });

  it('a removed item counts in no level', () => {
    const exam = laid('maths');
    const q2 = items(exam, 'maths.B.Q2');
    q2.slice(0, 4).forEach((q) => { q.removed = true; });
    const r = checkBlueprint(exam, {});
    // 8 left of 12, 8 answered: the slot still gives 40 across the 8 live items.
    expect(r.sections.find((s) => s.id === 'B').marks).toBe(40);
    expect(codes(r)).not.toContain('SLOT_SHORT');
  });

  it('refuses a paper that is not laid out on a pattern', () => {
    expect(() => checkBlueprint({ unseen: {} }, {})).toThrow(/NO_LAYOUT/);
  });
});
