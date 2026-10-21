'use strict';

/**
 * Two scorer defects the W3 walks found on sandbox (the fixtures are those rows' shapes, ids and names removed):
 *  1. The English comprehension questions stayed "scored later" when the coach looked at Results. The walks tap q2+
 *     before Jugnu has read them, so only q1 has a clip; the scorer waited for the other clips until 2 min after the
 *     session's end, and EN comprehension is the battery's last spoken task (CHILD_TEST_SA_CLIP_WAIT_S).
 *  2. A clip with no speech (the harness's tone) was scored as speech: Urdu words 4/4, letter sounds 5/5
 *     (CHILD_TEST_SA_SPEECH_GATE).
 */

jest.mock('../../shared/config/supabase', () => ({ from: (...a) => global.__saDb.from(...a) }));

const score = require('../../shared/services/child-test/sa/score');
const store = require('../../shared/services/child-test/sa-store');

const SID = 'cccccccc-0000-4000-8000-000000000003';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000a';
const KEY = (t, i) => `child-test/sandbox/sch-1/${SID}/sa/${t}${i ? `__${i}` : ''}.webm`;

function fakeDb(tables) {
  const writes = [];
  function query(name) {
    const f = []; let patch = null; let lim = null;
    const q = {
      select() { return q; }, order() { return q; },
      limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
      like(c, v) { const p = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(p)); return q; },
      gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
      update(p) { patch = p; return q; },
      then(ok, bad) {
        try {
          const hit = tables[name].filter((r) => f.every((fn) => fn(r)));
          if (patch) { hit.forEach((r) => { Object.assign(r, patch); writes.push({ id: r.id, ...patch }); }); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
          const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
          return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
        } catch (e) { return Promise.reject(e).then(ok, bad); }
      },
    };
    return q;
  }
  return { from: query, writes };
}

// a G5 form A RDF auto walk on sandbox: the EN questions row as the walk left it
const FINISHED = '2026-10-21T17:35:24Z';
const session = (over = {}) => ({ id: SID, grade: 5, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: FINISHED, ...over });
const enComp = (over = {}) => ({
  id: 'row-en-comp', session_id: SID, block: 'en.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: [{ i: 'en.story_w3.q1', key: KEY('en.story_comp_w3', 'en.story_w3.q1') }],
  updated_at: '2026-10-21T17:33:25Z',
  responses: [
    { kind: 'result', mode: 'oral', asked: ['en.story_w3.q1', 'en.story_w3.q2', 'en.story_w3.q3'], task_id: 'en.story_comp_w3', recorded: true, attempted: 3, scored_on: 'later', session_id: PHONE_SID, time_used_ms: 6525, last_item_index: 2, stop_reason: 'complete' },
    { kind: 'answer', item_id: 'en.story_w3.q1', value: 'spoken', ms: 3028 },
    { kind: 'answer', item_id: 'en.story_w3.q2', value: 'spoken', ms: 827 },
    { kind: 'answer', item_id: 'en.story_w3.q3', value: 'spoken', ms: 823 },
  ],
  ...over,
});
const at = (iso) => new Date(iso);

