'use strict';
/**
 * Round 28 C (sa_r28_ceiling): the timed one-at-a-time tasks run every cell of a longer list until the clock ends.
 * The committed task (what the scorer reads) keeps today's items / grid / stop and carries the extension beside them:
 * base_n, ext_items (ext: true), ext_stop. The route serves items + ext_items only with the switch ON, so a run whose
 * cells go past base_n ran the extended list; any other run is today's task, scored byte for byte as before.
 * Extended: the scorer prompts with the items reached (at least the base N), adds of_all / of_base / correct_base (the
 * Results ladder's fixed anchor), applies ext_stop (C-12) and follows the phone's 500 ms final-cell rule; with the
 * switch ON a run without the phone's clock gets no rate (C-5). All batteries here are synthetic.
 */
const score = require('../../shared/services/child-test/sa/score');
const level = require('../../shared/services/child-test/sa/level');
const { countsTask } = require('../../shared/services/child-test/sa/counts');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const pad = (n) => String(n).padStart(2, '0');
const WORDS = Array.from({ length: 50 }, (_, k) => `word${k + 1}`);
const LETTERS = Array.from({ length: 100 }, (_, k) => 'bcdfghjklmnpqrstvwxyz'[k % 21]);

/** A committed extended task: today's items / grid / stop, then base_n, ext_items (ext: true) and ext_stop beside them. */
function extTask(id, subtask, shows, { base = 4, extStop = null } = {}) {
  const all = shows.map((w, k) => ({ id: `${id}.${pad(k + 1)}`, show: w, target: w, answer: w, src: `fixture:${id}[${k}]`, ...(k >= base ? { ext: true } : {}) }));
  const items = all.slice(0, base);
  return {
    id, w3: true, kind: 'grid', subtask, lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3, stop: {},
    items, grid: items.map((x) => x.show), base_n: base, ext_items: all.slice(base), ...(extStop ? { ext_stop: extStop } : {}),
  };
}
const words = (o) => extTask('en.words4', 'familiar_word_reading', WORDS, { base: 4, ...o });
const letters = (o) => extTask('en.letter_names5', 'letter_name_identification', LETTERS, { base: 5, ...o });

/** The phone's cells: one per item reached; the last can close on time-up. lastIndex as the phone sets it. */
const cells = (id, n, last = {}) => Array.from({ length: n }, (_, i) => ({ i, item_id: `${id}.${pad(i + 1)}`, at_ms: i * 2000, ms: 2000, how: 'tap', ...(i === n - 1 ? last : {}) }));
const row = (block, res) => ({ id: `row-${block}`, session_id: 's1', block, lang: 'en', response_mode: 'record', audio_r2_key: 'k', audio_r2_keys: null, responses: [{ kind: 'result', mode: 'record', session_id: 'p1', ...res }] });
const session = () => ({ id: 's1', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed' });

/** Stand-ins for the clip and the model; the prompts are kept. verdict(i) = what the "model" says for position i. */
function deps(battery, verdict, extra = {}) {
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
      if (/LETTER/.test(prompt)) return { json: { found: true, items: Array.from({ length: n }, (_, k) => ({ i: k + 1, heard: 'x', v: verdict(k + 1) === 'correct' ? 'c' : verdict(k + 1) === 'wrong' ? 'w' : 's', conf: 0.9 })) }, cost: 0, seconds: 1 };
      return { json: { words: Array.from({ length: n }, (_, k) => ({ i: k + 1, w: 'x', v: verdict(k + 1) })) }, cost: 0, seconds: 1 };
    },
    ...extra,
  };
}
/** The numbered items a prompt lists (the words prompt: "1:go 2:sad"; the letters prompt: "1: b (b) 2: c"). */
const listed = (prompt) => {
  const line = prompt.split('\n').find((l) => /^1:/.test(l)) || '';
  return (line.match(/(?:^| )(\d+):/g) || []).length;
};

