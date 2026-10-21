'use strict';

/**
 * The self-administered battery's spoken tasks are scored (sa/score.js, CHILD_TEST_SA_SCORER=on, OFF by default).
 * Until this, every SA recording was parked as `final:sa_score_later` and nothing ever scored it, so a coach who
 * finished a battery saw "scored later" for ever. The scorer claims a parked row by compare-and-set, scores it
 * against the text the phone showed (the session's passage variant), and writes marks the Results page reads.
 * It never takes a row of another test, another deployment's R2 tree, or the `pending` state.
 */

const score = require('../../shared/services/child-test/sa/score');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const SID = 'cccccccc-0000-4000-8000-000000000003';
const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const PHONE_SID = '013584b0-bf40-44c5-b14a-75ed0e3d4df8'; // the phone's own id: rotates to variant 1 of 2 or 3
const NOW = new Date('2026-10-21T15:00:00Z');
const KEY = (t) => `child-test/sandbox/sch-1/${SID}/sa/${t}.webm`;

/** A tiny in-memory stand-in for the supabase query builder (only what sa/score.js uses). */
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

const session = (over = {}) => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-21T14:45:00Z', ...over });
const row = (block, over = {}) => ({
  id: `row-${block}`, session_id: SID, block, response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY(block), audio_r2_keys: null, updated_at: '2026-10-21T14:44:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: PHONE_SID, time_used_ms: 30000 }], ...over,
});

