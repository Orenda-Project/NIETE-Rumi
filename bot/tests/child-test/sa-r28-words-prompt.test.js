'use strict';

/**
 * sa_r28_words_prompt (app_settings, default OFF): the familiar-word tasks were scored with the 60-second PASSAGE prompt
 * (prompts.STORY), although the phone shows the words ONE AT A TIME. ON, they get a prompt of their own (the letters card
 * shape, one numbered word per line, the model answering per position) with EGRA's accent rule, and an item's accepted
 * forms beside its word. The speech gate, the rows, the rate and the first-row stop are unchanged. Only the clip,
 * speech-to-text and the model are stand-ins. Every fixture is synthetic.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');
// required inside its own test, so the other tests run (and fail on their own lines) before the module exists
const switchModule = () => require('../../shared/services/child-test/app/words-prompt-switch'); // eslint-disable-line global-require

const SID = 'eeeeeeee-0000-4000-8000-000000000052';
const KEY = (t) => `child-test/sandbox/sch-1/${SID}/sa/${t}.webm`;
const ACCENT = 'A local accent or regional pronunciation that keeps it the same word is correct (the accepted forms listed with each word count as that word); a change that makes a different word, or a letter name, is wrong.';

const item = (task, k, show, accept) => ({ id: `${task}.0${k + 1}`, show, target: show, answer: show, src: 'synthetic', ...(accept ? { accept } : {}) });
const words = (id, shows, accepts = []) => ({
  id, w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: id.slice(0, 2), response: 'record', present: 'one_at_a_time',
  time_limit_s: 60, stop: {}, grid: shows, items: shows.map((s, k) => item(id, k, s, accepts[k])),
});
const BATTERY = {
  tasks: [
    words('en.words4', ['sad', 'find', 'come', 'up']),
    words('ur.words4', ['بچہ', 'دروازہ', 'پانی', 'کتاب']),
    // the next bank PR's accept lists (local forms of the same word)
    words('en.words4a', ['sad', 'find', 'come', 'up'], [['said', 'sed'], ['fine', 'fide'], null, []]),
  ],
};

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = (block) => ({
  id: `row-${block}`, session_id: SID, block, response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY(block), audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z', lang: block.slice(0, 2),
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 30000 }],
});

// the same verdicts both ways: sad correct, find wrong, come correct, up not reached
const SAME = ['c', 'w', 'c', 's'];
const STORY_V = { c: 'correct', w: 'wrong', s: 'skipped' };
function standIns({ words: heardWords = 5, v = SAME } = {}) {
  const prompts = []; const stt = [];
  return {
    prompts, stt,
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 30, key }),
    speechOf: async (c, lang) => { stt.push(lang); return { words: heardWords, text: heardWords ? 'x' : '', model: 'stt:test', cost: 0.003, seconds: 1 }; },
    model: () => 'model:test',
    chatJSON: async ({ prompt, job, schema }) => {
      prompts.push({ prompt, job, schema: schema && schema.name });
      if (/reading aloud from a printed/.test(prompt)) {
        return { json: { words: v.map((x, k) => ({ i: k + 1, w: 'x', v: STORY_V[x] })), words_correct: 2, words_attempted: 3, notes: '' }, cost: 0.001, seconds: 1 };
      }
      return { json: { found: true, last_attempted: 3, letters_correct: 2, items: v.map((x, k) => ({ i: k + 1, heard: x === 's' ? '' : `h${k + 1}`, v: x, conf: 0.9 })) }, cost: 0.001, seconds: 1 };
    },
  };
}
const verdicts = (got) => got.marks.detail.items.map((i) => i.verdict);
const ON = (s) => ({ ...s, wordsPrompt: true });

// prompts.STORY for en.words4 at the sandbox head (the OFF prompt, byte for byte)
const OFF_EN_WORDS = 'A child in a Pakistani government school (grade 1-5) is reading aloud from a printed English text for 60 seconds. The exact printed text, word by word, is:\n1:sad 2:find 3:come 4:up\nJudge every word of the printed text in order. For each word say whether the child read it CORRECTLY (an acceptable pronunciation of that word), read it WRONG (said a different word or a mispronunciation that changes the word), or SKIPPED it (never attempted, including everything after the child stopped). Self-corrections count as correct. Do not invent words the child did not say. Return ONLY JSON:\n{"words":[{"i":1,"w":"<word>","v":"correct|wrong|skipped"}, ...], "words_correct": <int>, "words_attempted": <int>, "notes":"<one line>"}';
// prompt C as shipped, English, no accept lists
const ON_EN_WORDS = 'A child in a Pakistani government school (grade 3) is doing the timed English FAMILIAR WORDS task of an EGRA reading test on a phone, wearing headphones. The phone showed 4 separate words ONE AT A TIME, in this order, each for a few seconds (a word list, not a story), and recorded the child reading each word aloud. The phone\'s own voice may be faintly heard; ignore it.\nMarking rules: a word is correct if the child says that word. ' + ACCENT + ' A self-correction counts as correct. A different word, a sounded-out word never put together, or a word passed over while the child keeps going is WRONG. Every position after the last word the child reached is SKIPPED.\nThe printed words in order (position: word):\n1: sad\n2: find\n3: come\n4: up\nFor EVERY position 1-4 return v = "c" (correct), "w" (wrong) or "s" (skipped / not reached), heard = what the child said for that word ("" if skipped), and conf = your confidence 0-1.\nReturn ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}';

describe('sa_r28_words_prompt: the familiar-word tasks get a prompt of their own', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  test('OFF (absent / false / 1): the STORY prompt byte for byte, the same marks, no new keys', async () => {
    const outs = [];
    for (const over of [{}, { wordsPrompt: false }, { wordsPrompt: 1 }, { wordsPrompt: 'true' }]) {
      const s = { ...standIns(), ...over };
      const got = await score.scoreRow(row('en.words4'), session(), s);
      expect(got.ok).toBe(true);
      expect(s.prompts.map((x) => x.job)).toEqual(['child_test.sa_words']);
      expect(s.prompts[0].prompt).toBe(OFF_EN_WORDS);
      expect(got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_words').every((c) => !('prompt' in c))).toBe(true);
      outs.push(got.marks);
    }
    const strip = (m) => JSON.parse(JSON.stringify(m, (k, v) => (['seconds', 'scored_at', 'at', 'ms'].includes(k) ? undefined : v)));
    outs.slice(1).forEach((m) => expect(strip(m)).toEqual(strip(outs[0])));
    expect(outs[0].detail.items.map((i) => [i.verdict, i.heard, i.conf])).toEqual([['correct', '', null], ['wrong', '', null], ['correct', '', null], ['not_reached', '', null]]);
  });

  test('ON: the prompt is prompt C: the signed accent sentence, one numbered word per line, no passage framing', async () => {
    const s = ON(standIns());
    await score.scoreRow(row('en.words4'), session(), s);
    expect(s.prompts).toHaveLength(1);
    const { prompt, job, schema } = s.prompts[0];
    expect(job).toBe('child_test.sa_words');
    expect(schema).toBe('sa_letters');
    expect(prompt).toContain(ACCENT);
    expect(prompt).toContain('\n1: sad\n2: find\n3: come\n4: up\n');
    expect(prompt).not.toMatch(/reading aloud from a printed|text for 60 seconds|passage/);
    expect(prompt).toBe(ON_EN_WORDS);
  });

  test('ON: the per-position answers become the rows; same verdicts -> same correct, attempted and rate as OFF', async () => {
    const off = await score.scoreRow(row('en.words4'), session(), standIns());
    const on = await score.scoreRow(row('en.words4'), session(), ON(standIns()));
    expect(verdicts(on)).toEqual(verdicts(off));
    expect(verdicts(on)).toEqual(['correct', 'wrong', 'correct', 'not_reached']);
    for (const k of ['correct', 'attempted', 'per_minute', 'seconds_used']) expect(on.marks[k]).toEqual(off.marks[k]);
    expect(on.marks.correct).toBe(2);
    expect(on.marks.attempted).toBe(3);
    expect(on.marks.detail.items.map((i) => [i.heard, i.conf])).toEqual([['h1', 0.9], ['h2', 0.9], ['h3', 0.9], ['', 0.9]]);
    // the call record carries the prompt's name so the cost / precision tables can split it
    const words = on.marks.meta.calls.filter((c) => c.job === 'child_test.sa_words');
    expect(words).toHaveLength(1);
    expect(words[0].prompt).toBe('words_c');
  });

  test('ON: a gap before the last reached word is wrong, as today (timedRows unchanged)', async () => {
    const on = await score.scoreRow(row('en.words4'), session(), ON(standIns({ v: ['c', 's', 'c', 's'] })));
    expect(verdicts(on)).toEqual(['correct', 'wrong', 'correct', 'not_reached']);
  });

  test('ON with accept lists: the card shows "(also: ...)" beside the word; an item without one shows nothing extra', async () => {
    const s = ON(standIns());
    await score.scoreRow(row('en.words4a'), session(), s);
    expect(s.prompts[0].prompt).toContain('\n1: sad (also: said, sed)\n2: find (also: fine, fide)\n3: come\n4: up\n');
    const p = score.__internals.wordsPrompt;
    expect(p({ grade: 3, lang: 'en', items: ['sad', 'find', 'come', 'up'] })).toBe(ON_EN_WORDS);
    expect(p({ grade: 3, lang: 'en', items: ['sad', 'find', 'come', 'up'], accepts: [null, [], undefined, ['']] })).toBe(ON_EN_WORDS);
  });

  test('ON: Urdu words get the same prompt in its Urdu framing', async () => {
    const s = ON(standIns());
    const got = await score.scoreRow(row('ur.words4'), session(), s);
    const { prompt } = s.prompts[0];
    expect(prompt).toContain('timed Urdu FAMILIAR WORDS task');
    expect(prompt).toContain(ACCENT);
    expect(prompt).toContain('\n1: بچہ\n2: دروازہ\n3: پانی\n4: کتاب\n');
    expect(verdicts(got)).toEqual(['correct', 'wrong', 'correct', 'not_reached']);
  });

  test('ON: the speech gate still mutes a 0-word clip (not_reached, reason no_words with sa_r28_letter_gate ON), no model call', async () => {
    const s = { ...ON(standIns({ words: 0 })), letterGate: true };
    const got = await score.scoreRow(row('en.words4'), session(), s);
    expect(s.stt).toEqual(['en']);
    expect(s.prompts).toEqual([]);
    expect(verdicts(got)).toEqual(Array(4).fill('not_reached'));
    expect(got.marks.detail.items.every((i) => i.reason === 'no_words')).toBe(true);
    expect(got.marks.correct).toBe(0);
  });
});

describe('the sweep reads app_settings sa_r28_words_prompt', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

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

  test('setting true: the words row is scored with prompt C; no setting: with STORY', async () => {
    const r = row('en.words4');
    const s = standIns();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()], app_settings: [{ key: 'sa_r28_words_prompt', value: true }] });
    const out = await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...s } });
    expect(out).toMatchObject({ found: 1, scored: 1 });
    expect(s.prompts.map((x) => x.prompt)).toEqual([ON_EN_WORDS]);
    expect(r.ai_marks).toMatchObject({ task: 'en.words4', correct: 2 });
  });
});

describe('the switch module (app_settings sa_r28_words_prompt)', () => {
  test("a test's wordsPrompt wins; only JSON true is on; the setting fails closed", async () => {
    const wordsPrompt = switchModule();
    expect(wordsPrompt.KEY).toBe('sa_r28_words_prompt');
    expect(wordsPrompt.valueOf(true)).toBe(true);
    for (const v of [undefined, null, false, 1, 'true', {}]) expect(wordsPrompt.valueOf(v)).toBe(false);
    expect(await wordsPrompt.enabled({ wordsPrompt: true })).toBe(true);
    expect(await wordsPrompt.enabled({ wordsPrompt: 'true' })).toBe(false);
    expect(await wordsPrompt.enabled({ wordsPrompt: 1 })).toBe(false);
    const client = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }) });
    expect(await wordsPrompt.on(1e13, client([{ key: 'sa_r28_words_prompt', value: true }]))).toBe(true);
    expect(await wordsPrompt.on(2e13, client([{ key: 'sa_r28_words_prompt', value: 'true' }]))).toBe(false);
    expect(await wordsPrompt.on(3e13, client(null, { message: 'down' }))).toBe(false);
    expect(await wordsPrompt.on(4e13, { from: () => { throw new Error('boom'); } })).toBe(false);
  });
});

// sa_r28_words_prompt with sa_r28_ceiling: an extended run is prompted with the cells the child reached (the ceiling's cut
// list, at least today's base N), never the whole published grid; each listed word keeps its own accepted forms.
describe('sa_r28_words_prompt on an extended run (sa_r28_ceiling): the prompt lists the cells reached', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  const pad = (n) => String(n).padStart(2, '0');
  const W20 = ['sad', 'find', 'come', 'up', 'fine', 'said', 'cup', 'pen', 'run', 'big', 'hat', 'sun', 'dog', 'top', 'map', 'red', 'box', 'leg', 'pot', 'van'];
  // the accepted forms sit on positions 5-8 (extension items)
  const ACC = { 4: ['fain', 'fide'], 5: ['sed'], 6: ['kap'], 7: ['pin'] };
  const all = (id) => W20.map((w, k) => ({ id: `${id}.${pad(k + 1)}`, show: w, target: w, answer: w, src: `fixture:${id}[${k}]`, ...(k >= 4 ? { ext: true } : {}), ...(ACC[k] ? { accept: ACC[k] } : {}) }));
  const base = { w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3, stop: {} };
  // the committed extended task: today's 4 items / grid, the extension beside them (base_n, ext_items)
  const extended = () => { const it = all('en.words4'); return { ...base, id: 'en.words4', items: it.slice(0, 4), grid: W20.slice(0, 4), base_n: 4, ext_items: it.slice(4) }; };
  // a task without base_n: its whole list is its grid
  const plain = () => { const it = all('en.words4'); return { ...base, id: 'en.words4', items: it, grid: W20.slice() }; };
  const cells = (n) => Array.from({ length: n }, (_, i) => ({ i, item_id: `en.words4.${pad(i + 1)}`, at_ms: i * 2000, ms: 2000, how: 'tap' }));
  const run = (n) => ({ ...row('en.words4'), responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 30000, cells: cells(n), last_item_index: n - 1, stop_reason: 'early_stop_silence' }] });
  const lines = (prompt) => prompt.split('\n').filter((l) => /^\d+: /.test(l));
  const card = (n) => W20.slice(0, n).map((w, k) => `${k + 1}: ${w}${ACC[k] ? ` (also: ${ACC[k].join(', ')})` : ''}`);
  const deps = (task) => ({ ...standIns({ v: Array(20).fill('c') }), phoneBattery: () => ({ tasks: [task] }), wordsPrompt: true, ceiling: true });

  test('reached 7 of a 20-word extended grid (base 4): positions 1-7 exactly, 5-7 with their accepted forms, 8+ absent', async () => {
    const s = deps(extended());
    const got = await score.scoreRow(run(7), session(), s);
    expect(got.ok).toBe(true);
    expect(s.prompts).toHaveLength(1);
    const { prompt } = s.prompts[0];
    expect(prompt).toContain('The phone showed 7 separate words');
    expect(lines(prompt)).toEqual(card(7));
    expect(prompt).toContain('\n5: fine (also: fain, fide)\n6: said (also: sed)\n7: cup (also: kap)\nFor EVERY position 1-7 ');
    expect(prompt).not.toMatch(/^8: /m);
    expect(prompt).not.toContain('pin');
    expect(got.marks.detail.items).toHaveLength(7);
  });

  test('reached 2 (inside today\'s items): positions 1-4, today\'s base N, never fewer', async () => {
    const s = deps(extended());
    await score.scoreRow(run(2), session(), s);
    const { prompt } = s.prompts[0];
    expect(prompt).toContain('The phone showed 4 separate words');
    expect(lines(prompt)).toEqual(card(4));
  });

  test('a task without base_n: the whole grid, as before', async () => {
    const s = deps(plain());
    await score.scoreRow(run(7), session(), s);
    const { prompt } = s.prompts[0];
    expect(prompt).toContain('The phone showed 20 separate words');
    expect(lines(prompt)).toEqual(card(20));
  });
});

// sa_r8_counts: today's 5th word comes from the battery's spare list; it keeps the spare's accepted forms (none: no key)
describe('sa_r8_counts: a spare keeps its accepted forms', () => {
  const { countsTask } = require('../../shared/services/child-test/sa/counts'); // eslint-disable-line global-require
  const spareList = (id, targets, accepts = {}) => ({ id, items: targets.map((t, k) => ({ id: `${id}.${k}`, target: t, src: `fixture:${id}.items[${k}]`, ...(accepts[k] ? { accept: accepts[k] } : {}) })) });
  const words4 = () => words('en.words4', ['sad', 'find', 'come', 'up']);
  const COUNTS = (accepts) => ({ tasks: [spareList('en.words', ['go', 'sad', 'find', 'up', 'come'], accepts), words4()] });

  test('the 5th word of en.words4 carries accept from its spare; no accept on the spare: the item is as before', () => {
    const b = COUNTS({ 4: ['kam', 'cam'] });
    const t = countsTask(b, b.tasks[1]);
    expect(t.items).toHaveLength(5);
    expect(t.items[4]).toEqual({ id: 'en.words4.05', show: 'come', target: 'come', answer: 'come', src: 'fixture:en.words.items[4]', accept: ['kam', 'cam'] });
    expect(t.items[4].accept).not.toBe(b.tasks[0].items[4].accept);
    for (const acc of [undefined, []]) {
      const b0 = COUNTS({ 4: acc });
      expect(countsTask(b0, b0.tasks[1]).items[4]).toEqual({ id: 'en.words4.05', show: 'come', target: 'come', answer: 'come', src: 'fixture:en.words.items[4]' });
    }
  });

  test('every spare shape (options, shown, plain) carries a non-empty accept list', () => {
    const b = {
      tasks: [
        { id: 'ma.discrimination', items: [0, 1, 2].map((k) => ({ id: `d${k}`, target: '7', options: ['7', '9'], src: `fixture:d.items[${k}]`, accept: ['saat'] })) },
        { id: 'ma.discrimination2', items: [{ id: 'ma.discrimination2.01', target: '3', options: ['3', '5'] }] },
        { id: 'ma.add2', items: [0, 1, 2, 3, 4].map((k) => ({ id: `a${k}`, shown: `${k} + 1 =`, target: String(k + 1), src: `fixture:a.items[${k}]`, accept: [`x${k}`] })) },
        { id: 'ma.add2i', items: [{ id: 'ma.add2i.01', show: '1 + 1', target: '2', answer: '2' }] },
      ],
    };
    expect(countsTask(b, b.tasks[1]).items[1].accept).toEqual(['saat']);
    expect(countsTask(b, b.tasks[3]).items.slice(1).map((x) => x.accept)).toEqual([['x2'], ['x3'], ['x4']]);
  });

  test('the words prompt lists the counts form\'s 5th word with its accepted forms', async () => {
    const b = COUNTS({ 4: ['kam', 'cam'] });
    const s = { ...ON(standIns({ v: ['c', 'c', 'c', 'c', 'c'] })), phoneBattery: () => b };
    const r = { ...row('en.words4'), responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 30000, cells: [0, 1, 2, 3, 4].map((i) => ({ i, item_id: `en.words4.0${i + 1}`, at_ms: i * 2000, ms: 2000, how: 'tap' })), last_item_index: 4 }] };
    await score.scoreRow(r, session(), s);
    expect(s.prompts[0].prompt).toContain('\n4: up\n5: come (also: kam, cam)\n');
  });
});
