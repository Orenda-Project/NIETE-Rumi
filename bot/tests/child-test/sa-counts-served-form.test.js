'use strict';
/**
 * The counts form (sa_r8_counts) is read from what the phone SERVED, never from how far the child got.
 *
 * ma.add2i is committed with 2 sums; sa_r8_counts serves 5 (three spares appended as .03-.05). The scorer used to infer
 * the form from the cells that came back, so a child cut off after the first 2 sums of the 5-item form looked like the
 * 2-item form and scored 2/2 (Add met), while another child with the same 2 right on the same form scored 2/5. The
 * phone now records served_n (the number of items it served) on a one-at-a-time result when sa_r8_counts served the
 * battery (ui.r8_counts), and the scorer takes the form
 * from it; under sa_r28_ceiling the base it recorded (base_n) says the same for the words. A result without either (an
 * older phone) keeps today's inference. No level cut-off changes. Synthetic rows only.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');
const level = require('../../shared/services/child-test/sa/level');
const core = require('../../../dashboard/sa/sa-core');

const SID = 'eeeeeeee-0000-4000-8000-0000000000c5';
const KEY = (id) => `child-test/sandbox/sch-1/${SID}/sa/${id}.webm`;
const pad = (n) => String(n).padStart(2, '0');
const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-25T10:00:00Z' });
const cells = (id, n) => Array.from({ length: n }, (_, i) => ({ i, item_id: `${id}.${pad(i + 1)}`, at_ms: i * 3000 }));
const clips = (id, n) => cells(id, n).map((c) => ({ i: c.item_id, key: KEY(c.item_id) }));
const row = (block, res, over = {}) => ({
  id: `row-${block}`, session_id: SID, block, lang: 'ur', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: null, updated_at: '2026-11-25T09:58:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', ...res }],
  ...over,
});

describe('phoneSpecFor: the form the phone served (served_n), not the cells that came back', () => {
  test('the 5-item counts form, the child cut off after 2 sums: 5 sums, not 2', () => {
    const got = score.phoneSpecFor(session(), row('ma.add2i', { served_n: 5, cells: cells('ma.add2i', 2), stop_reason: 'early_stop_silence' }, { audio_r2_keys: clips('ma.add2i', 2) }));
    expect(got.spec.record.items.map((x) => x.id)).toEqual(['ma.add2i.01', 'ma.add2i.02', 'ma.add2i.03', 'ma.add2i.04', 'ma.add2i.05']);
  });
  test('the 2-item form served (served_n 2), 2 sums answered: 2', () => {
    const got = score.phoneSpecFor(session(), row('ma.add2i', { served_n: 2, cells: cells('ma.add2i', 2) }, { audio_r2_keys: clips('ma.add2i', 2) }));
    expect(got.spec.record.items).toHaveLength(2);
  });
  test('the other counts-form sums too: subtraction served 5, cut after 1 → 5; multiplication served 4, cut after 2 → 4', () => {
    expect(score.phoneSpecFor(session(), row('ma.sub2i', { served_n: 5, cells: cells('ma.sub2i', 1) }, { audio_r2_keys: clips('ma.sub2i', 1) })).spec.record.items).toHaveLength(5);
    expect(score.phoneSpecFor(session(), row('ma.mul2i', { served_n: 4, cells: cells('ma.mul2i', 2) }, { audio_r2_keys: clips('ma.mul2i', 2) })).spec.record.items).toHaveLength(4);
  });
  test('words served as the counts form (served_n 5), cut off after 2 words: 5 words', () => {
    const got = score.phoneSpecFor(session(), row('ur.words4', { served_n: 5, cells: cells('ur.words4', 2) }, { audio_r2_key: KEY('ur.words4') }));
    expect(got.spec.record.items).toHaveLength(5);
  });
  test('an older result without served_n keeps today\'s inference: 2 cells → 2 sums, 5 clips → 5 sums', () => {
    expect(score.phoneSpecFor(session(), row('ma.add2i', { cells: cells('ma.add2i', 2) }, { audio_r2_keys: clips('ma.add2i', 2) })).spec.record.items).toHaveLength(2);
    expect(score.phoneSpecFor(session(), row('ma.add2i', {}, { audio_r2_keys: clips('ma.add2i', 5) })).spec.record.items).toHaveLength(5);
  });
  test('a served_n neither form has (not this build\'s forms) falls back to today\'s inference', () => {
    expect(score.phoneSpecFor(session(), row('ma.add2i', { served_n: 9, cells: cells('ma.add2i', 2) }, { audio_r2_keys: clips('ma.add2i', 2) })).spec.record.items).toHaveLength(2);
  });
});

describe('sa_r28_ceiling: the base the phone served (base_n) says the words\' form', () => {
  const pad2 = pad;
  const word = (k, ext) => ({ id: `ur.words4.${pad2(k + 1)}`, show: `w${k + 1}`, target: `w${k + 1}`, answer: `w${k + 1}`, src: `fixture:ur.words.items[${k}]`, ...(ext ? { ext: true } : {}) });
  /** words4 as the bank commits it: base 4, the extension whose first word (.05) is the counts spare (same src) */
  const committed = () => ({
    id: 'ur.words4', w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: 'ur', response: 'record', present: 'one_at_a_time',
    time_limit_s: 60, stop: {}, items: [0, 1, 2, 3].map((k) => word(k)), grid: ['w1', 'w2', 'w3', 'w4'],
    base_n: 4, ext_items: Array.from({ length: 8 }, (_, j) => word(4 + j, true)), ext_stop: { type: 'first_row', n: 5 },
  });
  const spare = { id: 'ur.words', items: Array.from({ length: 10 }, (_, k) => ({ id: `ur.words.${k}`, target: `w${k + 1}`, src: `fixture:ur.words.items[${k}]` })) };
  const load = () => ({ tasks: [committed(), spare] });
  test('base_n 5 (the counts spare served), the child cut off after 2 words: the 5-word form', () => {
    const got = score.phoneSpecFor(session(), row('ur.words4', { base_n: 5, served_n: 12, cells: cells('ur.words4', 2) }, { audio_r2_key: KEY('ur.words4') }), load);
    expect(got.spec.record.items.map((x) => x.id)).toEqual(['ur.words4.01', 'ur.words4.02', 'ur.words4.03', 'ur.words4.04', 'ur.words4.05']);
  });
  test('base_n 4 (no spare served), cut off after 2 words: today\'s 4', () => {
    const got = score.phoneSpecFor(session(), row('ur.words4', { base_n: 4, served_n: 12, cells: cells('ur.words4', 2) }, { audio_r2_key: KEY('ur.words4') }), load);
    expect(got.spec.record.items).toHaveLength(4);
  });
  test('base_n 5, a run past the base (12 cells): the extended list as before', () => {
    const got = score.phoneSpecFor(session(), row('ur.words4', { base_n: 5, served_n: 12, cells: cells('ur.words4', 12) }, { audio_r2_key: KEY('ur.words4') }), load);
    expect(got.spec.record.items).toHaveLength(12);
  });
});

