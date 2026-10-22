'use strict';

/**
 * sa_stop_rules ON deadlocked the scorer: the session's passage map took every unscored parked row (not only
 * passages), and a row whose block is not a `_comp` looked itself up in that map, so each parked row, the passage
 * included, waited for its own marks and none was ever scored ({ found: 50, waiting: 50 }). Now only passage blocks are
 * in the map, and a row never waits on itself: the passage and a grid are scored at once, and the questions after the
 * passage wait for the passage's marks, then are scored on a later sweep.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000030';
const PHONE_SID = 'dddddddd-0000-4000-8000-000000000030';
const KEY = (t, i) => `child-test/sandbox/sch-1/${SID}/sa/${t}${i ? `__${i}` : ''}.webm`;
const session = (over = {}) => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T05:35:24Z', ...over });
const parked = { ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null };

const letters = () => ({
  id: 'row-letters', session_id: SID, block: 'ur.letter_names5', response_mode: 'record', ...parked,
  audio_r2_key: KEY('ur.letter_names5'), audio_r2_keys: null, updated_at: '2026-10-22T05:31:00Z',
  responses: [{ kind: 'result', mode: 'record', task_id: 'ur.letter_names5', recorded: true, attempted: 5, last_item_index: 4, session_id: PHONE_SID, time_used_ms: 30000 }],
});
const passage = () => ({
  id: 'row-passage', session_id: SID, block: 'ur.story_w3', response_mode: 'record', ...parked,
  audio_r2_key: KEY('ur.story_w3'), audio_r2_keys: null, updated_at: '2026-10-22T05:32:00Z',
  responses: [{ kind: 'result', mode: 'record', task_id: 'ur.story_w3', recorded: true, session_id: PHONE_SID, time_used_ms: 60000, last_word_index: 20 }],
});
const comp = () => ({
  id: 'row-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ...parked,
  audio_r2_key: null, audio_r2_keys: ['q1', 'q2'].map((q) => ({ i: `ur.story_w3.${q}`, key: KEY('ur.story_comp_w3', `ur.story_w3.${q}`) })),
  updated_at: '2026-10-22T05:34:00Z',
  responses: [{ kind: 'result', mode: 'oral', asked: ['ur.story_w3.q1', 'ur.story_w3.q2'], task_id: 'ur.story_comp_w3', recorded: true, attempted: 2, session_id: PHONE_SID, time_used_ms: 9000 }],
});

function model() {
  const jobs = [];
  return {
    jobs,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 4, key }),
    model: () => 'google/gemini-test',
    chatJSON: async ({ job }) => {
      jobs.push(job);
      if (job === 'child_test.sa_letters') return { json: { found: true, items: [1, 2, 3, 4, 5].map((i) => ({ i, heard: 'x', v: 'c', conf: 0.9 })) }, cost: 0.001, seconds: 1 };
      if (job === 'child_test.sa_story') return { json: { words: Array.from({ length: 21 }, (_, k) => ({ i: k + 1, v: 'correct' })) }, cost: 0.001, seconds: 1 };
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

describe('sa_stop_rules ON: no row waits on itself', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  test('ready(): a parked passage (or grid) in the passage map is not held by its own pending entry', () => {
    const now = Date.parse('2026-10-22T05:40:00Z');
    const map = new Map([['ur.story_w3', { stopped: false, pending: true }], ['ur.letter_names5', { stopped: false, pending: true }]]);
    expect(score.ready(passage(), session({ stopRules: true, passages: map }), now)).toBe(true);
    expect(score.ready(letters(), session({ stopRules: true, passages: map }), now)).toBe(true);
    expect(score.ready(comp(), session({ stopRules: true, passages: map }), now)).toBe(false);
  });

  test('sweep 1 scores the passage and the grid while the questions wait; sweep 2 scores the questions', async () => {
    const rows = [passage(), comp(), letters()];
    const [p, c, l] = rows;
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    const m = model();
    const first = await score.sweepOnce({ now: new Date('2026-10-22T05:40:00Z'), deps: { supabase: db, ...m, stopRules: true } });
    expect(first).toMatchObject({ found: 3, scored: 2, waiting: 1 });
    expect(p.ai_status).toBe('scored');
    expect(l.ai_status).toBe('scored');
    expect(c.ai_marks).toBeNull();
    const second = await score.sweepOnce({ now: new Date('2026-10-22T05:40:20Z'), deps: { supabase: db, ...m, stopRules: true } });
    expect(second).toMatchObject({ scored: 1, waiting: 0 });
    expect(c.ai_status).toBe('scored');
    expect(c.ai_marks).toMatchObject({ task: 'ur.story_comp_w3', of: 2 });
    expect(c.ai_marks.detail.stopped_by_rule).toBe(false);
    expect(rows.every((r) => r.ai_status === 'scored')).toBe(true);
  });
});