/** The model hears every letter right up to the 3rd card position; the prompt is kept for inspection. */
function model() {
  const prompts = [];
  return {
    prompts,
    clipOf: async () => ({ base64: 'AAAA', durationSec: 30 }),
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt, job }) => {
      prompts.push({ job, prompt });
      if (job === 'child_test.sa_letters' || job === 'child_test.sa_oral_maths') return { json: { found: true, items: [{ i: 1, heard: 'x', v: 'c', conf: 0.9 }, { i: 2, heard: 'y', v: 'w', conf: 0.7 }, { i: 3, heard: 'z', v: 'c', conf: 0.8 }] }, cost: 0.001, seconds: 1 };
      if (job === 'child_test.sa_questions') return { json: { questions: [{ id: 'q', answer: 'a', verdict: 'correct', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
      return { json: { words: [{ i: 1, v: 'correct' }, { i: 2, v: 'correct' }, { i: 3, v: 'wrong' }] }, cost: 0.001, seconds: 1 };
    },
  };
}

describe('the SA scorer', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
  afterEach(() => { process.env = { ...before }; });

  test('off by default: no read, no write', async () => {
    delete process.env.CHILD_TEST_SA_SCORER;
    const db = fakeDb({ child_test_blocks: [row('ur.letter_sounds_rec')], child_test_sessions: [session()] });
    expect(await score.sweepOnce({ now: NOW, deps: { supabase: db, ...model() } })).toEqual({ skipped: 'off' });
    expect(db.writes).toEqual([]);
    expect(score.start()).toBe(false);
  });

  test('a parked SA recording with its R2 key is claimed, scored per item with a confidence, and written once', async () => {
    const r = row('ur.letter_sounds_rec');
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const m = model();
    const out = await score.sweepOnce({ now: NOW, deps: { supabase: db, ...m } });
    expect(out).toMatchObject({ found: 1, scored: 1, failed: 0 });
    expect(db.writes.map((w) => w.ai_reason)).toEqual(['final:sa_scoring', null]); // the claim, then the marks
    expect(r.ai_status).toBe('scored');
    expect(r.ai_marks).toMatchObject({ version: 'sa-marks-v1', task: 'ur.letter_sounds_rec', correct: 2, attempted: 3, per_minute: 4, seconds_used: 30 });
    expect(r.ai_marks.detail.items.slice(0, 3).map((i) => [i.verdict, i.conf])).toEqual([['correct', 0.9], ['wrong', 0.7], ['correct', 0.8]]);
    expect(r.ai_marks.detail.confidence).toBe(0.8);
    expect(m.prompts[0].prompt).toMatch(/SOUND/);
    expect(m.prompts[0].prompt).not.toMatch(/Testwala/);
  });

  test('never takes another test, another R2 tree, a pending row or a row with marks', async () => {
    const rows = [
      row('ur.story', { id: 'v3', session_id: 'other' }),
      row('ur.words_rec', { id: 'prod', audio_r2_key: `child-test/production/sch-1/${SID}/sa/ur.words_rec.webm` }),
      row('ur.story', { id: 'pending', ai_status: 'pending', ai_reason: null }),
      row('en.story', { id: 'done', ai_status: 'scored', ai_reason: null, ai_marks: { correct: 1 } }),
      row('en.words_rec', { id: 'noaudio', audio_r2_key: null }),
    ];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session(), session({ id: 'other', item_bank_version: 'v3' })] });
    const out = await score.sweepOnce({ now: NOW, deps: { supabase: db, ...model() } });
    expect(out.scored).toBe(0);
    expect(db.writes).toEqual([]);
  });

  test("one child's spoken tasks are scored side by side, not one after another", async () => {
    const blocks = ['ur.letter_sounds_rec', 'ur.words_rec', 'en.letter_sounds_rec', 'en.words_rec'].map((b) => row(b));
    const db = fakeDb({ child_test_blocks: blocks, child_test_sessions: [session()] });
    let inFlight = 0; let most = 0;
    const m = model();
    const slow = { ...m, chatJSON: async (a) => { inFlight += 1; most = Math.max(most, inFlight); await new Promise((r) => setTimeout(r, 20)); inFlight -= 1; return m.chatJSON(a); } };
    const out = await score.sweepOnce({ now: NOW, deps: { supabase: db, ...slow } });
    expect(out.scored).toBe(4);
    expect(most).toBe(4);
  });

  test('a claim another process won is skipped (compare-and-set on ai_reason)', async () => {
    const r = row('ur.letter_sounds_rec');
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const won = await score.__internals.claim(r, db);
    expect(won).toBe(true);
    expect(await score.__internals.claim({ ...r, ai_reason: 'final:sa_score_later' }, db)).toBe(false);
  });

  test('a model failure retries, then ends as a final failure (never pending)', async () => {
    const r = row('ur.letter_sounds_rec');
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const bad = { ...model(), chatJSON: async () => ({ json: null, error: 'boom' }) };
    for (let k = 0; k < 3; k += 1) await score.sweepOnce({ now: NOW, deps: { supabase: db, ...bad } });
    expect(r.ai_reason).toBe('final:sa_score_failed:model_failed');
    expect(db.writes.every((w) => w.ai_status === undefined)).toBe(true);
  });

  test("the passage is scored against the variant the phone showed (its questions' asked ids), not a fixed passage", async () => {
    const story = row('ur.story');
    const comp = row('ur.story_comp', { response_mode: 'oral', audio_r2_key: null, responses: [{ kind: 'result', mode: 'oral', asked: ['ur.story3.q1'], session_id: 'x' }] });
    const db = fakeDb({ child_test_blocks: [story, comp], child_test_sessions: [session()] });
    const m = model();
    await score.sweepOnce({ now: NOW, deps: { supabase: db, ...m } });
    expect(story.ai_marks.detail.variant.id).toBe('prpkp2020');
    const bank = require('../../shared/data/child-test/item-bank.sa.v1.json'); // eslint-disable-line global-require
    const v3 = bank.tasks['coach.G3.A/ur.story'].variants[2].task.record.passage.words[0].target;
    const v1 = bank.tasks['coach.G3.A/ur.story'].variants[0].task.record.passage.words.slice(0, 3).map((w) => w.target).join(' ');
    expect(m.prompts.find((p) => p.job === 'child_test.sa_story').prompt).toContain(v3);
    expect(m.prompts.find((p) => p.job === 'child_test.sa_story').prompt).not.toContain(v1);
  });

  test('without the asked ids, the passage takes the phone rotation (hash of the phone session id)', () => {
    const bank = require('../../shared/data/child-test/item-bank.sa.v1.json'); // eslint-disable-line global-require
    const got = score.specFor(bank, session(), row('en.story'));
    expect(got.variant.id).toBe(bank.tasks['coach.G3.A/en.story'].variants[score.hash(PHONE_SID) % 2].id);
  });
});

