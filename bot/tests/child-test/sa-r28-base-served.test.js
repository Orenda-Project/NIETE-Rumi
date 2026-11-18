'use strict';
/**
 * Round 28 C (sa_r28_ceiling with sa_r8_counts): the scorer and the ladder read the base the child was SERVED (the
 * phone's result.base_n), never the bank's constant. The committed words task carries base_n 4; with sa_r8_counts ON
 * the route serves the counts spare as the 5th base word (the extension's own .05), so of_base / correct_base / the
 * first-row stop are over the first 5 words and the words rung reads them exactly as today's 5 (4 of 5 met, 3 of 5
 * unmet). With counts OFF the served base is 4. A result without base_n (served before the base followed the counts)
 * keeps the committed base. Letters (5) and numbers (8) have no spare. Synthetic fixtures only.
 */
const score = require('../../shared/services/child-test/sa/score');
const level = require('../../shared/services/child-test/sa/level');
const { countsTask } = require('../../shared/services/child-test/sa/counts');

const pad = (n) => String(n).padStart(2, '0');
const SOURCE = { id: 'en.words', items: Array.from({ length: 10 }, (_, k) => ({ id: `en.words.${pad(k + 1)}`, target: `w${k + 1}`, src: `fixture:en.words.items[${k}]` })) };
const word = (k, ext) => ({ id: `en.words4.${pad(k + 1)}`, show: `w${k + 1}`, target: `w${k + 1}`, answer: `w${k + 1}`, src: `fixture:en.words.items[${k}]`, ...(ext ? { ext: true } : {}) });
/** the committed words task (what the scorer reads): today's 4, then the extension whose .05 is the counts spare */
const words = () => ({
  id: 'en.words4', w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: 'en', response: 'record', present: 'one_at_a_time',
  time_limit_s: 60, advance_after_s: 3, stop: {}, items: [0, 1, 2, 3].map((k) => word(k)), grid: ['w1', 'w2', 'w3', 'w4'],
  base_n: 4, ext_items: Array.from({ length: 16 }, (_, j) => word(4 + j, true)), ext_stop: { type: 'first_row', n: 5 },
});
const BATTERY = () => ({ tasks: [SOURCE, words()] });

