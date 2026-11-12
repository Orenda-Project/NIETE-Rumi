'use strict';
/**
 * D22 in the writer (Amena, 7 Nov 2026: method marks for SSC/HSSC science numericals). A numerical short answer whose
 * scheme is one final-answer point is a hard issue: it is dropped, the rewrite is told the fault, and the paper ships
 * with the replacement. Amena (7 Nov 2026): one that stays answer-only after the rewrites ships as a paper-level note.
 * Fake model; the FBISE SSC-I physics 50% variant under analytic_points.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps } = require('./helpers/fake-deps');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const P = ssc1.subjects.physics;
const variant = P.variants.find((v) => v.variant_id === '50pct');
const STEM = 'A made-up trolley covers 100 m in 5 s. Find its speed.';

test('an answer-only numerical scheme is dropped, the rewrite is told why, and the paper ships without it', async () => {
  const srq = variant.sections.flatMap((s) => s.slots).find((s) => s.type === 'srq' && !s.or && s.marks_each >= 2);
  expect(srq).toBeDefined();
  const { d, calls } = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points' });
  const real = d.writeSection;
  let planted = false;
  d.writeSection = async (args) => {
    const got = await real(args);
    const list = got.tree && got.tree[srq.slot];
    if (!planted && Array.isArray(list) && list.length && !/REWRITE/.test(args.messages[1].content)) {
      planted = true;
      Object.assign(list[0], { question: STEM, answer: 'v = 100/5 = 20 m/s', scheme: { points: [{ text: '20 m/s', marks: srq.marks_each }] } });
    }
    return got;
  };
  const logs = [];
  d.logToFile = (m, o) => logs.push([m, o]);
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, d);
  expect(planted).toBe(true);
  const re = calls.find((c) => /REWRITE/.test(c.user));
  expect(re.user).toContain(`"${STEM}": its scheme had only a final-answer mark`);
  expect(logs.find(([m]) => m === '[assessment] board rewrite outcome')[1].kept).toBe('rewrite 1');
  expect(leavesOf(res.examJson).map((l) => l.question)).not.toContain(STEM);
  expect(res.examJson._meta.checks.record.hard).toBe(0);
});

test('a scheme still answer-only after every rewrite ships the paper with a paper-level D22 note', async () => {
  const srq = variant.sections.flatMap((s) => s.slots).find((s) => s.type === 'srq' && !s.or && s.marks_each >= 2);
  const { d, calls } = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points' });
  const real = d.writeSection;
  d.writeSection = async (args) => {
    const got = await real(args);
    const list = got.tree && got.tree[srq.slot];
    if (Array.isArray(list) && list.length) Object.assign(list[0], { question: STEM, answer: 'v = 100/5 = 20 m/s', scheme: { points: [{ text: '20 m/s', marks: srq.marks_each }] } });
    // bd-qyi45h.7: a rewrite asks with slack, so every replacement is answer-only too, or the extra one would ship clean
    if (Array.isArray(list) && /REWRITE/.test(args.messages[1].content)) list.slice(1).forEach((q, i) => Object.assign(q, { question: `A made-up cart covers ${200 + 10 * i} m in 4 s. Find its speed.`, answer: `${50 + 2.5 * i} m/s`, scheme: { points: [{ text: `${50 + 2.5 * i} m/s`, marks: srq.marks_each }] } }));
    return got;
  };
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, d);
  expect(res.code).toBeUndefined();
  expect(calls.some((c) => /REWRITE/.test(c.user))).toBe(true);
  const { record, shortfall, notes } = res.examJson._meta.checks;
  expect(record.hard).toBe(0);
  expect(shortfall).toEqual([]);
  const d22 = notes.filter((n) => n.check === 'D22');
  expect(d22.length).toBeGreaterThan(0);
  d22.forEach((n) => expect(n).toMatchObject({ paper_level: true, slot: srq.slot }));
  expect(leavesOf(res.examJson).map((l) => l.question)).toContain(STEM);
});
