'use strict';

/**
 * EGRA's stop rules at scoring time for the W3 tasks (app_settings sa_stop_rules, default OFF).
 *  1. A W3 letters / words task (one item at a time, `stop: {}` in the battery) takes EGRA's first-row rule: no
 *     correct item in the first row (10 letters / 5 words, or the whole task when it is shorter) → stopped by rule,
 *     0 correct, flagged.
 *  2. Comprehension after a passage the first-line rule stopped: not asked by EGRA → every question not_reached,
 *     0 correct, flagged, and no model call. While that passage is still being scored, the questions wait.
 * OFF: both are scored exactly as before.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000003';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000a';
const KEY = (t, i) => `child-test/sandbox/sch-1/${SID}/sa/${t}${i ? `__${i}` : ''}.webm`;
const session = (over = {}) => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T05:35:24Z', ...over });

const letters = () => ({
  id: 'row-letters', session_id: SID, block: 'ur.letter_names5', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY('ur.letter_names5'), audio_r2_keys: null, updated_at: '2026-10-22T05:31:00Z',
  responses: [{ kind: 'result', mode: 'record', task_id: 'ur.letter_names5', recorded: true, attempted: 5, last_item_index: 4, scored_on: 'later', session_id: PHONE_SID, time_used_ms: 30000, stop_reason: 'complete' }],
});
const comp = () => ({
  id: 'row-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: ['q1', 'q2'].map((q) => ({ i: `ur.story_w3.${q}`, key: KEY('ur.story_comp_w3', `ur.story_w3.${q}`) })),
  updated_at: '2026-10-22T05:34:00Z',
  responses: [{ kind: 'result', mode: 'oral', asked: ['ur.story_w3.q1', 'ur.story_w3.q2'], task_id: 'ur.story_comp_w3', recorded: true, attempted: 2, scored_on: 'later', session_id: PHONE_SID, time_used_ms: 9000, stop_reason: 'complete' }],
});

function model(verdict) {
  const jobs = [];
  return {
    jobs,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 4, key }),
    model: () => 'google/gemini-test',
    chatJSON: async ({ job }) => {
      jobs.push(job);
      if (job === 'child_test.sa_letters') return { json: { found: true, items: [1, 2, 3, 4, 5].map((i) => ({ i, heard: 'x', v: verdict, conf: 0.9 })) }, cost: 0.001, seconds: 1 };
      if (job === 'child_test.sa_questions') return { json: { questions: [{ id: 'ur.story_w3.q1', answer: 'x', verdict: 'correct', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
      return { json: {}, cost: 0, seconds: 0 };
    },
  };
}

describe('a W3 letters task: EGRA\'s first row', () => {
  test('ON, every letter wrong: stopped by rule, 0 correct', async () => {
    const got = await score.scoreRow(letters(), session(), { ...model('w'), stopRules: true });
    expect(got.ok).toBe(true);
    expect(got.marks.detail.stopped_by_rule).toBe(true);
    expect(got.marks.correct).toBe(0);
  });

  test('ON, one letter right: not stopped', async () => {
    const m = model('w');
    m.chatJSON = async ({ job }) => { m.jobs.push(job); return { json: { found: true, items: [1, 2, 3, 4, 5].map((i) => ({ i, heard: 'x', v: i === 3 ? 'c' : 'w', conf: 0.9 })) }, cost: 0, seconds: 1 }; };
    const got = await score.scoreRow(letters(), session(), { ...m, stopRules: true });
    expect(got.marks.detail.stopped_by_rule).toBe(false);
    expect(got.marks.correct).toBe(1);
  });

  test('OFF, every letter wrong: not flagged (today)', async () => {
    const got = await score.scoreRow(letters(), session(), { ...model('w'), stopRules: false });
    expect(got.marks.detail.stopped_by_rule).toBe(false);
  });
});

describe('comprehension after a passage the first-line rule stopped', () => {
  const stoppedPassage = { passages: new Map([['ur.story_w3', { stopped: true, pending: false }]]) };

  test('ON: every asked question not_reached, 0 correct, flagged, no model call', async () => {
    const m = model('w');
    const got = await score.scoreRow(comp(), session(stoppedPassage), { ...m, stopRules: true });
    expect(got.ok).toBe(true);
    expect(got.marks).toMatchObject({ task: 'ur.story_comp_w3', correct: 0, of: 2 });
    expect(got.marks.detail.stopped_by_rule).toBe(true);
    expect(got.marks.detail.items.map((i) => [i.id, i.verdict, i.stop_rule])).toEqual([
      ['ur.story_w3.q1', 'not_reached', true], ['ur.story_w3.q2', 'not_reached', true]]);
    expect(m.jobs).toEqual([]);
  });

  test('ON, the passage read past line 1: the questions are scored as usual', async () => {
    const m = model('w');
    const got = await score.scoreRow(comp(), session({ passages: new Map([['ur.story_w3', { stopped: false, pending: false }]]) }), { ...m, stopRules: true });
    expect(got.marks.correct).toBe(2);
    expect(got.marks.detail.stopped_by_rule).toBe(false);
  });

  test('OFF: scored as usual even after a stopped passage', async () => {
    const got = await score.scoreRow(comp(), session(stoppedPassage), { ...model('w'), stopRules: false });
    expect(got.marks.correct).toBe(2);
    expect(got.marks.detail.stopped_by_rule).toBe(false);
  });

  test('ON: questions wait while their passage is still being scored; OFF they do not', () => {
    const now = new Date('2026-10-22T05:40:00Z').getTime();
    const pending = { passages: new Map([['ur.story_w3', { stopped: false, pending: true }]]) };
    expect(score.ready(comp(), session({ ...pending, stopRules: true }), now)).toBe(false);
    expect(score.ready(comp(), session({ ...pending, stopRules: false }), now)).toBe(true);
    expect(score.ready(comp(), session({ passages: new Map([['ur.story_w3', { stopped: true, pending: false }]]), stopRules: true }), now)).toBe(true);
  });
});

describe('the sweep reads the session\'s passages (sa_stop_rules)', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
  afterEach(() => { process.env = { ...before }; });

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
  const passage = (marks) => ({
    id: 'row-passage', session_id: SID, block: 'ur.story_w3', response_mode: 'record', audio_r2_key: KEY('ur.story_w3'), audio_r2_keys: null,
    updated_at: '2026-10-22T05:33:00Z', responses: [],
    ...(marks ? { ai_status: 'scored', ai_reason: null, ai_marks: marks } : { ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null }),
  });
  const withClips = () => ({ ...comp(), audio_r2_keys: ['q1', 'q2'].map((q) => ({ i: `ur.story_w3.${q}`, key: KEY('ur.story_comp_w3', `ur.story_w3.${q}`) })) });

  test('ON: a passage stopped on line 1 → its questions are written not reached, no model call', async () => {
    const c = withClips();
    const m = model('w');
    const db = fakeDb({ child_test_blocks: [passage({ task: 'ur.story_w3', correct: 0, detail: { kind: 'passage', stopped_by_rule: true } }), c], child_test_sessions: [session()] });
    const out = await score.sweepOnce({ now: new Date('2026-10-22T05:40:00Z'), deps: { supabase: db, ...m, stopRules: true } });
    expect(out).toMatchObject({ scored: 1 });
    expect(c.ai_marks).toMatchObject({ task: 'ur.story_comp_w3', correct: 0, of: 2 });
    expect(c.ai_marks.detail.stopped_by_rule).toBe(true);
    expect(m.jobs).toEqual([]);
  });

  test('ON: the passage still parked → the questions wait this tick', async () => {
    const c = withClips();
    const db = fakeDb({ child_test_blocks: [{ ...passage(null), audio_r2_key: 'child-test/elsewhere/x.webm' }, c], child_test_sessions: [session()] });
    const out = await score.sweepOnce({ now: new Date('2026-10-22T05:40:00Z'), deps: { supabase: db, ...model('w'), stopRules: true } });
    expect(out).toMatchObject({ waiting: 1, scored: 0 });
    expect(c.ai_marks).toBeNull();
  });
});

describe('the results page names a task stopped by rule (sa_stop_rules)', () => {
  const sa = require('../../shared/services/child-test/app/sa-api.service'); // eslint-disable-line global-require
  const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
  const scoredComp = () => ({
    ...comp(), ai_status: 'scored', ai_reason: null, created_at: '2026-10-22T05:34:00Z',
    ai_marks: { version: 'sa-marks-v1', task: 'ur.story_comp_w3', correct: 0, of: 2, detail: { kind: 'questions', stopped_by_rule: true, items: [] } },
  });
  const deps = (on) => ({
    enabled: async () => true,
    store: {
      getSession: async () => ({ ok: true, session: { ...session(), coach_user_id: COACH, started_at: '2026-10-22T05:20:00Z' } }),
      listBlocks: async () => ({ ok: true, blocks: [scoredComp()] }),
    },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
    log: () => {}, logError: () => {},
    stopRules: on,
  });

  test('ON: stopReason is stopped_by_rule', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, deps(true));
    expect(out.status).toBe('ok');
    expect(out.tasks[0]).toMatchObject({ taskId: 'ur.story_comp_w3', stopReason: 'stopped_by_rule' });
  });

  test('OFF: the phone\'s own stop reason, as today', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, deps(false));
    expect(out.tasks[0].stopReason).toBe('complete');
  });
});