describe('scoreGrid on an extended grid (C-7, C.4)', () => {
  test('12 cells of a 50-word grid (base 4): the prompt lists the 12 reached, rows 12, of_all 12, of_base 4, correct_base on the first 4', async () => {
    const t = words();
    // right: 1, 3, 4 (base), 6, 9, 10
    const right = new Set([1, 3, 4, 6, 9, 10]);
    const d = deps({ tasks: [t] }, (i) => (i <= 12 ? (right.has(i) ? 'correct' : 'wrong') : 'skipped'));
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 12, { how: 'time_up', ms: 1500 }), last_item_index: 11, time_used_ms: 60000, stop_reason: 'time_up' }), session(), d);
    expect(got.ok).toBe(true);
    expect(d.prompts).toHaveLength(1);
    expect(listed(d.prompts[0])).toBe(12);
    const m = got.marks;
    expect(m.detail.items).toHaveLength(12);
    expect(m.attempted).toBe(12);
    expect(m.correct).toBe(6);
    expect(m.detail.of_all).toBe(12);
    expect(m.detail.of_base).toBe(4);
    expect(m.detail.correct_base).toBe(3);
    expect(m.detail).not.toHaveProperty('correct_cycle1');
    expect(m.per_minute).toBe(6);
    expect(m.seconds_used).toBe(60);
  });

  test('a rate on time used: the whole grid of 50 read in 40 s is 50 × 60 / 40', async () => {
    const d = deps({ tasks: [words()] }, () => 'correct');
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 50), last_item_index: 49, time_used_ms: 40000, stop_reason: 'complete' }), session(), d);
    expect(listed(d.prompts[0])).toBe(50);
    expect(got.marks).toMatchObject({ correct: 50, attempted: 50, per_minute: 75, seconds_used: 40 });
  });

  test('3 cells (an OFF-style run): the prompt lists the 4 base items and the marks are today\'s (no new keys)', async () => {
    const d = deps({ tasks: [words()] }, (i) => (i <= 3 ? 'correct' : 'skipped'));
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 3), last_item_index: 2, time_used_ms: 20000, stop_reason: 'early_stop_silence' }), session(), d);
    expect(listed(d.prompts[0])).toBe(4);
    expect(got.marks.detail.items).toHaveLength(4);
    expect(got.marks).toMatchObject({ correct: 3, attempted: 3 });
    for (const k of ['of_all', 'of_base', 'correct_base', 'seconds_assumed', 'rate_pending']) expect(got.marks.detail).not.toHaveProperty(k);
  });

  test('a committed extended task and today\'s task give the same marks for a run inside today\'s items', async () => {
    const plain = { ...words() };
    delete plain.base_n; delete plain.ext_items;
    const res = { cells: cells('en.words4', 4), last_item_index: 3, time_used_ms: 30000, stop_reason: 'complete' };
    const a = await score.scoreRow(row('en.words4', res), session(), deps({ tasks: [words()] }, (i) => (i === 2 ? 'wrong' : 'correct')));
    const b = await score.scoreRow(row('en.words4', res), session(), deps({ tasks: [plain] }, (i) => (i === 2 ? 'wrong' : 'correct')));
    const strip = (g) => { const m = { ...g.marks }; delete m.meta; return m; };
    expect(strip(a)).toEqual(strip(b));
  });

  test('a task without base_n: the marks are byte-identical to the ones before round 28 (snapshot taken on the base commit)', async () => {
    const BEFORE = {"words": {"version": "sa-marks-v1", "task": "en.words4", "correct": 3, "attempted": 4, "per_minute": 6, "seconds_used": 30, "detail": {"kind": "grid", "subtask": "familiar_word_reading", "variant": null, "stopped_by_rule": false, "confidence": null, "items": [{"i": 1, "ref": "go", "verdict": "correct", "heard": "", "conf": null}, {"i": 2, "ref": "sad", "verdict": "wrong", "heard": "", "conf": null}, {"i": 3, "ref": "up", "verdict": "correct", "heard": "", "conf": null}, {"i": 4, "ref": "find", "verdict": "correct", "heard": "", "conf": null}]}, "model_versions": {"counts": "test-model"}}, "letters": {"version": "sa-marks-v1", "task": "en.letter_names5", "correct": 3, "attempted": 5, "per_minute": 3, "seconds_used": 60, "detail": {"kind": "grid", "subtask": "letter_name_identification", "variant": null, "stopped_by_rule": false, "confidence": 0.9, "items": [{"i": 1, "ref": "b", "verdict": "correct", "heard": "x", "conf": 0.9}, {"i": 2, "ref": "k", "verdict": "wrong", "heard": "x", "conf": 0.9}, {"i": 3, "ref": "m", "verdict": "correct", "heard": "x", "conf": 0.9}, {"i": 4, "ref": "s", "verdict": "wrong", "heard": "x", "conf": 0.9}, {"i": 5, "ref": "t", "verdict": "correct", "heard": "x", "conf": 0.9}]}, "model_versions": {"counts": "test-model"}}};
    const W = ['go', 'sad', 'up', 'find'];
    const L = ['b', 'k', 'm', 's', 't'];
    const plain = (id, subtask, shows) => ({ id, w3: true, kind: 'grid', subtask, lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3, stop: {},
      items: shows.map((w, k) => ({ id: `${id}.${pad(k + 1)}`, show: w, target: w, answer: w, src: `fixture:${id === 'en.words4' ? 'words' : 'letters'}[${k}]` })), grid: shows });
    const battery = { tasks: [plain('en.words4', 'familiar_word_reading', W), plain('en.letter_names5', 'letter_name_identification', L)] };
    const d = deps(battery, () => 'correct', {
      chatJSON: async ({ prompt }) => {
        if (/LETTER/.test(prompt)) return { json: { found: true, items: [1, 2, 3, 4, 5].map((i) => ({ i, heard: 'x', v: i % 2 ? 'c' : 'w', conf: 0.9 })) }, cost: 0, seconds: 1 };
        return { json: { words: [1, 2, 3, 4].map((i) => ({ i, w: 'x', v: i === 2 ? 'wrong' : 'correct' })) }, cost: 0, seconds: 1 };
      },
    });
    const strip = (g) => { const m = { ...g.marks }; delete m.meta; return m; };
    const a = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 4), time_used_ms: 30000, stop_reason: 'complete' }), session(), d);
    const b = await score.scoreRow(row('en.letter_names5', { cells: cells('en.letter_names5', 5, { how: 'time_up', ms: 300 }), time_used_ms: 60000, stop_reason: 'time_up' }), session(), d);
    expect(strip(a)).toEqual(BEFORE.words);
    expect(strip(b)).toEqual(BEFORE.letters);
    // and with the switch ON too: a task that does not extend is not touched
    const c = await score.scoreRow(row('en.letter_names5', { cells: cells('en.letter_names5', 5, { how: 'time_up', ms: 300 }), time_used_ms: 60000, stop_reason: 'time_up' }), session(), { ...d, ceiling: true });
    expect(strip(c)).toEqual(BEFORE.letters);
  });
});

