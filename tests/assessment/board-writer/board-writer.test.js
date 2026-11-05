'use strict';
/** writeBoardPaper on recorded (fictional) replies: four cells, then the top-up and failure rules. No network. */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const fs = require('fs');
const path = require('path');
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const ssc2 = require(`${A}patterns/board/fbise-ssc2`);
const { makeDeps } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const rowOf = (code, grade, medium) => ({ code, grade, band: '9_10', medium, rtl: medium === 'ur', prompt_key: `eg.ict.${code}.9_10.system`, tos_default: TOS, board_mode: 'board' });
const variantOf = (entry, id) => entry.variants.find((v) => v.variant_id === id);

const CELLS = {
  physics50: { grade: 9, subject: 'physics', P: ssc1.subjects.physics, variant: variantOf(ssc1.subjects.physics, '50pct'), row: rowOf('physics', 9, 'en'), style: 'analytic_points' },
  mathsNon: { grade: 10, subject: 'maths', P: ssc2.subjects.maths, variant: variantOf(ssc2.subjects.maths, 'nonpct'), row: rowOf('maths', 10, 'en'), style: 'analytic_points' },
  urdu: { grade: 10, subject: 'pakistan_studies_ur', P: ssc2.subjects.pakistan_studies_ur, variant: ssc2.subjects.pakistan_studies_ur.variants[0], row: rowOf('pakistan_studies_ur', 10, 'ur'), style: 'analytic_points', ur: true },
  fictional: { grade: 9, subject: 'physics', P: fictionalEntry(), variant: fictionalVariant(), row: rowOf('physics', 9, 'en'), style: 'holistic_bands' },
};

const run = async (cell, extra) => {
  const { d, calls, state } = makeDeps({ ...cell, levels: cell.variant.cognitive_split.levels, reply: extra && extra.reply });
  const sections = [];
  const res = await writeBoardPaper({ grade: cell.grade, subject: cell.subject, pattern: 'fbise_ssc1_2027', P: cell.P, variant: cell.variant, onSection: (id) => sections.push(id), requestId: 'r1' }, d);
  return { res, calls, sections, state };
};

const TAG_KEYS = ['chapter', 'section', 'code', 'page', 'official_slo', 'blooms', 'difficulty'];
const x4 = (m) => Math.round(m * 4);

function commonAssertions(cell, res) {
  const ex = res.examJson;
  const L = ex._layout;
  const V = cell.variant;
  // layout totals
  expect(L.profile).toBe('board');
  expect(L.total_marks).toBe(V.total_marks);
  expect(L.sections.map((s) => s.id)).toEqual(V.sections.map((s) => s.id));
  expect(L.sections.reduce((n, s) => n + x4(s.marks), 0)).toBe(x4(V.total_marks));
  L.sections.forEach((s) => {
    expect(s.slots.length).toBe(V.sections.find((v) => v.id === s.id).slots.length);
    expect(s.slots.every((sl) => sl.slot && sl.section === s.id)).toBe(true);
  });
  expect(L.scheme_style).toBe(V.scheme_style);
  // the renderers (slice 8 board-render/layout.js) read the flat list: it must survive, in order
  expect(Array.isArray(L.slots)).toBe(true);
  expect(L.slots.map((s) => s.slot)).toEqual(L.sections.flatMap((s) => s.slots.map((sl) => sl.slot)));
  // checks ran and found nothing hard
  expect(L.checks.ran).toEqual(expect.arrayContaining(['tag-complete', 'blueprint-qa', 'mcq-shape', 'scheme-sum', 'key-leak']));
  expect(L.checks.errors).toEqual([]);
  expect(L.checks.hard).toBe(0);
  expect(L.checks.mode).toBe('board');
  // every item carries its tag, type and slot; no top-level blooms; no image keys
  const leaves = leavesOf(ex);
  expect(leaves.length).toBeGreaterThan(0);
  leaves.forEach((l) => {
    expect(Object.keys(l.tag).sort()).toEqual([...TAG_KEYS].sort());
    expect(typeof l.type).toBe('string');
    expect('blooms' in l).toBe(false);
  });
  // M generated for every slot (printed = generate), teacher-marked slots nothing
  L.sections.forEach((s) => s.slots.forEach((sl) => {
    const got = leaves.filter((l) => l.slot === sl.slot || (l.id || '').startsWith(`${sl.slot}#`)).length;
    if (sl.teacher_marked) expect(got).toBe(0);
    else if (!sl.or) expect(got).toBe(sl.generate);
  }));
  // scheme sums
  const style = V.scheme_style;
  leaves.filter((l) => l.type === 'srq' || l.type === 'erq').forEach((l) => {
    if (style === 'analytic_points') expect(l.scheme.points.reduce((n, p) => n + x4(p.marks), 0)).toBe(x4(l.marks));
    else expect(l.scheme.bands[0].hi).toBe(l.marks);
    expect(style === 'analytic_points' ? 'bands' in l.scheme : 'points' in l.scheme).toBe(false);
  });
  leaves.filter((l) => l.type === 'mcq' || l.type === 'scenario').forEach((l) => expect('scheme' in l).toBe(false));
  // no key in child-facing fields
  leaves.forEach((l) => {
    const child = JSON.stringify([l.main_question, l.question, l.options || []]);
    if (!l.options && l.answer) expect(child).not.toContain(l.answer);
    expect('answer' in l ? JSON.stringify(l.options || []) : '').not.toMatch(/correct answer|key:/i);
  });
  // wrapper shape
  expect(res.questionCount).toBe(leaves.length);
  expect(res.tokenData.model).toBe('test-model');
  expect(res.layout.unplaced).toBe(0);
  expect(ex._meta).toEqual(expect.objectContaining({ mode: 'board', grade: cell.grade, subject: cell.subject, variant: V.variant_id }));
}