const cells = (n) => Array.from({ length: n }, (_, i) => ({ i, item_id: `en.words4.${pad(i + 1)}`, at_ms: i * 2000, ms: 2000, how: 'tap' }));
const row = (res) => ({ id: 'row-w', session_id: 's1', block: 'en.words4', lang: 'en', response_mode: 'record', audio_r2_key: 'k', audio_r2_keys: null, responses: [{ kind: 'result', mode: 'record', session_id: 'p1', ...res }] });
const session = () => ({ id: 's1', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed' });
const listed = (prompt) => ((prompt.split('\n').find((l) => /^1:/.test(l)) || '').match(/(?:^| )(\d+):/g) || []).length;
function deps(right) {
  const prompts = [];
  return {
    prompts, bank: null, phoneBattery: () => BATTERY(), clipOf: async () => ({ base64: 'AAAA', durationSec: 60 }), model: () => 'test-model',
    chatJSON: async ({ prompt }) => { prompts.push(prompt); return { json: { words: Array.from({ length: listed(prompt) }, (_, k) => ({ i: k + 1, w: 'x', v: right.has(k + 1) ? 'correct' : 'wrong' })) }, cost: 0, seconds: 1 }; },
  };
}
const scoreRun = async (n, right, base) => {
  const d = deps(right);
  const res = { cells: cells(n), last_item_index: n - 1, time_used_ms: 60000, stop_reason: 'time_up', ...(base != null ? { base_n: base } : {}) };
  const got = await score.scoreRow(row(res), session(), d);
  return { got, d };
};
const wordsLevel = (marks) => level.levelsOf([
  { block: 'en.letter_names5', response_mode: 'record', ai_status: 'scored', ai_marks: { correct: 5, detail: { items: [1, 2, 3, 4, 5] } }, responses: [{ kind: 'result', stop_reason: 'time_up' }] },
  { block: 'en.words4', response_mode: 'record', ai_status: 'scored', ai_marks: marks, responses: [{ kind: 'result', stop_reason: 'time_up' }] },
], [])[0].level;

describe('the scorer reads the served base (result.base_n)', () => {
  test('counts ON: words base_n 5, of_base 5, correct_base over the first 5 (the spare .05 is the 5th base word)', async () => {
    const { got, d } = await scoreRun(12, new Set([1, 2, 3, 5, 8]), 5);
    expect(listed(d.prompts[0])).toBe(12);
    expect(got.marks.detail).toMatchObject({ of_all: 12, of_base: 5, correct_base: 4 });
    expect(got.marks.detail.items[4].ref).toBe('w5');
  });
  test('counts OFF: words base_n 4, of_base 4', async () => {
    const { got } = await scoreRun(12, new Set([1, 2, 3, 5, 8]), 4);
    expect(got.marks.detail).toMatchObject({ of_all: 12, of_base: 4, correct_base: 3 });
  });
  test('counts OFF: a 5-cell run went past the served 4, so it is the extension (of_base 4, of_all 5)', async () => {
    const { got } = await scoreRun(5, new Set([1, 2, 5]), 4);
    expect(got.marks.detail).toMatchObject({ of_all: 5, of_base: 4, correct_base: 2 });
  });
  test('counts ON: a 5-cell run is today\'s counts form (no new keys, 5 items)', async () => {
    const { got } = await scoreRun(5, new Set([1, 2, 5]), 5);
    expect(got.marks.detail.items).toHaveLength(5);
    for (const k of ['of_all', 'of_base', 'correct_base']) expect(got.marks.detail).not.toHaveProperty(k);
  });
  test('a result without base_n keeps the committed base (what was served before)', async () => {
    const { got } = await scoreRun(12, new Set([1, 2, 3, 5, 8]));
    expect(got.marks.detail).toMatchObject({ of_base: 4, correct_base: 3 });
  });
  test('the first-row stop reads the 5 served words: none right in the first 5 zeroes correct, the 5th right does not', async () => {
    const none = await scoreRun(12, new Set([6, 7, 8]), 5);
    expect(none.got.marks).toMatchObject({ correct: 0, attempted: 12 });
    const fifth = await scoreRun(12, new Set([5, 6]), 5);
    expect(fifth.got.marks.correct).toBe(2);
  });
});

describe('the words rung on the served 5 is today\'s arithmetic (4 of 5 met, 3 of 5 unmet)', () => {
  test('counts ON, 4 of the first 5 right: words met', async () => {
    const { got } = await scoreRun(12, new Set([1, 2, 3, 5]), 5);
    expect(wordsLevel(got.marks)).toBe('words');
  });
  test('counts ON, 3 of the first 5 right (all 3 in the first 4): words unmet, as today', async () => {
    const { got } = await scoreRun(12, new Set([1, 2, 3, 9, 10]), 5);
    expect(got.marks.detail).toMatchObject({ of_base: 5, correct_base: 3 });
    expect(wordsLevel(got.marks)).toBe('letters');
  });
  test('counts OFF, 3 of the first 4 right: words met (3 of 4, the OFF rule)', async () => {
    const { got } = await scoreRun(12, new Set([1, 2, 3]), 4);
    expect(wordsLevel(got.marks)).toBe('words');
  });
});

describe('counts.js sets the served base where it adds the spare', () => {
  test('the committed task: the spare appended as .05 makes base_n 5', () => {
    const t = countsTask(BATTERY(), words());
    expect(t.items.map((x) => x.id).slice(-1)).toEqual(['en.words4.05']);
    expect(t.base_n).toBe(5);
  });
  test('a task without base_n gets none (today\'s counts form byte for byte)', () => {
    const { base_n: _b, ext_items: _e, ext_stop: _s, ...plain } = words();
    expect(countsTask(BATTERY(), plain)).not.toHaveProperty('base_n');
  });
});
