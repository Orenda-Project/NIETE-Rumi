'use strict';
/**
 * sa_r28_story_minute (app_settings, default OFF): the story's reading rate is words correct per MINUTE. A child alone
 * at the phone can tap "done" after a line or two, and the rate was taken over the seconds the phone's clock ran, so
 * 11 words in 8.8 s read as 75 a minute. ON, the story's seconds are less than 60 only when the child reached the
 * passage's LAST PRINTED LINE: the scorer's attempted count is at least L, or the phone's last-word index is at least
 * L - 1 (0-based), where L is the first word (1-based) of the variant's last line, read from that variant's own line
 * table. Otherwise the rate uses the full minute, as a trained assessor's timer would. A time-up run, a first-line stop
 * and a run without the phone's clock are scored as before. Every scored story row says which rule its rate used
 * (detail.minute: 'last_line_reached' | 'full_60'); OFF, the marks are exactly as before and carry no such key.
 * The scorer's real path runs (battery task, prompt, rows, numbers, marks); only the clip and the model are stand-ins,
 * and every passage is synthetic apart from the line tables, which are read from the shipped batteries.
 */
jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));
const score = require('../../shared/services/child-test/sa/score');
// read lazily, so every scoring row above runs (and fails on its own assertion) before the module exists
const switchModule = () => require('../../shared/services/child-test/app/story-minute-switch'); // eslint-disable-line global-require

/** A line table from a shipped phone battery: the task's own, or one of its variants'. */
function linesOf(file, taskId, variantId = null) {
  const b = require(`../../shared/data/child-test/sa/${file}`); // eslint-disable-line global-require
  const t = b.tasks.find((x) => x.id === taskId);
  const p = variantId ? t.variants.find((v) => v.id === variantId).passage : t.passage;
  return p.lines.map((l) => ({ ...l }));
}
const EN_W3 = linesOf('sa.coach.G3.A.en.json', 'en.story_w3');
const EN_OTHER = linesOf('sa.coach.G3.A.en.json', 'en.story', 'tk2009');
const UR_W3 = linesOf('sa.coach.G3.A.ur.json', 'ur.story_w3');
// a fixture variant whose last line starts at word 45 (1-based), not 56
const SHORT_LAST = [{ n: 1, from: 0, to: 9 }, { n: 2, from: 10, to: 21 }, { n: 3, from: 22, to: 31 }, { n: 4, from: 32, to: 43 }, { n: 5, from: 44, to: 59 }];