describe('the 500 ms final cell (C-7, red team C9)', () => {
  const run = async (ms, lastIndex) => {
    const d = deps({ tasks: [letters()] }, (i) => (i <= 12 ? 'correct' : 'skipped'));
    const res = { cells: cells('en.letter_names5', 12, { how: 'time_up', ms }), last_item_index: lastIndex, time_used_ms: 60000, stop_reason: 'time_up' };
    return { got: await score.scoreRow(row('en.letter_names5', res), session(), d), d, res };
  };
  test('300 ms on show at time up (the phone left it out of last_item_index): presented, not attempted', async () => {
    const { got, d, res } = await run(300, 10);
    expect(res.cells).toHaveLength(12);
    expect(got.marks.attempted).toBe(11);
    expect(got.marks.detail.of_all).toBe(11);
    expect(listed(d.prompts[0])).toBe(11);
    expect(got.marks.correct).toBe(11);
  });
  test('800 ms on show: attempted, the recording decides', async () => {
    const { got, d } = await run(800, 11);
    expect(got.marks.attempted).toBe(12);
    expect(listed(d.prompts[0])).toBe(12);
  });
  test('the first cell alone, 300 ms, time up: none attempted', async () => {
    const d = deps({ tasks: [letters()] }, () => 'skipped');
    const got = await score.scoreRow(row('en.letter_names5', { cells: cells('en.letter_names5', 1, { how: 'time_up', ms: 300 }), last_item_index: null, time_used_ms: 60000, stop_reason: 'time_up' }), session(), d);
    expect(got.marks.attempted).toBe(0);
    expect(got.marks.correct).toBe(0);
  });
});