describe('the Results page reads what the scorer writes', () => {
  test('a scored SA row shows its numbers, no page change', async () => {
    const r = row('ur.letter_sounds_rec');
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    await score.sweepOnce({ now: NOW, deps: { supabase: db, ...model() } });
    delete process.env.CHILD_TEST_SA_SCORER;
    const deps = {
      enabled: async () => true,
      supabase: { from: () => { throw new Error('no direct reads'); } },
      store: { getSession: async () => ({ ok: true, session: { ...session(), coach_user_id: COACH, started_at: NOW.toISOString(), device: {} } }), listBlocks: async () => ({ ok: true, blocks: [{ ...r, lang: 'ur', created_at: NOW.toISOString() }] }) },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
      bank: null, now: () => NOW, log: () => {}, logError: () => {},
    };
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, deps);
    expect(out.tasks[0]).toMatchObject({ recording: 'scored', score: { correct: 2, attempted: 3, per_minute: 4, seconds_used: 30 } });
  });
});

describe('saRegister nudges the scorer', () => {
  test('a recording that arrives is handed to the scorer for its session', async () => {
    const kick = jest.fn();
    const sess = { ...session(), coach_user_id: COACH, school_id: 'sch-1' };
    let key = null;
    const deps = {
      enabled: async () => true,
      supabase: { from: () => { throw new Error('no direct reads'); } },
      store: { getSession: async () => ({ ok: true, session: sess }) },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }), setAudio: async () => ({ ok: true }) },
      r2: { getPresignedUploadUrl: async (k) => { key = k; return 'https://r2.example/put'; }, headObject: async () => ({ exists: true }) },
      env: 'sandbox', scoreLater: false, saScorer: { kick },
      now: () => NOW, log: () => {}, logError: () => {},
    };
    const pre = await sa.saPresign({ userId: COACH, sessionId: SID, taskId: 'ur.words_rec', mime: 'audio/webm', bytes: 1000 }, deps);
    expect(pre.status).toBe('ok');
    const out = await sa.saRegister({ userId: COACH, sessionId: SID, taskId: 'ur.words_rec', key }, deps);
    expect(out).toEqual({ status: 'ok', scoring: 'later' });
    expect(kick).toHaveBeenCalledWith(SID);
  });
});