const WORDS = Array.from({ length: 60 }, (_, k) => `w${k + 1}`);
function story(lines = EN_W3, { id = 'en.story_w3', lang = 'en' } = {}) {
  return {
    id, w3: true, kind: 'passage', subtask: 'oral_reading_fluency', lang, response: 'record', time_limit_s: 60, stop: {},
    passage: { text: WORDS.join(' '), lines, print_lines: lines.map((l) => WORDS.slice(l.from, l.to + 1).join(' ')) },
    items: WORDS.map((w, k) => ({ id: `${id}.w${k + 1}`, target: w })),
  };
}
const session = () => ({ id: 's1', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed' });
const row = (res, block = 'en.story_w3') => ({ id: `row-${block}`, session_id: 's1', block, lang: block.slice(0, 2), response_mode: 'record', audio_r2_key: 'k', audio_r2_keys: null, responses: [{ kind: 'result', mode: 'record', session_id: 'p1', ...res }] });

/** verdict(i): what the stand-in model says for word i (1-based). */
function deps(task, verdict, extra = {}) {
  return {
    bank: null,
    phoneBattery: () => ({ tasks: [task] }),
    clipOf: async () => ({ base64: 'AAAA', durationSec: 60 }),
    model: () => 'test-model',
    chatJSON: async () => ({ json: { words: WORDS.map((_, k) => ({ i: k + 1, w: 'x', v: verdict(k + 1) })) }, cost: 0, seconds: 1 }),
    ...extra,
  };
}
const upTo = (n, right = n) => (i) => (i <= right ? 'correct' : i <= n ? 'wrong' : 'skipped');
const run = (res, verdict, extra = {}, task = story()) => score.scoreRow(row(res, task.id), session(), deps(task, verdict, extra));
const ON = { storyMinute: true };
/** The marks without the wall-clock seconds the scorer spent (the only field that may differ between two runs). */
const still = (m) => { const c = JSON.parse(JSON.stringify(m)); delete c.meta.seconds; return c; };

describe('the story minute: a run that stopped before the last line is rated on the full minute', () => {
  test('(a) complete after 8,813 ms with 11 of 60 attempted, all right: 11 a minute, stamped full_60', async () => {
    const got = await run({ time_used_ms: 8813, stop_reason: 'complete', last_word_index: 10 }, upTo(11), ON);
    expect(got.marks).toMatchObject({ correct: 11, attempted: 11, per_minute: 11, seconds_used: 60 });
    expect(got.marks.detail.minute).toBe('full_60');
  });

  test('(b) complete after 40 s with all 60 attempted: the rate is correct x 1.5, stamped last_line_reached', async () => {
    const got = await run({ time_used_ms: 40000, stop_reason: 'complete', last_word_index: 59 }, upTo(60, 50), ON);
    expect(got.marks).toMatchObject({ correct: 50, attempted: 60, per_minute: 75, seconds_used: 40 });
    expect(got.marks.detail.minute).toBe('last_line_reached');
  });

  test('(c) attempted 56 (the first word of the last line) is shortened; attempted 55 is rated on 60', async () => {
    const at56 = await run({ time_used_ms: 40000, stop_reason: 'complete', last_word_index: 55 }, upTo(56), ON);
    expect(at56.marks).toMatchObject({ correct: 56, attempted: 56, per_minute: 84, seconds_used: 40 });
    expect(at56.marks.detail.minute).toBe('last_line_reached');
    const at55 = await run({ time_used_ms: 40000, stop_reason: 'complete', last_word_index: 54 }, upTo(55), ON);
    expect(at55.marks).toMatchObject({ correct: 55, attempted: 55, per_minute: 55, seconds_used: 60 });
    expect(at55.marks.detail.minute).toBe('full_60');
  });

  test('(d) a time-up run keeps the phone clock exactly as before; a first-line stop is unchanged and unstamped', async () => {
    const res = { time_used_ms: 59000, stop_reason: 'time_up', last_word_index: 29 };
    const off = await run(res, upTo(30));
    const on = await run(res, upTo(30), ON);
    expect(on.marks).toMatchObject({ correct: 30, attempted: 30, per_minute: 30.5, seconds_used: 59 });
    expect(on.marks.per_minute).toBe(off.marks.per_minute);
    expect(on.marks.seconds_used).toBe(off.marks.seconds_used);
    expect(on.marks.detail.minute).toBe('full_60');
    const first = { time_used_ms: 12000, stop_reason: 'early_stop_first_line', last_word_index: 5 };
    const fOff = await run(first, upTo(6, 0));
    const fOn = await run(first, upTo(6, 0), ON);
    expect(still(fOn.marks)).toEqual(still(fOff.marks));
    expect(fOn.marks).toMatchObject({ correct: 0, attempted: 6, per_minute: 0, seconds_used: 12 });
    expect(fOn.marks.detail).not.toHaveProperty('minute');
  });

  test('(e) OFF: today\'s numbers byte for byte, no stamp, whether the switch is absent or false', async () => {
    const cases = [
      [{ time_used_ms: 8813, stop_reason: 'complete', last_word_index: 10 }, upTo(11), { correct: 11, attempted: 11, per_minute: 74.9, seconds_used: 8.8 }],
      [{ time_used_ms: 40000, stop_reason: 'complete', last_word_index: 54 }, upTo(55), { correct: 55, attempted: 55, per_minute: 82.5, seconds_used: 40 }],
      [{ time_used_ms: 40000, stop_reason: 'complete', last_word_index: 59 }, upTo(60, 50), { correct: 50, attempted: 60, per_minute: 75, seconds_used: 40 }],
      [{ time_used_ms: 30000, stop_reason: 'early_stop_silence', last_word_index: 19 }, upTo(20), { correct: 20, attempted: 20, per_minute: 40, seconds_used: 30 }],
    ];
    for (const [res, verdict, today] of cases) {
      const absent = await run(res, verdict);
      const off = await run(res, verdict, { storyMinute: false });
      expect(absent.marks).toMatchObject(today);
      expect(still(off.marks)).toEqual(still(absent.marks));
      expect(absent.marks.detail).not.toHaveProperty('minute');
      // ON changes only the rate, the seconds and the stamp; every other field is the same
      const on = await run(res, verdict, ON);
      const strip = (m) => { const c = still(m); delete c.per_minute; delete c.seconds_used; delete c.detail.minute; return c; };
      expect(strip(on.marks)).toEqual(strip(absent.marks));
    }
  });

  test('(f) the phone\'s last-word index 55 reaches the last line although the recording heard only 50: shortened', async () => {
    const res = { time_used_ms: 40000, stop_reason: 'complete', last_word_index: 55, last_word_how: 'tap' };
    const got = await run(res, upTo(50), ON);
    expect(got.marks).toMatchObject({ correct: 50, attempted: 50, per_minute: 75, seconds_used: 40 });
    expect(got.marks.detail).toMatchObject({ last_word_tapped: 56, last_word_source: 'recording', minute: 'last_line_reached' });
    const short = await run({ ...res, last_word_index: 54 }, upTo(50), ON);
    expect(short.marks).toMatchObject({ per_minute: 50, seconds_used: 60 });
    expect(short.marks.detail.minute).toBe('full_60');
  });

  test('(g) no clock: pending with the ceiling ON, the assumed minute with it OFF, exactly as before and unstamped', async () => {
    const res = { stop_reason: 'complete', last_word_index: 10 };
    const pendOff = await run(res, upTo(11), { ceiling: true });
    const pendOn = await run(res, upTo(11), { ceiling: true, storyMinute: true });
    expect(pendOn.marks).toMatchObject({ correct: 11, per_minute: null, seconds_used: null });
    expect(pendOn.marks.detail.rate_pending).toBe(true);
    expect(still(pendOn.marks)).toEqual(still(pendOff.marks));
    expect(pendOn.marks.detail).not.toHaveProperty('minute');
    const assumedOff = await run(res, upTo(11));
    const assumedOn = await run(res, upTo(11), ON);
    expect(assumedOn.marks).toMatchObject({ per_minute: 11, seconds_used: 60 });
    expect(assumedOn.marks.detail.seconds_assumed).toBe(true);
    expect(still(assumedOn.marks)).toEqual(still(assumedOff.marks));
  });

  test('(h) L follows each variant\'s own line table: the shipped tables, and a fixture whose last line starts at word 45', async () => {
    // the shipped tables: both w3 passages' last lines start at word 56; another shipped variant's at word 57
    expect(EN_W3[EN_W3.length - 1].from + 1).toBe(56);
    expect(UR_W3[UR_W3.length - 1].from + 1).toBe(56);
    expect(EN_OTHER[EN_OTHER.length - 1].from + 1).toBe(57);
    const at = async (lines, n, opts) => (await run({ time_used_ms: 40000, stop_reason: 'complete', last_word_index: n - 1 }, upTo(n), ON, story(lines, opts))).marks;
    expect(await at(UR_W3, 56, { id: 'ur.story_w3', lang: 'ur' })).toMatchObject({ seconds_used: 40, detail: { minute: 'last_line_reached' } });
    expect(await at(UR_W3, 55, { id: 'ur.story_w3', lang: 'ur' })).toMatchObject({ seconds_used: 60, detail: { minute: 'full_60' } });
    expect(await at(EN_OTHER, 56)).toMatchObject({ seconds_used: 60, per_minute: 56, detail: { minute: 'full_60' } });
    expect(await at(EN_OTHER, 57)).toMatchObject({ seconds_used: 40, per_minute: 85.5, detail: { minute: 'last_line_reached' } });
    expect(await at(SHORT_LAST, 45)).toMatchObject({ seconds_used: 40, per_minute: 67.5, detail: { minute: 'last_line_reached' } });
    expect(await at(SHORT_LAST, 44)).toMatchObject({ seconds_used: 60, per_minute: 44, detail: { minute: 'full_60' } });
  });

  test('the other timed tasks are untouched: a words grid run short is rated on its own clock with the switch ON', async () => {
    const items = ['go', 'sad', 'cat', 'big'].map((w, k) => ({ id: `en.words4.0${k + 1}`, show: w, target: w, answer: w }));
    const grid = { id: 'en.words4', w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, stop: {}, items, grid: items.map((x) => x.show) };
    const d = {
      ...deps(grid, () => 'correct', ON),
      chatJSON: async () => ({ json: { words: items.map((_, k) => ({ i: k + 1, w: 'x', v: 'correct' })) }, cost: 0, seconds: 1 }),
    };
    const cells = items.map((x, i) => ({ i, item_id: x.id, at_ms: i * 2000, ms: 2000, how: 'tap' }));
    const got = await score.scoreRow(row({ cells, last_item_index: 3, time_used_ms: 8000, stop_reason: 'complete' }, 'en.words4'), session(), d);
    expect(got.marks).toMatchObject({ correct: 4, per_minute: 30, seconds_used: 8 });
    expect(got.marks.detail).not.toHaveProperty('minute');
  });
});

describe('the sweep reads app_settings sa_r28_story_minute and hands it to the scorer', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; delete process.env.CHILD_TEST_SA_SPEECH_GATE; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  const SID = 'eeeeeeee-0000-4000-8000-000000000089';
  const sweepSession = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
  const sweepRow = () => ({
    id: 'row-en.story_w3', session_id: SID, block: 'en.story_w3', ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null,
    audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/en.story_w3.webm`, audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z', lang: 'en', response_mode: 'record',
    responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 8813, stop_reason: 'complete', last_word_index: 10 }],
  });
  function fakeDb(tables) {
    function query(name) {
      const f = []; let patch = null; let lim = null;
      const q = {
        select() { return q; }, order() { return q; }, in() { return q; },
        limit(n) { lim = n; return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
        like(c, v) { const pre = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(pre)); return q; },
        gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
        update(x) { patch = x; return q; },
        then(ok, bad) {
          try {
            const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
            if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
            const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
            return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
          } catch (e) { return Promise.reject(e).then(ok, bad); }
        },
      };
      return q;
    }
    return { from: query };
  }

  test('setting true: the early "done" is rated on the full minute and stamped', async () => {
    const r = sweepRow();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [sweepSession()], app_settings: [{ key: 'sa_r28_story_minute', value: true }] });
    const { bank, ...d } = deps(story(), upTo(11)); // eslint-disable-line no-unused-vars
    const out = await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...d } });
    expect(out).toMatchObject({ found: 1, scored: 1 });
    expect(r.ai_marks).toMatchObject({ task: 'en.story_w3', correct: 11, per_minute: 11, seconds_used: 60 });
    expect(r.ai_marks.detail.minute).toBe('full_60');
  });
});

describe('the switch module (app_settings sa_r28_story_minute)', () => {
  let storyMinute;
  beforeAll(() => { storyMinute = switchModule(); });
  test("a test's storyMinute wins; only JSON true is on", async () => {
    expect(storyMinute.KEY).toBe('sa_r28_story_minute');
    expect(await storyMinute.enabled({ storyMinute: true })).toBe(true);
    expect(await storyMinute.enabled({ storyMinute: false })).toBe(false);
    expect(await storyMinute.enabled({ storyMinute: 'true' })).toBe(false);
    expect(await storyMinute.enabled({ storyMinute: async () => true })).toBe(true);
  });

  test('the setting: JSON true is on; no row, another value or a read error is off (fails closed)', async () => {
    const client = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }) });
    expect(await storyMinute.on(1e12, client([{ key: 'sa_r28_story_minute', value: true }]))).toBe(true);
    expect(await storyMinute.on(2e12, client([]))).toBe(false);
    expect(await storyMinute.on(3e12, client([{ key: 'sa_r28_story_minute', value: 'yes' }]))).toBe(false);
    expect(await storyMinute.on(4e12, client(null, { message: 'down' }))).toBe(false);
  });
});
