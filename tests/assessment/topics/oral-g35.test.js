/**
 * bd-6clakk.11 — the FDE Grade 3-5 oral tasks: FDE's marks per paper, and a task's `script` flag
 * overriding whether the writer must send a script (verses to read need one, riddles do not).
 */
const G35 = require('../../../bot/shared/services/assessment/topics/oral-g35');
const { makeOral } = require('../../../bot/shared/services/assessment/patterns/early/chrome');
const { oralContent } = require('../../../bot/shared/services/assessment/fde-early-prompt');

const total = (tasks) => tasks.reduce((n, t) => n + t.marks, 0);

test.each([
  ['english', 3, 20], ['english', 4, 15], ['english', 5, 10],
  ['urdu', 3, 30], ['urdu', 4, 30], ['urdu', 5, 30],
])('%s G%i oral is FDE\'s %i marks', (subject, grade, marks) => {
  expect(total(G35[subject][grade])).toBe(marks);
});

test('every task builds: its rubric reads as each, criteria or bands', () => {
  for (const subject of ['english', 'urdu']) {
    for (const grade of [3, 4, 5]) expect(() => makeOral({ tasks: G35[subject][grade] })).not.toThrow();
  }
});

test('ids are unique within a paper and every task carries both labels', () => {
  for (const subject of ['english', 'urdu']) {
    for (const grade of [3, 4, 5]) {
      const ids = G35[subject][grade].map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(G35[subject][grade].every((t) => t.label_en && t.label_ur && t.ask)).toBe(true);
    }
  }
});

describe('the script flag', () => {
  const oral = { tasks: G35.urdu[3] };
  const reply = (over) => ({ oral: oral.tasks.map((t) => ({ id: t.id, script: 'متن', items: [{ ask: 'سوال', answer: 'جواب' }, { ask: 'سوال', answer: 'جواب' }, { ask: 'س', answer: 'ج' }, { ask: 'س', answer: 'ج' }], ...over[t.id] })) });

  test('verses with no script come back missing', () => {
    expect(oralContent(reply({ verses: { script: '' } }), oral).missing).toEqual(['verses']);
  });

  test('riddles need no script', () => {
    expect(oralContent(reply({ riddles: { script: '' } }), oral).missing).toEqual([]);
  });
});

const ALL = ['english', 'urdu'].flatMap((subject) => [3, 4, 5].flatMap((grade) => G35[subject][grade].map((t) => ({ subject, grade, t }))));

test('every task prints in both languages: no blank label, instruction, ask or rubric row', () => {
  for (const { t } of ALL) {
    for (const k of ['id', 'kind', 'label_en', 'label_ur', 'instruction_en', 'instruction_ur', 'ask']) expect(t[k]).toMatch(/\S/);
    expect(t.rubric.length).toBeGreaterThan(0);
    for (const r of t.rubric) { expect(r.en).toMatch(/\S/); expect(r.ur).toMatch(/\S/); }
  }
});

test('a split by question numbers its rows from 1 in both languages', () => {
  const rows = G35.urdu[4].find((t) => t.id === 'listening').rubric;
  expect(rows.map((r) => [r.en, r.ur, r.marks])).toEqual([['Question 1', 'سوال 1', 1], ['Question 2', 'سوال 2', 2], ['Question 3', 'سوال 3', 2]]);
});

test('script flags: read-and-answer tasks need one, riddles do not, the rest follow the default', () => {
  const flags = ALL.filter(({ t }) => 'script' in t).map(({ subject, grade, t }) => `${subject}${grade}.${t.id}=${t.script}`);
  expect(flags.sort()).toEqual([
    'english5.dialogue=true', 'urdu3.riddles=false', 'urdu3.verses=true',
    'urdu4.moral=true', 'urdu4.poem=true', 'urdu5.riddles=false',
  ]);
});
