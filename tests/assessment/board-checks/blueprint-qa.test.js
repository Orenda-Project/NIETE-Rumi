'use strict';
const M = require('../../../bot/shared/services/assessment/board-checks/blueprint-qa');
const { mcq, srq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const mcqs = (n, slot, marks = 1) => Array.from({ length: n }, (_, i) => mcq(`m${i}`, slot, 'A', null, { marks }));
const orNode = (slot, m1 = 5, m2 = 5, b1 = 'U', b2 = 'U') => ({
  id: 'or1', slot, type: 'erq',
  or: [srq('a', slot, m1, { tag: { blooms: b1 } }), srq('b', slot, m2, { tag: { blooms: b2 } })],
});

// 20 MCQs (20) + SRQ attempt 10 of 14 x 1? -> keep arithmetic simple: SRQ 10/14 @2 = 20, ERQ 5/7 @ 4 = 20
function base() {
  const items = [
    ...mcqs(20, 's.A.Q1'),
    ...Array.from({ length: 14 }, (_, i) => srq(`s${i}`, 's.B.Q2', 2)),
    ...Array.from({ length: 7 }, (_, i) => ({ ...srq(`e${i}`, 's.C.Q3', 4), type: 'erq' })),
  ];
  const sections = [
    { id: 'A', marks: 20, slots: [row('s.A.Q1', { attempt: 20, printed: 20, generate: 20 })] },
    { id: 'B', marks: 20, slots: [row('s.B.Q2', { type: 'srq', attempt: 10, printed: 14, generate: 14, marks_each: 2 })] },
    { id: 'C', marks: 20, slots: [row('s.C.Q3', { type: 'erq', attempt: 5, printed: 7, generate: 7, marks_each: 4 })] },
  ];
  return { items, sections };
}
const build = (mut) => { const b = base(); if (mut) mut(b); return paper(b); };
const rules = (r) => r.issues.map((i) => i.rule);
const ctx = (extra) => ctxBoard({ variant: { total_marks: 60, sections: [], ...(extra || {}) } });

describe('D12 blueprint-qa', () => {
  test('exports the member interface and pinned LIMITS', () => {
    expect(M.id).toBe('D12'); expect(M.hard).toBe(true); expect(M.modes).toEqual(['board']);
    expect(M.LIMITS).toEqual({ mcqShareTolerance: 0 });
  });

  test('(1) clean fixture is ok, input is not mutated', () => {
    const r = M.run(deepFreeze(build()), deepFreeze(ctx()));
    expect(r.issues).toEqual([]); expect(r.ok).toBe(true);
  });

  test('(2) 19 MCQs under a 20-printed slot -> SLOT_COUNT at the slot', () => {
    const r = M.run(build((b) => b.items.splice(0, 1)), ctx());
    const i = r.issues.find((x) => x.rule === 'SLOT_COUNT');
    expect(i).toMatchObject({ check: 'D12', item_ref: 's.A.Q1', slot: 's.A.Q1', hard: true });
    expect(r.ok).toBe(false);
  });

  test('(3) section A declared 20, slots sum 19 -> SECTION_MARKS', () => {
    const r = M.run(build((b) => { b.sections[0].slots[0].attempt = 19; }), ctx());
    expect(rules(r)).toContain('SECTION_MARKS');
  });

  test('(4) attempt 10 of 14 with only 10 generated -> N_OF_M / SLOT_COUNT; attempt>printed -> N_OF_M', () => {
    const r = M.run(build((b) => { b.items = b.items.filter((x) => !/^s(1[0-3])$/.test(x.id)); }), ctx());
    expect(rules(r)).toContain('SLOT_COUNT');
    const r2 = M.run(build((b) => { b.sections[1].slots[0].attempt = 15; }), ctx());
    expect(rules(r2)).toContain('N_OF_M');
    const r3 = M.run(build((b) => { b.sections[1].slots[0].generate = 10; }), ctx());
    expect(rules(r3)).toContain('N_OF_M');
  });

  describe('(5) OR nodes', () => {
    const orPaper = (m1, m2, b1, b2) => paper({
      sections: [{ id: 'B', marks: 5, slots: [row('s.B.Q', { type: 'erq', or: true, marks_each: 5 })] }],
      items: [orNode('s.B.Q', m1, m2, b1, b2)],
    });
    test('same marks and level -> clean; counts once', () => {
      expect(M.run(orPaper(5, 5), ctxBoard({ variant: {} })).issues).toEqual([]);
    });
    test('branch marks differ -> hard OR', () => {
      const r = M.run(orPaper(4, 3), ctxBoard({ variant: {} }));
      expect(r.issues.find((i) => i.rule === 'OR' && i.hard)).toBeTruthy();
    });
    test('blooms differ -> soft only, ok stays true', () => {
      const r = M.run(orPaper(5, 5, 'U', 'A'), ctxBoard({ variant: {} }));
      expect(r.issues).toHaveLength(1); expect(r.issues[0]).toMatchObject({ rule: 'OR', hard: false }); expect(r.ok).toBe(true);
    });
    test('OR slot with a plain leaf or three branches -> hard OR', () => {
      const p = paper({ sections: [{ id: 'B', marks: 5, slots: [row('s.B.Q', { type: 'erq', or: true, marks_each: 5 })] }], items: [srq('x', 's.B.Q', 5)] });
      expect(rules(M.run(p, ctxBoard({ variant: {} })))).toContain('OR');
      const n = orNode('s.B.Q'); n.or.push(srq('c', 's.B.Q', 5));
      const p3 = paper({ sections: [{ id: 'B', marks: 5, slots: [row('s.B.Q', { type: 'erq', or: true, marks_each: 5 })] }], items: [n] });
      expect(rules(M.run(p3, ctxBoard({ variant: {} })))).toContain('OR');
    });
  });

  describe('stimulus groups', () => {
    const grp = (n, text = 'Passage') => ({
      id: 'g', slot: 's.A.Q', type: 'mcq', stimulus: { text, items: Array.from({ length: n }, (_, i) => mcq(`k${i}`, 's.A.Q', 'A')) },
    });
    const sp = (g, st = { count: 1, mcqs_per_stimulus: 4 }, generate = 4) => paper({
      sections: [{ id: 'A', marks: 4, slots: [row('s.A.Q', { attempt: 4, printed: 4, generate, stimulus: st })] }], items: [g],
    });
    test('clean group of 4', () => expect(M.run(sp(grp(4)), ctxBoard({ variant: {} })).issues).toEqual([]));
    test('(6) 3 MCQs where the entry says 4 -> STIMULUS', () => {
      expect(rules(M.run(sp(grp(3)), ctxBoard({ variant: {} })))).toContain('STIMULUS');
    });
    test('group count off -> STIMULUS', () => {
      expect(rules(M.run(sp(grp(4), { count: 2, mcqs_per_stimulus: 4 }), ctxBoard({ variant: {} })))).toContain('STIMULUS');
    });
    test('(7) empty text -> STIMULUS', () => {
      const r = M.run(sp(grp(4, '  ')), ctxBoard({ variant: {} }));
      expect(r.issues.some((i) => i.rule === 'STIMULUS' && /text/.test(i.msg))).toBe(true);
    });
  });

  test('(8) a teacher_marked slot carrying an item -> SLOT_COUNT; its marks still count', () => {
    const mk = (withItem) => paper({
      sections: [{ id: 'A', marks: 5, slots: [row('s.A.Q', { type: 'srq', teacher_marked: true, marks_each: 5, generate: 0 })] }],
      items: withItem ? [srq('t', 's.A.Q', 5)] : [],
    });
    expect(M.run(mk(false), ctxBoard({ variant: {} })).issues).toEqual([]);
    expect(rules(M.run(mk(true), ctxBoard({ variant: {} })))).toContain('SLOT_COUNT');
  });

  test('(9) 0.5-mark MCQs add exactly (40 x 0.5 + 20 x 0.5 = 30)', () => {
    const p = paper({
      sections: [
        { id: 'A', marks: 20, slots: [row('s.A.Q1', { attempt: 40, printed: 40, generate: 40, marks_each: 0.5 })] },
        { id: 'B', marks: 10, slots: [row('s.B.Q1', { attempt: 20, printed: 20, generate: 20, marks_each: 0.5 })] },
      ],
      items: [...mcqs(40, 's.A.Q1', 0.5), ...mcqs(20, 's.B.Q1', 0.5)],
    });
    expect(M.run(p, ctxBoard({ variant: { total_marks: 30 } })).issues).toEqual([]);
  });

  test('TOTAL: layout total or variant total off -> TOTAL', () => {
    expect(rules(M.run(build(), ctx({ total_marks: 70 })))).toContain('TOTAL');
    expect(rules(M.run(paper({ ...base(), total_marks: 65 }), ctx()))).toContain('TOTAL');
  });

  test('(10) TIME with shared B/C time; mismatch and parts', () => {
    const t = (mut) => build((b) => { b.sections[0].time_min = 30; b.sections[1].time_min = 40; mut && mut(b); });
    const v = (x) => ctx({ shared_time_min: 20, total_time_min: 90, ...x });
    expect(M.run(t(), v()).issues).toEqual([]);
    expect(rules(M.run(t(), v({ total_time_min: 100 })))).toContain('TIME');
    expect(M.run(build(), ctx({ total_time_min: 90 })).issues).toEqual([]); // sections have no time: skipped
    const bad = t((b) => { b.sections[0].parts = [{ time_min: 10 }, { time_min: 10 }]; });
    expect(rules(M.run(bad, v()))).toContain('TIME');
  });

  test('MCQ_SHARE: tolerance 0 against the variant ratio; skipped when the variant has no slots', () => {
    const vs = (m) => ({ sections: [{ id: 'A', slots: [{ type: 'mcq', attempt: m, marks_each: 1 }] }, { id: 'B', slots: [{ type: 'srq', attempt: 10, marks_each: 2 }, { type: 'erq', attempt: 5, marks_each: 4 }] }] });
    expect(M.run(build(), ctx(vs(20))).issues).toEqual([]);
    expect(rules(M.run(build(), ctx(vs(10))))).toContain('MCQ_SHARE');
  });

  test('(11) mode:free skips the registry run (modes is board-only)', () => {
    expect(M.modes).not.toContain('free');
  });
});
