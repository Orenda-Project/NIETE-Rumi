'use strict';
/**
 * sa_r28_ceiling: a timed grid cell the phone PRESENTED and the child passed in silence (the auto-advance, or the
 * child's own Next) is attempted and incorrect (verdict wrong, reason no_response), as EGRA marks a no-response; it is
 * never not_reached. not_reached is left for cells never presented (the clock ended first) and for the no-voice
 * classes (a whole clip with no speech). Switch OFF, and on a task that does not extend, the rows are today's.
 * All batteries here are synthetic.
 */
const score = require('../../shared/services/child-test/sa/score');

const pad = (n) => String(n).padStart(2, '0');
const LETTERS = Array.from({ length: 100 }, (_, k) => 'bcdfghjklmnpqrstvwxyz'[k % 21]);
const WORDS = Array.from({ length: 50 }, (_, k) => `word${k + 1}`);

function extTask(id, subtask, shows, base) {
  const all = shows.map((w, k) => ({ id: `${id}.${pad(k + 1)}`, show: w, target: w, answer: w, src: `fixture:${id}[${k}]`, ...(k >= base ? { ext: true } : {}) }));
  const items = all.slice(0, base);
  return {
    id, w3: true, kind: 'grid', subtask, lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3, stop: {},
    items, grid: items.map((x) => x.show), base_n: base, ext_items: all.slice(base),
  };
}
const letters = () => extTask('en.letter_names5', 'letter_name_identification', LETTERS, 5);
const words = () => extTask('en.words4', 'familiar_word_reading', WORDS, 4);
/** Today's 5-letter task: no extension. */
function plainLetters() {
  const t = letters();
  delete t.base_n; delete t.ext_items;
  return t;
}

/**
 * The phone's cells: the first `read` closed by the child's Next tap after speaking, the rest by the auto-advance
 * (passed in silence); `last` overrides the final cell (time up).
 */
const cells = (id, n, read, last = {}) => Array.from({ length: n }, (_, i) => ({ i, item_id: `${id}.${pad(i + 1)}`, at_ms: i * 1700, ms: i < read ? 1500 : 3000, how: i < read ? 'tap' : 'auto', ...(i === n - 1 ? last : {}) }));
const row = (block, res) => ({ id: `row-${block}`, session_id: 's1', block, lang: 'en', response_mode: 'record', audio_r2_key: 'k', audio_r2_keys: null, responses: [{ kind: 'result', mode: 'record', session_id: 'p1', ...res }] });
const session = () => ({ id: 's1', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed' });

/** v(i) = 'c' | 'w' | 's' for position i (1-based); a silent position is heard '' as the model returns it. */
function deps(battery, v, extra = {}) {
  const prompts = [];
  return {
    prompts,
    bank: null,
    phoneBattery: () => battery,
    clipOf: async () => ({ base64: 'AAAA', durationSec: 60 }),
    model: () => 'test-model',
    chatJSON: async ({ prompt }) => {
      prompts.push(prompt);
      const n = listed(prompt);
      if (/LETTER/.test(prompt)) return { json: { found: true, items: Array.from({ length: n }, (_, k) => ({ i: k + 1, heard: v(k + 1) === 's' ? '' : 'x', v: v(k + 1), conf: 0.9 })) }, cost: 0, seconds: 1 };
      const W = { c: 'correct', w: 'wrong', s: 'skipped' };
      return { json: { words: Array.from({ length: n }, (_, k) => ({ i: k + 1, w: 'x', v: W[v(k + 1)] })) }, cost: 0, seconds: 1 };
    },
    ...extra,
  };
}
const listed = (prompt) => {
  const line = prompt.split('\n').find((l) => /^1:/.test(l)) || '';
  return (line.match(/(?:^| )(\d+):/g) || []).length;
};
const ON = { ceiling: true };

/** The qa fixture: a 100-cell grid, 5 read (c), 30 presented and passed in silence, 65 never drawn; 60 s on the clock. */
const FIX = { cells: cells('en.letter_names5', 35, 5, { how: 'time_up', ms: 2000 }), last_item_index: 34, time_used_ms: 60000, stop_reason: 'time_up' };
const fiveRead = (i) => (i <= 5 ? 'c' : 's');
const tally = (items) => items.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});