describe('end to end: the phone\'s own result → the scorer → the Add rung', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    delete process.env.CHILD_TEST_SA_SPEECH_GATE; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  /**
   * The phone runs ma.add2i as served (n sums); the child answers the first sum, moves on, and is stopped by the
   * silence stop on the second: the result's cells name .01 and .02 only, items the 2-item form has too.
   */
  function phoneResult(n) {
    const all = [['13 + 6', 19], ['18 + 7', 25], ['12 + 14', 26], ['22 + 37', 59], ['38 + 26', 64]];
    const task = { id: 'ma.add2i', w3: true, kind: 'oral', subtask: 'mental_addition', response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
      items: all.slice(0, n).map(([show, a], k) => ({ id: `ma.add2i.${pad(k + 1)}`, show, target: a, answer: a, src: `fixture:sums[${k}]` })) };
    let t = 0;
    // as the route serves it with sa_r8_counts on: ui.r8_counts on the battery
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [task], ui: { r8_counts: true } }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true });
    r.start(); r.instructionDone(); r.begin();
    t += 3000; r.nextCell('tap');
    t += 20000;
    r.silence(20);
    return r.view().result;
  }
  const deps = () => ({
    bank: { forms: {}, tasks: {} },
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 3, key }),
    model: () => 'model:test',
    chatJSON: async () => ({ json: { found: true, last_attempted: 1, letters_correct: 1, items: [{ i: 1, heard: 'x', v: 'c', conf: 0.9 }] }, cost: 0, seconds: 1 }),
  });
  const met = { correct: 8, attempted: 8, detail: { kind: 'oral', items: Array.from({ length: 8 }, (_, i) => ({ i: i + 1 })) } };
  const maths = (addRow) => [
    { block: 'ma.number_id8', response_mode: 'record', ai_status: 'scored', ai_marks: met, responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete' }] },
    { block: 'ma.discrimination2', response_mode: 'tap', ai_status: 'pending', ai_marks: null, responses: [{ kind: 'result', mode: 'tap', correct: 2, attempted: 2, stop_reason: 'complete' }] },
    { block: 'ma.missing4', response_mode: 'tap', ai_status: 'pending', ai_marks: null, responses: [{ kind: 'result', mode: 'tap', correct: 4, attempted: 4, stop_reason: 'complete' }] },
    addRow,
  ];

  test('the phone records served_n on the result it ran (5 sums served, the child cut off on the 2nd)', () => {
    const res = phoneResult(5);
    expect(res.stop_reason).toBe('early_stop_silence');
    expect(res.cells.map((c) => c.item_id)).toEqual(['ma.add2i.01', 'ma.add2i.02']);
    expect(res.served_n).toBe(5);
  });

  test('served 5, 2 right then cut off: scored 2 of 5, so Add is NOT met (the level stays Compare numbers)', async () => {
    const res = phoneResult(5);
    const r = row('ma.add2i', res, { audio_r2_keys: clips('ma.add2i', 2) });
    const got = await score.scoreRow(r, session(), deps());
    expect(got.ok).toBe(true);
    expect(got.marks.correct).toBe(2);
    expect(got.marks.of).toBe(5);
    const add = { ...r, ai_status: 'scored', ai_marks: got.marks };
    expect(level.levelsOf(maths(add), []).find((x) => x.subject === 'ma').level).toBe('comparing');
  });

  test('served 2, 2 right: 2 of 2, Add met (the 2-item form is unchanged)', async () => {
    const res = phoneResult(2);
    expect(res.served_n).toBe(2);
    const r = row('ma.add2i', res, { audio_r2_keys: clips('ma.add2i', 2) });
    const got = await score.scoreRow(r, session(), deps());
    expect(got.marks).toMatchObject({ correct: 2, of: 2 });
    const add = { ...r, ai_status: 'scored', ai_marks: got.marks };
    expect(level.levelsOf(maths(add), []).find((x) => x.subject === 'ma').level).toBe('add');
  });
});