describe('writeBoardPaper, four cells', () => {
  test('FBISE SSC-I Physics 50%: stimulus groups, 100% of M generated', async () => {
    const cell = CELLS.physics50;
    const { res, sections, calls } = await run(cell);
    commonAssertions(cell, res);
    const stimSlot = res.examJson._layout.sections[0].slots.find((s) => s.slot === 'A.Q41-60');
    expect(stimSlot.stimulus).toEqual({ count: 5, mcqs_per_stimulus: 4, kinds: ['passage'] });
    const groups = res.examJson.unseen.objective.MCQs.filter((q) => q.stimulus);
    expect(groups).toHaveLength(5);
    groups.forEach((g) => { expect(g.stimulus.text.length).toBeGreaterThan(10); expect(g.stimulus.items).toHaveLength(4); });
    expect(sections).toEqual(['A', 'B', 'C']);
    expect(calls.map((c) => c.section)).toEqual(['A', 'B', 'C']);
    expect(res.sections.map((s) => s.id)).toEqual(['A', 'B', 'C']);
  });

  test('SSC-II Maths non-50%', async () => {
    const cell = CELLS.mathsNon;
    const { res } = await run(cell);
    commonAssertions(cell, res);
    expect(res.examJson._layout.variant).toBe('nonpct');
  });

  test('an Urdu-medium cell is rtl and keeps Urdu option labels', async () => {
    const cell = CELLS.urdu;
    const { res, calls } = await run(cell);
    commonAssertions(cell, res);
    expect(res.examJson._layout.rtl).toBe(true);
    expect(res.examJson._layout.medium).toBe('ur');
    const mcq = leavesOf(res.examJson).find((l) => l.type === 'mcq');
    expect(mcq.options[0].startsWith('الف)')).toBe(true);
    const urduFormat = require(`${A}prompts-6-12`).promptFor('eg.format.secondary_urdu');
    expect(calls[0].system).toContain(urduFormat.slice(0, 40));
  });

  test('an OR slot is generated and keyed both ways; a teacher-marked slot generates nothing and costs no call', async () => {
    const cell = CELLS.fictional;
    const { res, calls, sections } = await run(cell);
    commonAssertions(cell, res);
    const or = res.examJson.unseen.subjective['Short and Extended'].find((q) => q.or);
    expect(or.or).toHaveLength(2);
    expect(or.or[0].marks).toBe(or.or[1].marks);
    or.or.forEach((b) => { expect(b.answer).toBeTruthy(); expect(b.scheme.bands).toBeTruthy(); expect(b.type).toBe('srq'); });
    // N of M: attempt 2 of 3 writes 3
    expect(leavesOf(res.examJson).filter((l) => (l.id || '').startsWith('B.Q2#'))).toHaveLength(3);
    const tm = res.examJson._layout.sections[2].slots.find((s) => s.slot === 'C.Q4');
    expect(tm.teacher_marked).toBe(true);
    expect(tm.generate).toBe(0);
    expect(calls.map((c) => c.section)).toEqual(['A', 'B']);
    expect(sections).toEqual(['A', 'B']);
  });
});

describe('prompts', () => {
  test('each call gets the filled section task, the slot lines and the book text; later sections see earlier stems', async () => {
    const { calls } = await run(CELLS.fictional);
    const [a, b] = calls;
    expect(a.system).toContain('WRITE ONE SECTION');
    expect(a.system).toContain('SECTION A of the paper');
    expect(a.system).toContain('- Q1 [slot A.Q1]: 4 x mcq at 1 marks');
    expect(a.system).toContain('Earlier sections already asked: none yet');
    expect(a.user).toContain('MADE-UP BOOK TEXT');
    expect(b.system).toContain('attempt any 2 of 3, write all 3');
    expect(b.system).toContain('OR: write both alternatives (srq / srq) at 5 marks each');
    expect(b.system).toContain('TEACHER-MARKED');
    expect(b.system).not.toContain('Earlier sections already asked: none yet');
    expect(b.system).toMatch(/Earlier sections already asked: Item 1/);
  });
});

