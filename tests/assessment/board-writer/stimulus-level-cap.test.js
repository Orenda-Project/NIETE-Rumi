'use strict';
/** bd-5jmnfj.38.32/.33: a K excess that sits inside stimulus MCQs is capped by a steered rewrite, not only reported. Fictional cell, fake model. */
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const { quotaFor } = require(`${A}board-checks/_level-quota`);
const { makeDeps } = require('./helpers/fake-deps');
const { fictionalVariant } = require('./helpers/fictional-cell');

const LEVELS = { K: 10, U: 60, A: 30 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: { levels: LEVELS, tolerance_pp: 5 }, board_mode: 'board' };

function variant() {
  const v = fictionalVariant();
  v.cognitive_split = { tolerance_pp: 5, levels: LEVELS, source: 'policy', status: 'verified' };
  const s = v.sections[0].slots[0];
  Object.assign(s, { type: 'scenario', category: 'objective', printed: 8, attempt: 8, generate: 8, marks: 8, stimulus: { count: 2, kinds: ['passage'], mcqs_per_stimulus: 4 } });
  v.sections[0].marks = 8;
  v.total_marks = 24;
  v.generated_marks = 21;
  return v;
}
const tag = (n, b) => ({ chapter: 1, section: null, code: `g9.physics.ch1.lo${1 + (n % 3)}`, page: 10 + n, official_slo: null, blooms: b, difficulty: 'easy' });
const member = (n, b) => ({ main_question: 'Choose the correct option', question: `Made-up stimulus item ${n} about the kettle ${n}?`, options: [0, 1, 2, 3].map((i) => `${'ABCD'[i]}) thing ${n * 4 + i}`), marks: 1, lines: 0, answer: `A) thing ${n * 4}`, tag: tag(n, b) });
const groups = (levels) => ({ 'A.Q1': [0, 1].map((g) => ({ stimulus: `A made-up passage ${g} about a ladder.`, items: levels.slice(g * 4, g * 4 + 4).map((b, i) => member(g * 4 + i + 100, b)) })) });

test('a paper whose stimulus MCQs are all K is rewritten to the quota (K 1, U 5, A 2 of 8) and ends inside tolerance', async () => {
  const V = variant();
  const asked = [];
  const { d } = makeDeps({ grade: 9, row, levels: LEVELS, style: V.scheme_style, reply: (section, k, topUp, state) => {
    if (section.slots[0].slot !== 'A.Q1' || section.slots.length !== 1) return undefined;
    const rewrite = !!(state.rewrote);
    if (!rewrite) { state.rewrote = true; return groups(Array(8).fill('K')); }
    asked.push(section.slots[0].quota);
    const q = section.slots[0].quota || quotaFor(8, LEVELS);
    return groups(Object.keys(q).flatMap((l) => Array(q[l]).fill(l)));
  } });
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P: { key: 'physics', medium: 'en', name_en: 'Physics', legend: null, variants: [V] }, variant: V, requestId: 'r1' }, d);
  expect(asked).toEqual([{ K: 1, U: 5, A: 2 }]);
  const own = leavesOf(res.examJson).filter((l) => String(l.id).startsWith('A.Q1'));
  expect(own).toHaveLength(8);
  expect(own.filter((l) => l.tag.blooms === 'K').length).toBeLessThanOrEqual(1);
  expect(res.examJson._meta.checks.record.hard).toBe(0);
});
