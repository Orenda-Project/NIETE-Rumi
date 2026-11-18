'use strict';

/**
 * Round 28 (sa_r28_mcq): the spoken comprehension questions (the story MCQ, picked from four) take the same reading
 * floor as the oral questions. The scorer applies the oral path's own gate (compGate: the passage stopped on its first
 * line, or fewer than 10 words attempted) to the MCQ's result: a gated MCQ reads not reached, 0 of its questions, with
 * the phone's answers kept in the marks' detail; an ungated one keeps the phone's marks, marked as checked. With the
 * switch ON the store does not mark the MCQ row at sync (marks are written once), so the scorer can. Fixtures are synthetic.
 */

jest.mock('../../shared/config/supabase', () => {
  const rows = [];
  const api = {
    rows,
    from() {
      const f = []; let patch = null; let ins = null;
      const q = {
        select() { return q; }, limit() { return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        insert(x) { ins = x; return q; },
        update(x) { patch = x; return q; },
        then(ok, bad) {
          if (ins) { const r = { id: `row-${rows.length + 1}`, ai_marks: null, responses: null, ...ins }; rows.push(r); return Promise.resolve({ data: [r], error: null }).then(ok, bad); }
          const hit = rows.filter((r) => f.every((fn) => fn(r)));
          if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit, error: null }).then(ok, bad); }
          return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(ok, bad);
        },
      };
      return q;
    },
  };
  return api;
});

const store = require('../../shared/services/child-test/sa-store');
const score = require('../../shared/services/child-test/sa/score');
const level = require('../../shared/services/child-test/sa/level');
const mcqSwitch = require('../../shared/services/child-test/app/mcq-switch');
const memDb = require('../../shared/config/supabase');

const SID = 'cccccccc-0000-4000-8000-0000000000b7';
const QS = [1, 2, 3, 4, 5, 6].map((n) => `ur.story_w3.q${n}`);

/** The phone's MCQ result: `right` of the asked questions right, the rest wrong (as sa-core finish() writes it). */
function mcqResult(right, extra = {}) {
  const asked = extra.asked || QS;
  return {
    task_id: 'ur.story_mcq_w3', mode: 'tap', attempted: asked.length, correct: right, incorrect: asked.length - right,
    options_n: 4, of_all: 6, presented: asked.length, asked, stop_reason: 'complete', scored_on: 'phone', per_minute: null,
    answers: asked.map((id, i) => ({ item_id: id, value: i < right ? 1 : 2, ok: i < right })),
    ...extra,
  };
}

/** The MCQ row as the store keeps it (result + answers in responses), parked for the scorer. */
function mcqRow(right, extra = {}) {
  const { answers, ...summary } = mcqResult(right, extra);
  return {
    id: 'row-mcq', session_id: SID, block: 'ur.story_mcq_w3', response_mode: 'tap', ai_status: 'failed', ai_reason: 'final:sa_score_later',
    ai_marks: null, audio_r2_key: null, audio_r2_keys: null, updated_at: '2026-11-18T10:01:00Z',
    responses: [{ kind: 'result', ...summary }, ...answers.map((a) => ({ kind: 'answer', ...a }))],
  };
}

const passages = (p) => new Map([['ur.story_w3', { pending: false, ...p }]]);
const session = (p) => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-18T10:00:00Z', passages: passages(p) });
const ON = { mcq: true };