function model({ speechWords = null } = {}) {
  const prompts = [];
  const heard = [];
  return {
    prompts, heard,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 4, key }),
    model: () => 'google/gemini-test',
    ...(speechWords == null ? {} : { speechOf: async (clip, lang) => { heard.push(lang); return { words: speechWords, model: 'soniox:test', cost: 0.00002, seconds: 1 }; } }),
    // the tone row: the model "hears" every item right (what it did on sandbox)
    chatJSON: async ({ prompt, job }) => {
      prompts.push({ job, prompt });
      if (job === 'child_test.sa_letters' || job === 'child_test.sa_oral_maths') return { json: { found: true, items: [1, 2, 3, 4, 5].map((i) => ({ i, heard: 'x', v: 'c', conf: 0.98 })) }, cost: 0.001, seconds: 1 };
      if (job === 'child_test.sa_questions') return { json: { questions: [{ id: 'en.story_w3.q1', answer: 'school', verdict: 'correct', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
      return { json: { words: [1, 2, 3, 4].map((i) => ({ i, w: 'x', v: 'correct' })), words_correct: 4, words_attempted: 4, notes: '' }, cost: 0.001, seconds: 1 };
    },
  };
}

describe('DEFECT 1: the last questions task is scored while the coach is still there', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
  afterEach(() => { process.env = { ...before }; });

  test('with the switch, a row quiet for 30 s is scored with the clips it has, 10 s after the session ended', async () => {
    process.env.CHILD_TEST_SA_CLIP_WAIT_S = '30';
    const r = enComp();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const out = await score.sweepOnce({ now: at('2026-10-21T17:35:34Z'), deps: { supabase: db, ...model() } });
    expect(out).toMatchObject({ found: 1, scored: 1, waiting: 0 });
    expect(r.ai_status).toBe('scored');
    expect(r.ai_marks).toMatchObject({ task: 'en.story_comp_w3', correct: 1, of: 3 });
    expect(r.ai_marks.detail.items.map((i) => [i.id, i.verdict, i.clip])).toEqual([
      ['en.story_w3.q1', 'correct', true], ['en.story_w3.q2', 'no_answer', false], ['en.story_w3.q3', 'no_answer', false]]);
  });

  test('with the switch, a row that got a clip 10 s ago still waits for the next one', () => {
    process.env.CHILD_TEST_SA_CLIP_WAIT_S = '30';
    expect(score.ready(enComp(), session(), at('2026-10-21T17:33:35Z').getTime())).toBe(false);
  });

  test('switch off: the same row waits 2 min after the session ended (unchanged)', () => {
    delete process.env.CHILD_TEST_SA_CLIP_WAIT_S;
    expect(score.ready(enComp(), session(), at('2026-10-21T17:35:34Z').getTime())).toBe(false);
    expect(score.ready(enComp(), session(), at('2026-10-21T17:37:30Z').getTime())).toBe(true);
  });

  test('every asked clip there: scored at once, switch or not', () => {
    process.env.CHILD_TEST_SA_CLIP_WAIT_S = '30';
    const all = enComp({ audio_r2_keys: ['q1', 'q2', 'q3'].map((q) => ({ i: `en.story_w3.${q}`, key: KEY('en.story_comp_w3', `en.story_w3.${q}`) })), updated_at: '2026-10-21T17:35:20Z' });
    expect(score.ready(all, session(), at('2026-10-21T17:35:21Z').getTime())).toBe(true);
  });
});

describe('DEFECT 1: a clip that comes after the marks reopens the task (sa-store setAudio)', () => {
  const before = { ...process.env };
  afterEach(() => { process.env = { ...before }; delete global.__saDb; });
  const scored = (over = {}) => enComp({ ai_status: 'scored', ai_reason: null, ai_marks: { version: 'sa-marks-v1', correct: 1, of: 3 }, ...over });

  test('with the switch, a late q2 clip clears the SA scorer marks and parks the row, keeping q1', async () => {
    process.env.CHILD_TEST_SA_CLIP_WAIT_S = '30';
    const r = scored();
    global.__saDb = fakeDb({ child_test_blocks: [r] });
    const out = await store.setAudio(SID, 'en.story_comp_w3', 'en.story_w3.q2', KEY('en.story_comp_w3', 'en.story_w3.q2'));
    expect(out).toEqual({ ok: true });
    expect(r).toMatchObject({ ai_marks: null, ai_status: 'failed', ai_reason: 'final:sa_score_later' });
    expect(r.audio_r2_keys.map((k) => k.i)).toEqual(['en.story_w3.q1', 'en.story_w3.q2']);
  });

  test('phone marks stay frozen; a clip it already has stays frozen; switch off stays frozen', async () => {
    process.env.CHILD_TEST_SA_CLIP_WAIT_S = '30';
    const phone = scored({ ai_marks: { correct: 2 } });
    global.__saDb = fakeDb({ child_test_blocks: [phone] });
    expect(await store.setAudio(SID, 'en.story_comp_w3', 'en.story_w3.q2', 'k')).toEqual({ ok: false, reason: 'frozen' });
    const again = scored();
    global.__saDb = fakeDb({ child_test_blocks: [again] });
    expect(await store.setAudio(SID, 'en.story_comp_w3', 'en.story_w3.q1', 'k')).toEqual({ ok: false, reason: 'frozen' });
    delete process.env.CHILD_TEST_SA_CLIP_WAIT_S;
    const off = scored();
    global.__saDb = fakeDb({ child_test_blocks: [off] });
    expect(await store.setAudio(SID, 'en.story_comp_w3', 'en.story_w3.q2', 'k')).toEqual({ ok: false, reason: 'frozen' });
    expect(off.ai_marks).toMatchObject({ version: 'sa-marks-v1' });
  });
});

describe('DEFECT 2: a clip with no speech is "no response", never correct', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
  afterEach(() => { process.env = { ...before }; });

  // the same walk on the harness tone: ur.words4 had scored 4/4, ur.letter_sounds5 1/5
  const toneRow = (block, over = {}) => ({
    id: `row-${block}`, session_id: SID, block, response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
    ai_marks: null, audio_r2_key: KEY(block), audio_r2_keys: null, updated_at: '2026-10-21T16:58:20Z',
    responses: [{ kind: 'result', mode: 'record', session_id: PHONE_SID, time_used_ms: 9000, cells: [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }] }],
    ...over,
  });

  test('Urdu words on a tone: STT hears 0 words, so 0/4, every item no_speech with conf 0, and the model is not asked', async () => {
    process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    const m = model({ speechWords: 0 });
    const got = await score.scoreRow(toneRow('ur.words4'), session(), m);
    expect(got.ok).toBe(true);
    expect(got.marks).toMatchObject({ task: 'ur.words4', correct: 0, per_minute: 0 });
    expect(got.marks.detail.items.map((i) => [i.ref, i.verdict, i.conf, i.no_speech])).toEqual([
      ['بچہ', 'not_reached', 0, true], ['دروازہ', 'not_reached', 0, true], ['پانی', 'not_reached', 0, true], ['کتاب', 'not_reached', 0, true]]);
    expect(got.marks.detail).toMatchObject({ no_speech: true, no_speech_items: 4, confidence_band: 'low' });
    expect(m.heard).toEqual(['ur']);
    expect(m.prompts).toEqual([]);
  });

  test("letter sounds: the model's own found:false is no speech too, even when it marks items", async () => {
    process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    const m = model({ speechWords: 2 });
    const found = { ...m, chatJSON: async (a) => { const r = await m.chatJSON(a); return { ...r, json: { ...r.json, found: false } }; } };
    const got = await score.scoreRow(toneRow('ur.letter_sounds5'), session(), found);
    expect(got.marks.correct).toBe(0);
    expect(got.marks.detail.items.every((i) => i.verdict === 'not_reached' && i.no_speech)).toBe(true);
  });

  test('a questions clip with no speech is no_answer, conf 0, no_speech; one with speech is marked by the model', async () => {
    process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    const two = enComp({ audio_r2_keys: ['q1', 'q2'].map((q) => ({ i: `en.story_w3.${q}`, key: KEY('en.story_comp_w3', `en.story_w3.${q}`) })) });
    const m = model();
    m.speechOf = async (clip) => ({ words: /q2/.test(clip.key) ? 0 : 3, model: 'soniox:test', cost: 0 });
    const got = await score.scoreRow(two, session(), m);
    expect(got.marks.detail.items.map((i) => [i.id, i.verdict, i.conf, !!i.no_speech])).toEqual([
      ['en.story_w3.q1', 'correct', 0.9, false], ['en.story_w3.q2', 'no_answer', 0, true], ['en.story_w3.q3', 'no_answer', null, false]]);
    expect(got.marks.detail.no_speech).toBe(false);
    expect(got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_speech_gate')).toHaveLength(2);
  });

  test('spoken maths on a tone: no item correct', async () => {
    process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    const got = await score.scoreRow(toneRow('ma.add2i', { lang: 'ur' }), session(), model({ speechWords: 0 }));
    expect(got.marks).toMatchObject({ task: 'ma.add2i', correct: 0 });
    expect(got.marks.detail.items.every((i) => i.no_speech)).toBe(true);
  });

  test('STT failing leaves the model verdicts (logged), and switch off never calls STT', async () => {
    process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    const m = model();
    m.speechOf = async () => { throw new Error('stt down'); };
    const got = await score.scoreRow(toneRow('ur.words4'), session(), m);
    expect(got.marks.correct).toBe(4);
    expect(got.marks.meta.calls[0]).toMatchObject({ job: 'child_test.sa_speech_gate', error: 'stt down' });
    delete process.env.CHILD_TEST_SA_SPEECH_GATE;
    const off = model({ speechWords: 0 });
    const got2 = await score.scoreRow(toneRow('ur.words4'), session(), off);
    expect(off.heard).toEqual([]);
    expect(got2.marks.correct).toBe(4);
    expect(got2.marks.detail.no_speech).toBeUndefined();
  });
});
