'use strict';

/**
 * EGRA / EGMA stop rules at scoring time, as RWP ran them (panel RULING G-12, lead G-7 / G-8; sa_stop_rules, OFF by
 * default, off path unchanged):
 *  - comprehension is asked only if the passage's first line was not all wrong AND at least 10 words were attempted;
 *    otherwise every question is not reached, 0, flagged with why; scored both ways (out of 6, out of the asked);
 *  - multiplication counts only if at least one of the four + / − items was right; otherwise both × items are not
 *    reached, 0, flagged `gated`, with the raw marks kept for the report;
 *  - the short RDF tasks (5 letters, 4 words) carry no stop flag: a 0 there is "all wrong", not "stopped early";
 *  - the results page names the reason: comprehension / × not asked, EGRA vs EGMA, and the why of a first-row /
 *    first-line stop.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');

const ENV = { ...process.env };
beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; score.__internals.resetBoot(); });
afterEach(() => { process.env = { ...ENV }; });

const SID = 'cccccccc-0000-4000-8000-000000000040';
const PHONE_SID = 'dddddddd-0000-4000-8000-000000000040';
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


const parked = { ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null };
const sumRow = (block, correct) => ({ id: `row-${block}`, session_id: SID, block, ai_status: 'scored', ai_reason: null,
  ai_marks: { version: 'sa-marks-v1', task: block, correct, of: 2, detail: { kind: 'oral', stopped_by_rule: false, items: [] } } });
const mul = () => ({
  id: 'row-mul', session_id: SID, block: 'ma.mul2i', response_mode: 'record', ...parked,
  audio_r2_key: KEY('ma.mul2i'), audio_r2_keys: null, updated_at: '2026-10-22T05:36:00Z',
  responses: [{ kind: 'result', mode: 'record', task_id: 'ma.mul2i', recorded: true, session_id: PHONE_SID, time_used_ms: 9000, last_item_index: 1 }],
});
const oral = (v) => ({
  clipOf: async () => ({ base64: 'AAAA', durationSec: 4 }), model: () => 'google/gemini-test', jobs: [],
  chatJSON: async () => ({ json: { found: true, items: [{ i: 1, heard: '12', v, conf: 0.9 }, { i: 2, heard: '72', v, conf: 0.9 }] }, cost: 0.001, seconds: 1 }),
});
const words4 = () => ({ ...letters(), id: 'row-words', block: 'ur.words4', audio_r2_key: KEY('ur.words4'),
  responses: [{ kind: 'result', mode: 'record', task_id: 'ur.words4', recorded: true, attempted: 4, last_item_index: 3, session_id: PHONE_SID, time_used_ms: 20000 }] });

describe('RWP comprehension gate (G-12 §3): first line not all wrong AND at least 10 words attempted', () => {
  const pass = (attempted, stopped = false) => ({ passages: new Map([['ur.story_w3', { stopped, pending: false, attempted }]]) });

  test('ON, the passage read past line 1 but only 9 words attempted: every question not reached, 0, both scores kept, no model call', async () => {
    const m = model('w');
    const got = await score.scoreRow(comp(), session(pass(9)), { ...m, stopRules: true });
    expect(got.marks).toMatchObject({ correct: 0, of: 2 });
    expect(got.marks.detail).toMatchObject({ stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'under_10_words', of_all: 6, of_asked: 0 });
    expect(got.marks.detail.items.every((i) => i.verdict === 'not_reached' && i.stop_rule)).toBe(true);
    expect(m.jobs).toEqual([]);
  });

  test('ON, the passage stopped on line 1: the same, with the first-line reason', async () => {
    const got = await score.scoreRow(comp(), session(pass(11, true)), { ...model('w'), stopRules: true });
    expect(got.marks.detail).toMatchObject({ stop_detail: 'comprehension', stop_why: 'first_line' });
  });

  test('ON, 10 words attempted and line 1 fine: asked and scored, correct out of 6 and out of the asked', async () => {
    const got = await score.scoreRow(comp(), session(pass(10)), { ...model('w'), stopRules: true });
    expect(got.marks.correct).toBe(2);
    expect(got.marks.detail).toMatchObject({ stopped_by_rule: false, of_all: 6, of_asked: 2 });
  });

  test('OFF: 9 words attempted, scored as before (no both-ways fields)', async () => {
    const got = await score.scoreRow(comp(), session(pass(9)), { ...model('w'), stopRules: false });
    expect(got.marks.correct).toBe(2);
    expect(got.marks.detail).not.toHaveProperty('of_all');
  });

  test('the sweep puts the passage\'s attempted words in the map', async () => {
    const p = { id: 'row-p', session_id: SID, block: 'ur.story_w3', ai_status: 'scored', ai_reason: null,
      ai_marks: { task: 'ur.story_w3', correct: 3, attempted: 4, detail: { kind: 'passage', stopped_by_rule: false } } };
    const c = comp();
    const db = fakeDb({ child_test_blocks: [p, c], child_test_sessions: [session()] });
    const m = model('w');
    await score.sweepOnce({ now: new Date('2026-10-22T05:40:00Z'), deps: { supabase: db, ...m, stopRules: true } });
    expect(c.ai_marks.detail).toMatchObject({ stop_detail: 'comprehension', stop_why: 'under_10_words' });
    expect(m.jobs).toEqual([]);
  });
});

describe('the multiplication gate (G-12 §2): no + or − answer right → both × items not reached, 0, flagged; raw kept', () => {
  const sums = (add, sub) => ({ sums: { known: true, pending: false, right: add + sub > 0 } });

  test('ON, 0 of 4 sums right: gated, 0, the raw marks kept in detail', async () => {
    const got = await score.scoreRow(mul(), session(sums(0, 0)), { ...oral('c'), stopRules: true });
    expect(got.marks).toMatchObject({ correct: 0, of: 2 });
    expect(got.marks.detail).toMatchObject({ stop_detail: 'multiplication', gated: true, raw: { correct: 2, of: 2 } });
    expect(got.marks.detail.items.every((i) => i.verdict === 'not_reached' && i.gated && i.stop_rule)).toBe(true);
  });

  test('ON, 1 sum right: scored as usual', async () => {
    const got = await score.scoreRow(mul(), session(sums(1, 0)), { ...oral('c'), stopRules: true });
    expect(got.marks.correct).toBe(2);
    expect(got.marks.detail.gated).toBeUndefined();
  });

  test('OFF: never gated', async () => {
    const got = await score.scoreRow(mul(), session(sums(0, 0)), { ...oral('c'), stopRules: false });
    expect(got.marks.correct).toBe(2);
  });

  test('ON: × waits while a sums row is still being scored; never when the sums were not taken', () => {
    const now = Date.parse('2026-10-22T05:40:00Z');
    expect(score.ready(mul(), session({ stopRules: true, sums: { known: true, pending: true, right: false } }), now)).toBe(false);
    expect(score.ready(mul(), session({ stopRules: true, sums: { known: false, pending: false, right: false } }), now)).toBe(true);
    expect(score.ready(mul(), session({ stopRules: false, sums: { known: true, pending: true, right: false } }), now)).toBe(true);
  });

  test('the sweep reads the session\'s + and − marks and gates ×', async () => {
    const r = mul();
    const db = fakeDb({ child_test_blocks: [sumRow('ma.add2i', 0), sumRow('ma.sub2i', 0), r], child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-22T05:40:00Z'), deps: { supabase: db, ...oral('c'), stopRules: true } });
    expect(r.ai_marks).toMatchObject({ correct: 0, detail: { gated: true, raw: { correct: 2 } } });
  });
});

describe('no stop flag on the short RDF tasks (G-12 §4)', () => {
  test('ON, 5 letters all wrong: 0 correct, NOT stopped by rule', async () => {
    const got = await score.scoreRow(letters(), session(), { ...model('w'), stopRules: true });
    expect(got.marks.correct).toBe(0);
    expect(got.marks.detail.stopped_by_rule).toBe(false);
  });

  test('ON, 4 words all wrong: 0 correct, NOT stopped by rule', async () => {
    const m = model('w');
    m.chatJSON = async () => ({ json: { words: [1, 2, 3, 4].map((i) => ({ i, v: 'wrong' })) }, cost: 0, seconds: 1 });
    const got = await score.scoreRow(words4(), session(), { ...m, stopRules: true });
    expect(got.marks.correct).toBe(0);
    expect(got.marks.detail.stopped_by_rule).toBe(false);
  });
});

describe('the results page names why (sa_stop_rules)', () => {
  const sa = require('../../shared/services/child-test/app/sa-api.service'); // eslint-disable-line global-require
  const COACH = 'aaaaaaaa-0000-4000-8000-000000000041';
  const row = (block, detail) => ({ ...comp(), id: `r-${block}`, block, ai_status: 'scored', ai_reason: null, created_at: '2026-10-22T05:34:00Z',
    ai_marks: { version: 'sa-marks-v1', task: block, correct: 0, of: 2, detail: { kind: 'questions', items: [], ...detail } } });
  const deps = (blocks) => ({
    enabled: async () => true,
    store: {
      getSession: async () => ({ ok: true, session: { ...session(), coach_user_id: COACH, started_at: '2026-10-22T05:20:00Z' } }),
      listBlocks: async () => ({ ok: true, blocks }),
    },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
    log: () => {}, logError: () => {},
    stopRules: true,
  });

  test('comprehension not asked, × not asked, a grid stopped on row 1 (with its why), a maths stop says EGMA', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, deps([
      { ...row('ur.story_comp_w3', { stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'under_10_words' }), audio_r2_keys: [] },
      row('ma.mul2i', { stopped_by_rule: false, stop_detail: 'multiplication', gated: true }),
      row('ur.letters', { kind: 'grid', stopped_by_rule: true }),
      row('ma.missing', { kind: 'oral', stopped_by_rule: true }),
    ]));
    const by = Object.fromEntries(out.tasks.map((t) => [t.taskId, t]));
    expect(by['ur.story_comp_w3']).toMatchObject({ stopReason: 'comprehension_not_asked' });
    expect(by['ma.mul2i']).toMatchObject({ stopReason: 'multiplication_not_asked' });
    expect(by['ur.letters']).toMatchObject({ stopReason: 'stopped_by_rule', stopWhy: 'first_row' });
    expect(by['ma.missing']).toMatchObject({ stopReason: 'stopped_by_rule_egma' });
  });

  test('questions the child WAS asked (recorded) but the recording shows the reading stopped early: voided, not "not asked"', async () => {
    const asked = row('en.story_comp_w3', { stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'under_10_words' });
    const unasked = { ...row('ur.story_comp_w3', { stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'first_line' }), audio_r2_keys: [] };
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, deps([asked, unasked]));
    const by = Object.fromEntries(out.tasks.map((t) => [t.taskId, t]));
    expect(by['en.story_comp_w3']).toMatchObject({ stopReason: 'comprehension_voided' });
    expect(by['ur.story_comp_w3']).toMatchObject({ stopReason: 'comprehension_not_asked' });
  });
});