describe('sa_r28_mcq: the MCQ takes the oral questions\' reading floor (score.js)', () => {
  test('(1) a passage stopped on its first line + a 6/6 MCQ → not reached, 0 of 6, first_line, the answers kept', async () => {
    const got = await score.scoreRow(mcqRow(6), session({ stopped: true, attempted: 30 }), ON);
    expect(got.ok).toBe(true);
    const m = got.marks;
    expect(m).toMatchObject({ task: 'ur.story_mcq_w3', correct: 0, of: 6, tap_correct: 0, tap_attempted: 6, options_n: 4, chance_corrected: 0 });
    expect(m.meta.cost_usd).toBe(0);
    expect(m.detail).toMatchObject({ kind: 'mcq', stopped_by_rule: true, stop_detail: 'comprehension', stop_why: 'first_line', gated: true, of_all: 6, of_asked: 0 });
    expect(m.detail.items).toHaveLength(6);
    expect(m.detail.items.every((r) => r.verdict === 'not_reached' && r.stop_rule === true && r.gated === true && r.heard === '')).toBe(true);
    expect(m.detail.items.map((r) => r.raw_verdict)).toEqual(Array(6).fill('correct'));
    expect(m.detail.raw).toMatchObject({ tap_correct: 6, tap_attempted: 6 });
    expect(m.detail.raw.answers).toHaveLength(6);
  });

  test('(1b) the store, switch ON: a phone-scored MCQ is parked for the scorer, not marked at sync', async () => {
    memDb.rows.length = 0;
    const out = await store.putResults(SID, [mcqResult(6)], 'ur', ON);
    expect(out.ok).toBe(true);
    const r = memDb.rows.find((x) => x.block === 'ur.story_mcq_w3');
    expect(r.ai_marks).toBeNull();
    expect(r).toMatchObject({ ai_status: 'failed', ai_reason: 'final:sa_score_later', response_mode: 'tap' });
  });

  test('(2) a passage of 7 words attempted + a 4/6 MCQ → under_10_words, the phone\'s 4 kept in raw', async () => {
    const { marks } = await score.scoreRow(mcqRow(4), session({ stopped: false, attempted: 7 }), ON);
    expect(marks).toMatchObject({ correct: 0, of: 6, tap_correct: 0 });
    expect(marks.detail).toMatchObject({ stop_why: 'under_10_words', gated: true, of_asked: 0 });
    expect(marks.detail.raw.tap_correct).toBe(4);
    expect(marks.detail.items.map((r) => r.raw_verdict)).toEqual(['correct', 'correct', 'correct', 'correct', 'wrong', 'wrong']);
  });

  test('(3) a passage of 23 words, not stopped + a 4/6 MCQ → the phone\'s marks stand, gate_checked', async () => {
    const { marks } = await score.scoreRow(mcqRow(4), session({ stopped: false, attempted: 23 }), ON);
    expect(marks).toMatchObject({ tap_correct: 4, tap_attempted: 6, correct: 4, of: 6, options_n: 4 });
    expect(marks.detail).toMatchObject({ kind: 'mcq', gate_checked: true, stop_why: null, of_all: 6, of_asked: 6 });
    expect(marks.detail.gated).toBeUndefined();
  });

  test('(5) passageOf maps _mcq as _comp; a passage and a _comp block unchanged', () => {
    const { passageOf } = score.__internals;
    expect(passageOf('ur.story_mcq_w3')).toBe('ur.story_w3');
    expect(passageOf('en.story_mcq_w3')).toBe('en.story_w3');
    expect(passageOf('ur.story_w3')).toBe('ur.story_w3');
    expect(passageOf('ur.story_comp_w3')).toBe('ur.story_w3');
    expect(passageOf('ur.story_comp')).toBe('ur.story');
  });

  test('(5b) ready(): the MCQ waits while its passage is being scored; ready once the passage has marks', () => {
    const now = Date.parse('2026-11-18T10:05:00Z');
    const s = (p) => ({ ...session(p), mcqFloor: true });
    expect(score.ready(mcqRow(6), s({ pending: true, stopped: false, attempted: null }), now)).toBe(false);
    expect(score.ready(mcqRow(6), s({ pending: false, stopped: true, attempted: 30 }), now)).toBe(true);
  });

  test('(4b) a passage whose recording has not arrived yet is awaited, until the session ended a while ago', async () => {
    const rows = [
      { block: 'ur.story_w3', ai_marks: null, ai_status: 'pending', ai_reason: null },
      { block: 'ur.story_mcq_w3', ai_marks: null, ai_status: 'failed', ai_reason: 'final:sa_score_later' },
    ];
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) };
    const got = await score.__internals.passagesOf(SID, db);
    expect(got.get('ur.story_w3')).toMatchObject({ pending: true, unparked: true });
    const s = { ...session(), passages: got, mcqFloor: true };   // the session ended 10:00
    const t = (iso) => Date.parse(`2026-11-18T${iso}Z`);
    // the MCQ row arrived before the session's end: the wait runs to the end + 2 min
    const early = { ...mcqRow(6), updated_at: '2026-11-18T09:50:00Z' };
    expect(score.ready(early, s, t('10:01:00'))).toBe(false);
    expect(score.ready(early, s, t('10:02:30'))).toBe(true);
    // an offline session synced hours later: the wait runs from the row's arrival, not the long-past end
    const late = { ...mcqRow(6), updated_at: '2026-11-18T15:00:00Z' };
    expect(score.ready(late, s, t('15:01:00'))).toBe(false);
    expect(score.ready(late, s, t('15:02:30'))).toBe(true);
  });

  test('(8) a lost-clip unrated MCQ + a gated passage → stays unrated: marked from the phone at sync, never gated', async () => {
    memDb.rows.length = 0;
    const lost = mcqResult(2, { asked: QS.slice(0, 3), unavailable: 3, unrated: true });
    await store.putResults(SID, [lost], 'ur', ON);
    const r = memDb.rows.find((x) => x.block === 'ur.story_mcq_w3');
    expect(r).toMatchObject({ ai_status: 'scored', ai_marks: { tap_correct: 2, tap_attempted: 3 } });
    // the scorer, given the row anyway, leaves the phone's count and adds no gate
    const got = await score.scoreRow({ ...mcqRow(2, { asked: QS.slice(0, 3), unavailable: 3, unrated: true }) }, session({ stopped: true, attempted: 30 }), ON);
    expect(got.ok).toBe(true);
    expect(got.marks.tap_correct).toBe(2);
    expect(got.marks.detail.stop_why).toBeUndefined();
    expect(got.marks.detail.gated).toBeUndefined();
  });
});