describe('the W3 forms (RDF auto / RDF manual): tasks the bank does not carry, scored from the battery the phone ran', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
  afterEach(() => { process.env = { ...before }; });

  // the W3 shape (sa/build-w3.js): items one at a time, `answer` = what a correct child says
  const W3 = {
    tasks: [
      { id: 'ur.letter_sounds5', kind: 'grid', subtask: 'letter_sound_identification', lang: 'ur', response: 'record', present: 'one_at_a_time', time_limit_s: 60, stop: {},
        grid: ['ب', 'م', 'ک', 'س', 'ر'], items: ['ب', 'م', 'ک', 'س', 'ر'].map((L, k) => ({ id: `ur.letter_sounds5.0${k + 1}`, show: L, target: L, answer: `/${L}/` })) },
      { id: 'ma.add2i', kind: 'oral', subtask: 'mental_addition', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
        items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19, answer: 19 }, { id: 'ma.add2i.02', show: '18 + 7', target: 25, answer: 25 }] },
      { id: 'ma.fluency1m', kind: 'oral', subtask: 'mental_math_fluency', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: 60, stop: {},
        items: Array.from({ length: 20 }, (_, k) => ({ id: `ma.fluency1m.${k + 1}`, show: `${k} + 1`, target: k + 1, answer: k + 1 })) },
      { id: 'ur.story_w3', kind: 'passage', subtask: 'oral_reading_fluency', lang: 'ur', response: 'record', stop: { first_line_n: 3, first_line_min_correct: 1 },
        passage: { text: 'الف۔', lines: [] }, items: [{ id: 'a1', target: 'الف' }],
        variants: [
          { id: 'rwp2026', passage: { text: 'آج بلال گیا۔' }, items: [{ id: 'a1', target: 'آج' }, { id: 'a2', target: 'بلال' }, { id: 'a3', target: 'گیا' }] },
          { id: 'select2024', passage: { text: 'مٹھو میاں پنجرے۔' }, items: [{ id: 'b1', target: 'مٹھو' }, { id: 'b2', target: 'میاں' }, { id: 'b3', target: 'پنجرے' }] },
        ] },
      { id: 'ur.story_comp_w3', kind: 'questions', lang: 'ur', response: 'oral', depends_on: { task: 'ur.story_w3' }, items: [],
        variants: [{ id: 'rwp2026', items: [{ id: 'ur.story_w3.q1' }] }, { id: 'select2024', items: [{ id: 'ur.story2.q1' }] }] },
    ],
  };
  const load = (g, form, lang) => (lang === 'ur' && form === 'A' ? W3 : null);

  test('a W3 letter-sound task: the expected sound goes to the model, attempted is the cell the child reached', async () => {
    const r = row('ur.letter_sounds5', { responses: [{ kind: 'result', mode: 'record', session_id: PHONE_SID, time_used_ms: 20000, cells: [{ i: 0 }, { i: 1 }, { i: 2 }] }] });
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const m = model();
    await score.sweepOnce({ now: NOW, deps: { supabase: db, ...m, phoneBattery: load } });
    expect(r.ai_status).toBe('scored');
    expect(m.prompts[0].prompt).toMatch(/ONE AT A TIME/);
    expect(m.prompts[0].prompt).toContain('1: ب (/ب/)');
    expect(r.ai_marks).toMatchObject({ correct: 2, attempted: 3, seconds_used: 20 });
  });

  test('mental addition: each sum and its answer go to the model; untimed, so correct of 2', async () => {
    const r = row('ma.add2i', { lang: 'ur' });
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const m = model();
    await score.sweepOnce({ now: NOW, deps: { supabase: db, ...m, phoneBattery: load } });
    expect(m.prompts[0].job).toBe('child_test.sa_oral_maths');
    expect(m.prompts[0].prompt).toContain('shown "13 + 6" → correct answer 19');
    expect(r.ai_marks).toMatchObject({ task: 'ma.add2i', correct: 1, of: 2 });
    expect(r.ai_marks.detail.items.map((i) => [i.id, i.verdict, i.answer])).toEqual([['ma.add2i.01', 'correct', 19], ['ma.add2i.02', 'wrong', 25]]);
  });

  test('one-minute fluency: timed, so correct per minute on the time used', async () => {
    const r = row('ma.fluency1m', { lang: 'ur', responses: [{ kind: 'result', mode: 'record', session_id: PHONE_SID, time_used_ms: 60000 }] });
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    await score.sweepOnce({ now: NOW, deps: { supabase: db, ...model(), phoneBattery: load } });
    expect(r.ai_marks).toMatchObject({ correct: 2, attempted: 3, per_minute: 2, seconds_used: 60 });
  });

  test("the W3 passage: the variant whose questions were asked, its words, and its first-line stop", () => {
    const got = score.phoneSpecFor({ ...session(), asked: ['ur.story2.q1'] }, row('ur.story_w3'), load);
    expect(got.variant.id).toBe('select2024');
    expect(got.spec.record.passage.words.map((w) => w.target)).toEqual(['مٹھو', 'میاں', 'پنجرے']);
    expect(got.spec.record.stop).toEqual({ type: 'first_line', n: 3 });
  });

  test('a task neither the bank nor the battery carries is a final failure, never a guess', async () => {
    const got = await score.scoreRow(row('ur.nothing_here'), session(), { ...model(), phoneBattery: load });
    expect(got).toMatchObject({ ok: false, reason: 'task_not_in_bank', retry: false });
  });

  test('the Wave 2 forms still score from the bank (the bank wins over the battery)', () => {
    const bank = require('../../shared/data/child-test/item-bank.sa.v1.json'); // eslint-disable-line global-require
    expect(score.specFor(bank, session(), row('ur.letter_sounds_rec'))).not.toBeNull();
  });
});