describe('the first-line stop (C-12: ext_stop, only on a run past base_n) and seconds used (C-5)', () => {
  const EXT_STOP = { type: 'first_row', n: 10 };
  test('extended: 0 right in the first 10 letters, 3 right later → correct 0; attempted and seconds as run', async () => {
    const d = deps({ tasks: [letters({ extStop: EXT_STOP })] }, (i) => (i <= 10 ? 'wrong' : i <= 13 ? 'correct' : 'skipped'));
    const got = await score.scoreRow(row('en.letter_names5', { cells: cells('en.letter_names5', 13), last_item_index: 12, time_used_ms: 60000, stop_reason: 'time_up' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 0, attempted: 13, seconds_used: 60, per_minute: 0 });
    expect(got.marks.detail.stopped_by_rule).toBe(true);
    expect(got.marks.detail.correct_base).toBe(0);
  });
  test('a run inside today\'s 5 letters (every OFF run): ext_stop is not applied, the marks are today\'s', async () => {
    const d = deps({ tasks: [letters({ extStop: EXT_STOP })] }, () => 'wrong');
    const got = await score.scoreRow(row('en.letter_names5', { cells: cells('en.letter_names5', 5), last_item_index: 4, time_used_ms: 60000, stop_reason: 'time_up' }), session(), { ...d, stopRules: true });
    expect(got.marks).toMatchObject({ correct: 0, attempted: 5 });
    expect(got.marks.detail.stopped_by_rule).toBe(false);
    expect(listed(d.prompts[0])).toBe(5);
  });
  test('extended, 3 right in the first 10: not stopped', async () => {
    const d = deps({ tasks: [letters({ extStop: EXT_STOP })] }, (i) => (i <= 3 || i === 12 ? 'correct' : i <= 13 ? 'wrong' : 'skipped'));
    const got = await score.scoreRow(row('en.letter_names5', { cells: cells('en.letter_names5', 13), last_item_index: 12, time_used_ms: 60000, stop_reason: 'time_up' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 4, attempted: 13 });
    expect(got.marks.detail.stopped_by_rule).toBe(false);
  });
  test('ON: no time_used_ms → the rate is pending (no per_minute), never an assumed 60 s', async () => {
    const d = deps({ tasks: [words()] }, (i) => (i <= 8 ? 'correct' : 'skipped'), { ceiling: true });
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 8), last_item_index: 7, stop_reason: 'time_up' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 8, attempted: 8, per_minute: null, seconds_used: null });
    expect(got.marks.detail.rate_pending).toBe(true);
  });
  test('OFF: no time_used_ms → 60 s as today, and the marks say it was assumed', async () => {
    const d = deps({ tasks: [words()] }, (i) => (i <= 8 ? 'correct' : 'skipped'));
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 8), last_item_index: 7, stop_reason: 'time_up' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 8, per_minute: 8, seconds_used: 60 });
    expect(got.marks.detail.seconds_assumed).toBe(true);
  });
});