describe('sa_r28_mcq: order independence (the MCQ synced before vs after its passage\'s marks)', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; score.__internals.resetBoot(); });
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
          const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
          if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
          const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
          return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
        },
      };
      return q;
    }
    return { from: query };
  }
  const sess = { id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-18T10:00:00Z', coach_user_id: null };
  const passageMarks = { version: 'sa-marks-v1', task: 'ur.story_w3', correct: 2, attempted: 30, detail: { kind: 'passage', stopped_by_rule: true } };
  const passageParked = () => ({ id: 'row-p', session_id: SID, block: 'ur.story_w3', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null, audio_r2_key: 'child-test/elsewhere/p.webm', updated_at: '2026-11-18T10:01:00Z', responses: [{ kind: 'result', mode: 'record' }] });
  const at = new Date('2026-11-18T10:05:00Z');
  const strip = (m) => { const { meta, ...rest } = m; return rest; };

  test('(4) MCQ first, passage scored later → the same final marks as MCQ after the passage', async () => {
    // A: the MCQ is in the queue while its passage is still being scored (by another environment's sweep: its
    // recording's prefix is not this one's, so this sweep never takes it; the passage's own scorer is not under test)
    const pA = passageParked();
    const mA = mcqRow(6);
    const dbA = fakeDb({ child_test_blocks: [pA, mA], child_test_sessions: [sess], app_settings: [] });
    const first = await score.sweepOnce({ sessionId: SID, now: at, deps: { supabase: dbA, mcq: true } });
    expect(first.waiting).toBe(1);
    expect(mA.ai_marks).toBeNull();
    Object.assign(pA, { ai_marks: passageMarks, ai_status: 'scored', ai_reason: null });
    await score.sweepOnce({ sessionId: SID, now: at, deps: { supabase: dbA, mcq: true } });
    // B: the passage already has its marks when the MCQ is swept
    const pB = { ...passageParked(), ai_marks: passageMarks, ai_status: 'scored', ai_reason: null };
    const mB = mcqRow(6);
    const dbB = fakeDb({ child_test_blocks: [pB, mB], child_test_sessions: [sess], app_settings: [] });
    await score.sweepOnce({ sessionId: SID, now: at, deps: { supabase: dbB, mcq: true } });
    expect(mA.ai_marks).not.toBeNull();
    expect(strip(mA.ai_marks)).toEqual(strip(mB.ai_marks));
    expect(mB).toMatchObject({ ai_status: 'scored', ai_marks: { tap_correct: 0, detail: { stop_why: 'first_line' } } });
  });

  test('(4c) candidates(): a parked MCQ row with no recording is admitted, the switch ON or OFF (the park is the proof it was ON at sync)', async () => {
    const m = mcqRow(6);
    const db = fakeDb({ child_test_blocks: [m] });
    const on = await score.__internals.candidates({ sessionId: SID, now: at, supabase: db, mcqFloor: true });
    const off = await score.__internals.candidates({ sessionId: SID, now: at, supabase: db });
    expect(on.map((r) => r.block)).toEqual(['ur.story_mcq_w3']);
    expect(off.map((r) => r.block)).toEqual(['ur.story_mcq_w3']);
    // a phone-marked MCQ (synced OFF, or before the floor) is never a candidate: its marks stand
    const marked = { ...mcqRow(6), ai_status: 'scored', ai_reason: null, ai_marks: { tap_correct: 6, tap_attempted: 6 } };
    expect(await score.__internals.candidates({ sessionId: SID, now: at, supabase: fakeDb({ child_test_blocks: [marked] }), mcqFloor: true })).toEqual([]);
  });

  test('(a) parked ON, the switch flipped OFF before the sweep → still scored, behind its passage, through the floor', async () => {
    const p = passageParked();
    const m = mcqRow(6);
    const db = fakeDb({ child_test_blocks: [p, m], child_test_sessions: [sess], app_settings: [] });
    const first = await score.sweepOnce({ sessionId: SID, now: at, deps: { supabase: db, mcq: false } });
    expect(first.waiting).toBe(1);
    expect(m.ai_marks).toBeNull();
    Object.assign(p, { ai_marks: passageMarks, ai_status: 'scored', ai_reason: null });
    await score.sweepOnce({ sessionId: SID, now: at, deps: { supabase: db, mcq: false } });
    expect(m).toMatchObject({ ai_status: 'scored', ai_marks: { tap_correct: 0, detail: { stop_why: 'first_line', gated: true } } });
  });
});

