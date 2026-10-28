'use strict';

/**
 * sa_r8_variant_wait: a rotated passage is scored against the passage the phone SHOWED.
 *
 * The phone never wrote down which rotation variant it showed; only its questions row's asked ids name it. The passage
 * row arrives first and was scored at once, so the scorer guessed hash(phone session id) % n. That guess is right only
 * when the phone rotated. A phone whose battery came without variants (a failed switch read on the server) showed the
 * base passage (= variant 0): the guess picked the other passage and every word came back "not reached".
 * ON: the passage waits for its questions row (or the phone's own variant on the result); the guess only once the
 * session has ended or the wait ran out, and the marks say where the variant came from. OFF: unchanged.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000041';
// hash(PHONE_SID) % 2 === 1: the guess is select2024 («مٹھو میاں»), while this phone showed the base passage (rwp2026)
const PHONE_SID = 'eeeeeeee-0000-4000-8000-000000000000';
const KEY = (t, i) => `child-test/sandbox/sch-1/${SID}/sa/${t}${i ? `__${i}` : ''}.webm`;
const session = (over = {}) => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', finished_at: null, ...over });
const parked = { ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null };

const passage = (res = {}) => ({
  id: 'row-passage', session_id: SID, block: 'ur.story_w3', response_mode: 'record', ...parked,
  audio_r2_key: KEY('ur.story_w3'), audio_r2_keys: null, updated_at: '2026-10-28T05:04:06Z',
  responses: [{ kind: 'result', mode: 'record', task_id: 'ur.story_w3', recorded: true, session_id: PHONE_SID, time_used_ms: 60000, ...res }],
});
const comp = () => ({
  id: 'row-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ...parked,
  audio_r2_key: null, audio_r2_keys: [{ i: 'ur.story_w3.q1', key: KEY('ur.story_comp_w3', 'ur.story_w3.q1') }],
  updated_at: '2026-10-28T05:05:29Z',
  responses: [{ kind: 'result', mode: 'oral', asked: ['ur.story_w3.q1'], task_id: 'ur.story_comp_w3', recorded: true, attempted: 1, session_id: PHONE_SID, time_used_ms: 7000 }],
});

function model() {
  const prompts = [];
  return {
    prompts,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 40, key }),
    model: () => 'google/gemini-test',
    chatJSON: async (args) => {
      const { job } = args;
      if (job === 'child_test.sa_story') prompts.push(JSON.stringify(args));
      if (job === 'child_test.sa_story') return { json: { words: Array.from({ length: 12 }, (_, k) => ({ i: k + 1, v: 'correct' })) }, cost: 0.001, seconds: 1 };
      if (job === 'child_test.sa_questions') return { json: { questions: [{ id: 'ur.story_w3.q1', answer: 'x', verdict: 'correct', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
      return { json: {}, cost: 0, seconds: 0 };
    },
  };
}

function fakeDb(tables) {
  const from = (name) => {
    const f = []; let patch = null;
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
      like(c, v) { const p = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(p)); return q; },
      gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
      update(p) { patch = p; return q; },
      then(ok, bad) {
        if (!tables[name]) return Promise.resolve({ data: [], error: null }).then(ok, bad);
        const hit = tables[name].filter((r) => f.every((fn) => fn(r)));
        if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
        return Promise.resolve({ data: hit.map((r) => JSON.parse(JSON.stringify(r))), error: null }).then(ok, bad);
      },
    };
    return q;
  };
  return { from };
}

const firstRef = (row) => row.ai_marks.detail.items[0].ref;

describe('sa_r8_variant_wait: the passage is scored against the passage the phone showed', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  test('the fixture: the guess for this phone is the other passage', () => {
    expect(score.hash(PHONE_SID) % 2).toBe(1);
  });

  test('OFF (unchanged): the passage is scored at once, against the guess (select2024)', async () => {
    const rows = [passage()];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    const out = await score.sweepOnce({ now: new Date('2026-10-28T05:05:00Z'), deps: { supabase: db, ...model(), variantWait: false } });
    expect(out).toMatchObject({ scored: 1 });
    expect(rows[0].ai_marks.detail.variant.id).toBe('select2024');
    expect(firstRef(rows[0])).toBe('مٹھو');
  });

  test('ON: the passage waits for its questions row, then takes the variant its questions name (rwp2026)', async () => {
    const rows = [passage()];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    const m = model();
    const first = await score.sweepOnce({ now: new Date('2026-10-28T05:05:00Z'), deps: { supabase: db, ...m, variantWait: true } });
    expect(first).toMatchObject({ scored: 0, waiting: 1 });
    expect(rows[0].ai_marks).toBeNull();
    rows.push(comp());
    await score.sweepOnce({ now: new Date('2026-10-28T05:06:00Z'), deps: { supabase: db, ...m, variantWait: true } });
    expect(rows[0].ai_status).toBe('scored');
    expect(rows[0].ai_marks.detail.variant).toMatchObject({ id: 'rwp2026' });
    expect(rows[0].ai_marks.detail.variant_from).toBe('questions');
    expect(firstRef(rows[0])).toBe('آج');
    expect(m.prompts.join('')).toContain('بلال');
  });

  test('ON: the variant the phone wrote on its result wins, with no wait', async () => {
    const rows = [passage({ variant: 'rwp2026' })];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-28T05:05:00Z'), deps: { supabase: db, ...model(), variantWait: true } });
    expect(rows[0].ai_marks.detail.variant).toMatchObject({ id: 'rwp2026' });
    expect(rows[0].ai_marks.detail.variant_from).toBe('phone');
  });

  test('ON: a phone that wrote "no variant" (it showed the base passage) is scored against the base passage', async () => {
    const rows = [passage({ variant: null })];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-28T05:05:00Z'), deps: { supabase: db, ...model(), variantWait: true } });
    expect(firstRef(rows[0])).toBe('آج');
    expect(rows[0].ai_marks.detail.variant_from).toBe('phone');
  });

  test('ON: no questions row after the wait (or the session ended): the guess, said so in the marks', async () => {
    const rows = [passage()];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-28T05:20:00Z'), deps: { supabase: db, ...model(), variantWait: true } });
    expect(rows[0].ai_status).toBe('scored');
    expect(rows[0].ai_marks.detail.variant).toMatchObject({ id: 'select2024' });
    expect(rows[0].ai_marks.detail.variant_from).toBe('guess');

    const ended = [passage()];
    const db2 = fakeDb({ child_test_blocks: ended, child_test_sessions: [session({ status: 'completed', finished_at: '2026-10-28T05:04:30Z' })] });
    score.__internals.resetBoot();
    await score.sweepOnce({ now: new Date('2026-10-28T05:05:00Z'), deps: { supabase: db2, ...model(), variantWait: true } });
    expect(ended[0].ai_status).toBe('scored');
    expect(ended[0].ai_marks.detail.variant_from).toBe('guess');
  });

  test('ON: a questions row with no asked ids (questions skipped) gives nothing to wait for: the guess at once', async () => {
    const c = comp();
    c.responses[0].asked = [];
    const rows = [passage(), c];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-28T05:06:00Z'), deps: { supabase: db, ...model(), variantWait: true } });
    expect(rows[0].ai_status).toBe('scored');
    expect(rows[0].ai_marks.detail.variant_from).toBe('guess');
  });

  test('ON: a passage with no variants in the battery never waits', async () => {
    const rows = [{ ...passage(), id: 'row-en', block: 'en.story_w3', responses: [{ kind: 'result', mode: 'record', task_id: 'en.story_w3', recorded: true, session_id: PHONE_SID, time_used_ms: 60000 }] }];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-28T05:05:00Z'), deps: { supabase: db, ...model(), variantWait: true } });
    expect(rows[0].ai_status).toBe('scored');
  });
});