describe('top-up', () => {
  const skipOne = (slotId) => (section, call, isTopUp, state) => {
    if (isTopUp) return undefined;
    state.skip[slotId] = 1;
    return undefined;
  };

  test('a short slot is asked for once more, with only the short slot named; the paper then ships complete', async () => {
    const cell = CELLS.fictional;
    let first = true;
    const { res, calls } = await run(cell, {
      reply: (section, call, isTopUp, state) => {
        if (section.id === 'A' && first) { first = false; state.skip['A.Q1'] = 1; return undefined; }
        state.skip['A.Q1'] = 0;
        return undefined;
      },
    });
    expect(calls.map((c) => [c.section, c.topUp])).toEqual([['A', false], ['A', true], ['B', false]]);
    expect(calls[1].user).toMatch(/TOP-UP.*A\.Q1 \(have 3, need 4\)/);
    expect(calls[1].user).not.toContain('B.Q2');
    commonAssertions(cell, res);
  });

  test('a second shortfall fails the paper with a named error and does not ask a third time', async () => {
    const cell = CELLS.fictional;
    const { d, calls } = makeDeps({ ...cell, levels: cell.variant.cognitive_split.levels, reply: (s, c, isTopUp, state) => { state.skip['A.Q1'] = isTopUp ? 4 : 2; return undefined; } });
    const err = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'A.Q1', have: 2, need: 4 }]);
    expect(err.model).toBe('test-model');
    expect(err.examJson).toBeTruthy();
    expect(calls.filter((c) => c.section === 'A')).toHaveLength(2);
    expect(calls.some((c) => c.section === 'B')).toBe(false);
  });

  test('extra items over what a slot generates are trimmed, not an error', async () => {
    const cell = CELLS.fictional;
    const { res } = await run(cell, { reply: (s, c, t, state) => { state.skip['A.Q1'] = -2; return undefined; } });
    commonAssertions(cell, res);
    expect(leavesOf(res.examJson).filter((l) => (l.id || '').startsWith('A.Q1#'))).toHaveLength(4);
  });
});

describe('hard checks after layout', () => {
  test('a key that leaks into the stem is dropped and that slot is asked once more', async () => {
    const cell = CELLS.fictional;
    let leaked = false;
    const { res, calls } = await run(cell, {
      reply: (section, call, isTopUp, state) => {
        if (section.id !== 'A') return undefined;
        const { buildReply } = require('./helpers/fake-deps');
        const tree = buildReply(section.slots, { grade: 9, row: cell.row, levels: TOS.levels, style: cell.style, ur: false }, state);
        if (!leaked) {
          leaked = true;
          const q = tree.unseen.objective.MCQs[0];
          q.question = `${q.question} (the answer is ${q.answer.slice(3)})`;
        }
        return tree;
      },
    });
    expect(calls.filter((c) => c.section === 'A').map((c) => c.topUp)).toEqual([false, true]);
    expect(res.examJson._layout.checks.hard).toBe(0);
    expect(JSON.stringify(res.examJson)).not.toContain('the answer is');
  });

  test('a hard issue that survives the one repair fails the paper', async () => {
    const cell = CELLS.fictional;
    const { d } = makeDeps({
      ...cell, levels: TOS.levels,
      reply: (section, call, isTopUp, state) => {
        if (section.id !== 'A') return undefined;
        const { buildReply } = require('./helpers/fake-deps');
        const tree = buildReply(section.slots, { grade: 9, row: cell.row, levels: TOS.levels, style: cell.style, ur: false }, state);
        tree.unseen.objective.MCQs.forEach((q) => { q.question = `${q.question} (the answer is ${q.answer.slice(3)})`; });
        return tree;
      },
    });
    const err = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall.length).toBeGreaterThan(0);
  });
});

describe('boundaries', () => {
  test('the writer never requires fde-layout or the service', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../bot/shared/services/assessment/board-writer.js'), 'utf8');
    expect(src).not.toMatch(/fde-layout|applyLayout|assessment-generation\.service/);
  });
  test('a missing variant is asked from d.variantFor', async () => {
    const cell = CELLS.fictional;
    const { d } = makeDeps({ ...cell, levels: TOS.levels });
    d.variantFor = (P, o) => { expect(o).toEqual({ grade: 9 }); return cell.variant; };
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P }, d);
    expect(res.examJson._layout.variant).toBe(cell.variant.variant_id);
  });
  test('no variant at all is a named error before any call', async () => {
    const cell = CELLS.fictional;
    const { d, calls } = makeDeps({ ...cell, levels: TOS.levels });
    d.variantFor = () => null;
    const err = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P }, d).catch((e) => e);
    expect(err.code).toBe('PATTERN_NO_VARIANT');
    expect(calls).toHaveLength(0);
  });
  test('onSection failing does not fail the paper', async () => {
    const cell = CELLS.fictional;
    const { d } = makeDeps({ ...cell, levels: TOS.levels });
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant, onSection: async () => { throw new Error('boom'); } }, d);
    expect(res.questionCount).toBeGreaterThan(0);
  });
});