describe('sa_r28_mcq: the ladder reads a gated MCQ as unmet (level.js)', () => {
  const spoken = (block, marks) => ({ block, response_mode: 'record', lang: 'ur', ai_status: 'scored', ai_marks: marks, responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete' }] });
  const below = () => [spoken('ur.letter_names5', { correct: 5, attempted: 5 }), spoken('ur.words4', { correct: 4, attempted: 4 }), spoken('ur.story_w3', { correct: 30, attempted: 32 })];
  const ITEMS = { 'ur.letter_names5': 5, 'ur.words4': 4, 'ur.story_mcq_w3': 6 };
  test('(7) the scorer\'s gated marks on a 6/6 MCQ → comprehension unmet, the level the rung below, not pending', async () => {
    const { marks } = await score.scoreRow(mcqRow(6), session({ stopped: true, attempted: 30 }), ON);
    const row = { ...mcqRow(6), ai_status: 'scored', ai_reason: null, ai_marks: marks };
    const ur = level.levelsOf([...below(), row], [], { itemsOf: (id) => ITEMS[id] ?? null }).find((x) => x.subject === 'ur');
    expect(ur).toMatchObject({ level: 'story', pending: false });
  });
});

describe('sa_r28_mcq OFF: nothing changes', () => {
  test('(6) the store, switch OFF: the MCQ is marked from the phone at sync, as today', async () => {
    memDb.rows.length = 0;
    await store.putResults(SID, [mcqResult(5)], 'ur', { mcq: false });
    const r = memDb.rows.find((x) => x.block === 'ur.story_mcq_w3');
    expect(r).toMatchObject({ ai_status: 'scored', ai_marks: { tap_correct: 5, tap_attempted: 6, options_n: 4 } });
  });
  test('(b) synced in an OFF window → the phone\'s marks at sync; read as scored (gate unchecked) with the floor ON', async () => {
    memDb.rows.length = 0;
    await store.putResults(SID, [mcqResult(6)], 'ur', { mcq: false });
    const r = memDb.rows.find((x) => x.block === 'ur.story_mcq_w3');
    expect(r).toMatchObject({ ai_status: 'scored', ai_marks: { tap_correct: 6 } });
    expect(r.ai_marks.detail).toBeUndefined();
    const spoken = (block, marks) => ({ block, response_mode: 'record', lang: 'ur', ai_status: 'scored', ai_marks: marks, responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete' }] });
    const rows = [spoken('ur.letter_names5', { correct: 5, attempted: 5 }), spoken('ur.words4', { correct: 4, attempted: 4 }), spoken('ur.story_w3', { correct: 30, attempted: 32 }), { ...r }];
    const ur = level.levelsOf(rows, [], { itemsOf: (id) => ({ 'ur.letter_names5': 5, 'ur.words4': 4, 'ur.story_mcq_w3': 6 })[id] ?? null, mcqFloor: true }).find((x) => x.subject === 'ur');
    expect(ur).toMatchObject({ level: 'comprehension', pending: false });
  });
  test('(6) a session with no _mcq row: ready() for a _comp row and a passage row as today', () => {
    const now = Date.parse('2026-11-18T10:05:00Z');
    const comp = { ...mcqRow(0), block: 'ur.story_comp_w3', response_mode: 'oral', audio_r2_key: 'child-test/sandbox/c.webm' };
    const s = { ...session({ pending: true }), stopRules: true };
    expect(score.ready(comp, s, now)).toBe(false);
    expect(score.ready(comp, { ...s, stopRules: false }, now)).toBe(true);
  });
  test('(6) passagesOf with no _mcq row: the same map as before (a parked passage its _comp follows; no unparked key)', async () => {
    const rows = [
      { block: 'ur.story_w3', ai_marks: null, ai_status: 'failed', ai_reason: 'final:sa_score_later' },
      { block: 'en.story_w3', ai_marks: null, ai_status: 'pending', ai_reason: null },
      { block: 'ur.story_comp_w3', ai_marks: null, ai_status: 'failed', ai_reason: 'final:sa_score_later' },
      { block: 'en.story_comp_w3', ai_marks: null, ai_status: 'failed', ai_reason: 'final:sa_score_later' },
      { block: 'ur.words4', ai_marks: null, ai_status: 'failed', ai_reason: 'final:sa_score_later' },
    ];
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) };
    const got = await score.__internals.passagesOf(SID, db);
    expect([...got.entries()]).toEqual([['ur.story_w3', { stopped: false, pending: true, attempted: null }]]);
  });
  test('the switch module: a test\'s mcq wins; only JSON true is on', async () => {
    expect(mcqSwitch.KEY).toBe('sa_r28_mcq');
    expect(await mcqSwitch.enabled({ mcq: true })).toBe(true);
    expect(await mcqSwitch.enabled({ mcq: 'true' })).toBe(false);
  });
});