describe('sa_r28_ceiling ON: a presented cell passed in silence is wrong (no_response)', () => {
  test('100-cell grid: 5 read + 30 silent + 65 undrawn → correct 5, attempted 35, incorrect 30 (no_response), 65 not presented', async () => {
    const d = deps({ tasks: [letters()] }, fiveRead, ON);
    const got = await score.scoreRow(row('en.letter_names5', FIX), session(), d);
    expect(got.ok).toBe(true);
    const m = got.marks;
    expect(m).toMatchObject({ correct: 5, attempted: 35, per_minute: 5, seconds_used: 60 });
    expect(m.detail.items).toHaveLength(35);
    expect(tally(m.detail.items)).toEqual({ correct: 5, wrong: 30 });
    m.detail.items.slice(5).forEach((r, k) => expect(r).toEqual({ i: k + 6, ref: LETTERS[k + 5], verdict: 'wrong', reason: 'no_response', heard: '', conf: 0.9 }));
    m.detail.items.slice(0, 5).forEach((r) => expect(r).not.toHaveProperty('reason'));
    // the 65 never drawn are not presented: no row, and of_all + not presented = the grid
    expect(LETTERS.length - m.detail.of_all).toBe(65);
    expect(m.detail).toMatchObject({ of_all: 35, of_base: 5, correct_base: 5 });
    // the scorer and the attempted count now agree about the same cells
    expect(m.detail.items.filter((r) => r.verdict !== 'not_reached')).toHaveLength(m.attempted);
  });

  test('a gap before the last spoken cell (wrong today) also names its reason; a cell the model marked w is untouched', async () => {
    const v = (i) => (i === 2 ? 's' : i === 3 ? 'w' : i <= 5 ? 'c' : 's');
    const d = deps({ tasks: [letters()] }, v, ON);
    const res = { cells: cells('en.letter_names5', 8, 5), last_item_index: 7, time_used_ms: 30000, stop_reason: 'early_stop_silence' };
    const got = await score.scoreRow(row('en.letter_names5', res), session(), d);
    const it = got.marks.detail.items;
    expect(it[1]).toMatchObject({ verdict: 'wrong', reason: 'no_response' });
    expect(it[2]).toEqual({ i: 3, ref: LETTERS[2], verdict: 'wrong', heard: 'x', conf: 0.9 });
    expect(it.slice(5).map((r) => r.reason)).toEqual(['no_response', 'no_response', 'no_response']);
    expect(got.marks).toMatchObject({ correct: 3, attempted: 8, per_minute: 6 });
  });

  test('the 500 ms final cell is presented, not attempted: no row for it, the cells before it are no_response', async () => {
    const d = deps({ tasks: [letters()] }, fiveRead, ON);
    const res = { cells: cells('en.letter_names5', 36, 5, { how: 'time_up', ms: 300 }), last_item_index: 34, time_used_ms: 60000, stop_reason: 'time_up' };
    const got = await score.scoreRow(row('en.letter_names5', res), session(), d);
    expect(got.marks).toMatchObject({ correct: 5, attempted: 35 });
    expect(got.marks.detail.items).toHaveLength(35);
    expect(tally(got.marks.detail.items)).toEqual({ correct: 5, wrong: 30 });
  });

  test('familiar words (the story-style prompt): 3 read + 9 silent of a 50-word list → 9 no_response', async () => {
    const d = deps({ tasks: [words()] }, (i) => (i <= 3 ? 'c' : 's'), ON);
    const res = { cells: cells('en.words4', 12, 3), last_item_index: 11, time_used_ms: 60000, stop_reason: 'time_up' };
    const got = await score.scoreRow(row('en.words4', res), session(), d);
    expect(got.marks).toMatchObject({ correct: 3, attempted: 12, per_minute: 3 });
    expect(tally(got.marks.detail.items)).toEqual({ correct: 3, wrong: 9 });
    got.marks.detail.items.slice(3).forEach((r) => expect(r.reason).toBe('no_response'));
    expect(got.marks.detail).toMatchObject({ of_all: 12, of_base: 4, correct_base: 3 });
  });
});

describe('unchanged: OFF, a task that does not extend, and a clip with no speech at all', () => {
  test('OFF: the 100-cell fixture keeps today\'s rows (the 30 silent cells not_reached, no reason)', async () => {
    const got = await score.scoreRow(row('en.letter_names5', FIX), session(), deps({ tasks: [letters()] }, fiveRead));
    const m = got.marks;
    expect(m).toMatchObject({ correct: 5, attempted: 35, per_minute: 5, seconds_used: 60 });
    expect(tally(m.detail.items)).toEqual({ correct: 5, not_reached: 30 });
    m.detail.items.slice(5).forEach((r, k) => expect(r).toEqual({ i: k + 6, ref: LETTERS[k + 5], verdict: 'not_reached', heard: '', conf: 0.9 }));
    expect(m.detail).toMatchObject({ of_all: 35, of_base: 5, correct_base: 5 });
  });

  test('today\'s 5-letter task (no extension): ON and OFF give the same marks', async () => {
    const v = (i) => (i <= 3 ? 'c' : 's');
    const res = { cells: cells('en.letter_names5', 5, 3), last_item_index: 4, time_used_ms: 60000, stop_reason: 'time_up' };
    const strip = (g) => { const m = { ...g.marks }; delete m.meta; return m; };
    const off = await score.scoreRow(row('en.letter_names5', res), session(), deps({ tasks: [plainLetters()] }, v));
    const on = await score.scoreRow(row('en.letter_names5', res), session(), deps({ tasks: [plainLetters()] }, v, ON));
    expect(strip(on)).toEqual(strip(off));
    expect(tally(off.marks.detail.items)).toEqual({ correct: 3, not_reached: 2 });
  });

  describe('the speech gate on', () => {
    const was = process.env.CHILD_TEST_SA_SPEECH_GATE;
    beforeAll(() => { process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; });
    afterAll(() => { if (was === undefined) delete process.env.CHILD_TEST_SA_SPEECH_GATE; else process.env.CHILD_TEST_SA_SPEECH_GATE = was; });
    test('a whole clip with no speech on a presented grid is the no-voice class: every row not_reached, ON as OFF', async () => {
      const speechOf = async () => ({ words: 0, text: '', model: 'stt', cost: 0, seconds: 0 });
      const strip = (g) => { const m = { ...g.marks }; delete m.meta; return m; };
      const on = await score.scoreRow(row('en.letter_names5', FIX), session(), deps({ tasks: [letters()] }, fiveRead, { ...ON, speechOf }));
      const off = await score.scoreRow(row('en.letter_names5', FIX), session(), deps({ tasks: [letters()] }, fiveRead, { speechOf }));
      expect(on.marks.correct).toBe(0);
      expect(on.marks.detail.items).toHaveLength(35);
      on.marks.detail.items.forEach((r) => { expect(r.verdict).toBe('not_reached'); expect(r.no_speech).toBe(true); expect(r).not.toHaveProperty('reason'); });
      expect(strip(on)).toEqual(strip(off));
    });
  });
});