describe('spoken maths on an extended list (C-7 for ma.number_id8 / ma.fluency1m)', () => {
  test('one clip, 10 numbers reached of a 52-item list (base 8): the prompt lists the 10', async () => {
    const all = Array.from({ length: 52 }, (_, k) => ({ id: `ma.number_id8.${pad(k + 1)}`, show: String(k + 10), target: k + 10, answer: k + 10, src: `fixture:numbers[${k}]`, ...(k >= 8 ? { ext: true } : {}) }));
    const t = { id: 'ma.number_id8', w3: true, kind: 'oral', subtask: 'number_identification', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 5, stop: {}, items: all.slice(0, 8), base_n: 8, ext_items: all.slice(8) };
    const prompts = [];
    const d = { bank: null, phoneBattery: () => ({ tasks: [t] }), clipOf: async () => ({ base64: 'AAAA', durationSec: 60 }), model: () => 'test-model',
      chatJSON: async ({ prompt }) => { prompts.push(prompt); const n = (prompt.match(/^\d+: shown/gm) || []).length; return { json: { found: true, items: Array.from({ length: n }, (_, k) => ({ i: k + 1, heard: 'x', v: k < 10 ? 'c' : 's', conf: 0.9 })) }, cost: 0, seconds: 1 }; } };
    const got = await score.scoreRow({ ...row('ma.number_id8', { cells: cells('ma.number_id8', 10), last_item_index: 9, time_used_ms: 60000, stop_reason: 'time_up' }), lang: 'ur', block: 'ma.number_id8' }, session(), d);
    expect((prompts[0].match(/^\d+: shown/gm) || []).length).toBe(10);
    expect(got.marks).toMatchObject({ correct: 10, attempted: 10 });
    expect(got.marks.detail).toMatchObject({ of_all: 10, of_base: 8, correct_base: 8 });
  });
});

describe('sa_r8_counts with the extension (counts.js dedupe; score.js ranCounts)', () => {
  const spareTask = { id: 'en.words', items: [0, 1, 2, 3, 4].map((k) => ({ id: `en.words.${k}`, target: WORDS[k], src: `v3:sets.A.reading.en.words.items[${k}]` })) };
  /** words4 as the item bank commits it: the extension's first word (.05) IS the spare the counts plan adds (same src). */
  const committed = () => {
    const t = words();
    const src = (x, k) => ({ ...x, src: `v3:sets.A.reading.en.words.items[${k}]` });
    t.items = t.items.map(src);
    t.ext_items = t.ext_items.map((x, k) => src(x, k + 4));
    return t;
  };
  /** As the route serves it ON: items + ext_items, the grid rebuilt. */
  const served = () => { const t = committed(); const items = t.items.concat(t.ext_items); return { ...t, items, grid: items.map((x) => x.show) }; };
  test('served ON (the 5th word already there as ext .05): no duplicate .51, items as served', () => {
    const t = served();
    const out = countsTask({ tasks: [t, spareTask] }, t);
    expect(out.items).toHaveLength(50);
    expect(out.items.map((x) => x.id)).toEqual(t.items.map((x) => x.id));
    expect(new Set(out.items.map((x) => x.src)).size).toBe(50);
    expect(out.grid).toEqual(t.items.map((x) => x.show));
  });
  test('today\'s task (4 items): the 5th word is still added as .05', () => {
    const t = committed();
    const out = countsTask({ tasks: [t, spareTask] }, t);
    expect(out.items.map((x) => x.id)).toEqual(['en.words4.01', 'en.words4.02', 'en.words4.03', 'en.words4.04', 'en.words4.05']);
    expect(out.items[4].show).toBe(WORDS[4]);
  });
  test('an ON run of 12 cells: every cell item_id resolves in the extended list, no id twice, the counts form not used', () => {
    const got = score.phoneSpecFor(session(), row('en.words4', { cells: cells('en.words4', 12) }), () => ({ tasks: [committed(), spareTask] }));
    const ids = got.spec.record.items.map((x) => x.id);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    cells('en.words4', 12).forEach((c) => expect(ids).toContain(c.item_id));
    expect(got.spec.record.base_n).toBe(4);
    expect(got.spec.record.items[4].ext).toBe(true);
  });
  test('counts ON, ceiling OFF: a run of 5 cells is today\'s counts form (5 words), not the extension', () => {
    const got = score.phoneSpecFor(session(), row('en.words4', { cells: cells('en.words4', 5) }), () => ({ tasks: [committed(), spareTask] }));
    expect(got.spec.record.items).toHaveLength(5);
    expect(got.spec.record).not.toHaveProperty('base_n');
    expect(got.spec.record.stop).toEqual({});
  });
});

describe('level.js: the ladder on the first N (C-8), the new parts (A.7 #8, B.7 #6, C.5 #4)', () => {
  const spoken = (block, marks) => ({ block, response_mode: 'record', ai_status: 'scored', ai_marks: marks, responses: [{ kind: 'result', mode: 'record', stop_reason: 'time_up' }] });
  const tap = (block, correct, attempted) => ({ block, response_mode: 'tap', ai_status: 'pending', ai_marks: null, responses: [{ kind: 'result', mode: 'tap', correct, attempted, stop_reason: 'complete' }] });
  const ext = (correct, attempted, correctBase, ofBase) => ({ correct, attempted, detail: { kind: 'grid', of_all: attempted, of_base: ofBase, correct_base: correctBase, items: Array.from({ length: attempted }, (_, i) => ({ i: i + 1 })) } });
  const ITEMS = { 'ur.letter_names5': 5, 'ur.letter_pick10': 10, 'ur.words4': 4, 'ur.story_mcq_w3': 6, 'ur.story_comp_w3': 6 };
  const opts = { itemsOf: (id) => ITEMS[id] ?? null };
  const ur = (rows) => level.levelsOf(rows, [], opts).find((x) => x.subject === 'ur');

  test('C.5 #4: 5/5 base letters and 7/12 overall meets the letters rung', () => {
    expect(ur([spoken('ur.letter_names5', ext(7, 12, 5, 5))]).level).toBe('letters');
  });
  test('C.5 #4: 3/5 base letters and 20/30 overall does not', () => {
    expect(ur([spoken('ur.letter_names5', ext(20, 30, 3, 5))]).level).toBe('beginner');
  });
  test('words read on the first 4: 3/4 base meets the words rung even with 10/40 overall', () => {
    expect(ur([spoken('ur.letter_names5', ext(5, 5, 5, 5)), spoken('ur.words4', ext(10, 40, 3, 4))]).level).toBe('words');
  });
  test('A.7 #8: letter_pick10 8/10 meets the letters rung; 7/10 does not', () => {
    expect(ur([tap('ur.letter_pick10', 8, 10)]).level).toBe('letters');
    expect(ur([tap('ur.letter_pick10', 7, 10)]).level).toBe('beginner');
  });
  test('B.7 #6: the MCQ part pools over its 6 (unasked = 0): 3 asked, 2 right is unmet; 4 of 6 meets (two thirds, compared exactly)', () => {
    const upTo = (rows) => [spoken('ur.letter_names5', ext(5, 5, 5, 5)), spoken('ur.words4', ext(4, 4, 4, 4)), spoken('ur.story_w3', { correct: 30, attempted: 32 }), ...rows];
    expect(ur(upTo([tap('ur.story_mcq_w3', 2, 3)])).level).toBe('story');
    expect(ur(upTo([tap('ur.story_mcq_w3', 4, 6)])).level).toBe('comprehension');
    expect(ur(upTo([tap('ur.story_mcq_w3', 3, 6)])).level).toBe('story');
  });
  test('the picker is read on what was presented: 8 of 9 presented meets 0.8, 7 of 9 does not', () => {
    const tapP = (block, correct, attempted, presented) => ({ ...tap(block, correct, attempted), responses: [{ kind: 'result', mode: 'tap', correct, attempted, presented, stop_reason: 'complete' }] });
    expect(ur([tapP('ur.letter_pick10', 8, 9, 9)]).level).toBe('letters');
    expect(ur([tapP('ur.letter_pick10', 7, 9, Array.from({ length: 9 }, (_, i) => `p${i}`))]).level).toBe('beginner');
  });
  // SPEC v2.1 (B.5): the MCQ part is read as correct of (6 − questions whose clip was lost); a question the reading gate
  // did not ask counts as wrong, as the oral part today. The result row carries asked[], unavailable and of_all 6.
  const mcq = ({ asked, lost = 0, right }) => ({
    block: 'ur.story_mcq_w3', response_mode: 'tap', ai_status: 'pending', ai_marks: null,
    responses: [{ kind: 'result', mode: 'tap', correct: right, attempted: asked - lost, asked: Array.from({ length: asked - lost }, (_, i) => `ur.story_w3.q${i + 1}`), presented: asked - lost, ...(lost ? { unavailable: lost } : {}), of_all: 6, stop_reason: 'complete' }],
  });
  const toStory = (rows) => [spoken('ur.letter_names5', ext(5, 5, 5, 5)), spoken('ur.words4', ext(4, 4, 4, 4)), spoken('ur.story_w3', { correct: 30, attempted: 32 }), ...rows];
  test('B.7.6: a session with 3 asked and 2 right at share 0.67 is unmet', () => {
    expect(ur(toStory([mcq({ asked: 3, right: 2 })])).level).toBe('story');
  });
  test('6 asked, 1 lost, 4 right → 4 of 5 → met', () => {
    expect(ur(toStory([mcq({ asked: 6, lost: 1, right: 4 })])).level).toBe('comprehension');
  });
  test('3 asked, 0 lost, 2 right → 2 of 6 → unmet', () => {
    expect(ur(toStory([mcq({ asked: 3, lost: 0, right: 2 })]))).toMatchObject({ level: 'story', pending: false });
  });
  test('4 asked of 6, 4 right → 4 of 6 → met (two thirds, compared exactly)', () => {
    expect(ur(toStory([mcq({ asked: 4, right: 4 })])).level).toBe('comprehension');
  });
  test('unrated is absent, not pending: letter names 2 of 5 + an unrated picker → letters rung unmet, pending false', () => {
    const tapU = (block, correct, attempted) => ({ ...tap(block, correct, attempted), responses: [{ kind: 'result', mode: 'tap', correct, attempted, presented: 3, unavailable: 7, unrated: true, stop_reason: 'complete' }] });
    const line = ur([spoken('ur.letter_names5', ext(2, 5, 2, 5)), tapU('ur.letter_pick10', 3, 3)]);
    expect(line).toMatchObject({ level: 'beginner', pending: false });
    expect(line).not.toHaveProperty('unrated');
  });
  test('a subject whose rung parts are all unrated: level null, not pending, unrated true', () => {
    const tapU = (block) => ({ ...tap(block, 2, 2), responses: [{ kind: 'result', mode: 'tap', correct: 2, attempted: 2, presented: 2, unavailable: 8, unrated: true, stop_reason: 'complete' }] });
    expect(ur([tapU('ur.letter_pick10')])).toEqual({ subject: 'ur', reached: { taskId: 'ur.letter_pick10', title: null }, level: null, pending: false, stop: null, unrated: true });
  });
  test('the oral comprehension part keeps its share of a half', () => {
    const upTo = (rows) => [spoken('ur.letter_names5', ext(5, 5, 5, 5)), spoken('ur.words4', ext(4, 4, 4, 4)), spoken('ur.story_w3', { correct: 30, attempted: 32 }), ...rows];
    expect(ur(upTo([spoken('ur.story_comp_w3', { correct: 3, of: 6, detail: { kind: 'questions' } })])).level).toBe('comprehension');
  });
});

describe('levelReader.itemsOf: base items only (sa-api)', () => {
  test('an extended letters task of 100 items reads as 5: 4 of 5 (no item count from the scorer) meets the letters rung', async () => {
    const SID = 'cccccccc-0000-4000-8000-0000000000c8';
    const COACH = 'aaaaaaaa-0000-4000-8000-0000000000c8';
    const t = { ...letters(), items: letters().items };
    const rows = [{ session_id: SID, block: 'ur.letter_names5', response_mode: 'record', lang: 'ur', created_at: '2026-11-17T05:01:00Z', ai_status: 'scored', ai_reason: null,
      ai_marks: { correct: 4, attempted: 9, detail: { kind: 'grid' } }, responses: [{ kind: 'result', mode: 'record', stop_reason: 'time_up' }] }];
    const sessions = { [SID]: { id: SID, coach_user_id: COACH, student_id: 'st-1', draw_id: 'd-1', school_id: 'sch-1', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-11-17T05:00:00Z', finished_at: '2026-11-17T05:30:00Z', device: { block: 'rdf_auto' } } };
    const world = {
      enabled: async () => true, practiceSwitch: false, supabase: { from: () => { throw new Error('no direct reads'); } },
      store: { getSession: async (id) => ({ ok: true, session: sessions[id] || null }), listBlocks: async () => ({ ok: true, blocks: rows }), listSaSessions: async () => ({ ok: true, sessions: Object.values(sessions) }), listBlocksForSessions: async () => ({ ok: true, blocks: rows }), getSchoolsByIds: async () => ({ ok: true, schools: [] }) },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
      bank: null, stopRules: false, hidePractice: false, dashFilters: false, r20Level: true,
      phoneBattery: () => ({ tasks: [{ ...t, id: 'ur.letter_names5' }] }),
      now: () => new Date('2026-11-17T06:00:00Z'), log: () => {}, logError: () => {},
    };
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world);
    expect(out.levels.find((x) => x.subject === 'ur').level).toBe('letters');
  });
});

describe('C-5 on every timed task (SPEC v2.1): with sa_r28_ceiling ON no clock means no rate', () => {
  test('ON: a run that stopped inside today\'s items, no time_used_ms → pending', async () => {
    const d = deps({ tasks: [words()] }, (i) => (i <= 3 ? 'correct' : 'skipped'), { ceiling: true });
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 3), last_item_index: 2, stop_reason: 'early_stop_silence' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 3, attempted: 3, per_minute: null, seconds_used: null });
    expect(got.marks.detail.rate_pending).toBe(true);
  });
  test('ON: a task that does not extend at all, time_used_ms 0 → pending', async () => {
    const plain = { ...words() };
    delete plain.base_n; delete plain.ext_items;
    const d = deps({ tasks: [plain] }, () => 'correct', { ceiling: true });
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 4), last_item_index: 3, time_used_ms: 0, stop_reason: 'complete' }), session(), d);
    expect(got.marks).toMatchObject({ per_minute: null, seconds_used: null });
    expect(got.marks.detail.rate_pending).toBe(true);
  });
  test('ON: the story passage with no clock → pending', async () => {
    const W = ['a', 'cat', 'sat', 'on', 'the', 'mat'];
    const story = { id: 'en.story_w3', w3: true, kind: 'passage', subtask: 'oral_reading_fluency', lang: 'en', response: 'record', time_limit_s: 60, stop: {},
      passage: { text: W.join(' ') }, items: W.map((w, k) => ({ id: `en.story_w3.w${k + 1}`, target: w, line: 1 })) };
    const d = deps({ tasks: [story] }, () => 'correct', { ceiling: true });
    const got = await score.scoreRow(row('en.story_w3', { last_word_index: 5, stop_reason: 'complete' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 6, per_minute: null, seconds_used: null });
    expect(got.marks.detail.rate_pending).toBe(true);
  });
  test('OFF: the same no-clock run inside today\'s items keeps today\'s 60 s and says it was assumed', async () => {
    const d = deps({ tasks: [words()] }, (i) => (i <= 3 ? 'correct' : 'skipped'));
    const got = await score.scoreRow(row('en.words4', { cells: cells('en.words4', 3), last_item_index: 2, stop_reason: 'early_stop_silence' }), session(), d);
    expect(got.marks).toMatchObject({ correct: 3, per_minute: 3, seconds_used: 60 });
    expect(got.marks.detail.seconds_assumed).toBe(true);
    expect(got.marks.detail).not.toHaveProperty('rate_pending');
  });
});
