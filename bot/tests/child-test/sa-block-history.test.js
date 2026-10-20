'use strict';

/**
 * The coach battery's block for a child, with the child's own history (app_settings sa_block_by_history, default
 * OFF): ON, a child gets the first block — from today's place in the rotation — that no other child of the visit
 * holds and that the child has not already taken at this school (any cycle). OFF, today's rotation alone, as before.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const BLOCKS = ['B1', 'B2', 'B3', 'B4', 'B5'];
const NOW = new Date('2026-10-21T05:00:00Z');
const START = Math.floor((NOW.getTime() + PKT_OFFSET_MS) / DAY_MS) % 5;
const at = (k) => BLOCKS[(START + k) % 5];
// a task of each block of the coach form (coach.G3.A)
const TASK_OF = { B1: 'ur.letters', B2: 'en.letters', B3: 'ur.listening', B4: 'ma.number_id', B5: 'ma.add1' };

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID = 'sess-now';

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

/**
 * Asha Testwala (student st-1) took `past` blocks in an earlier session at this school; Bilal Testwala (st-2), not on
 * this visit, took `otherPast`; `mates` are blocks other children of this visit already hold.
 */
function world({ past = [], otherPast = [], mates = [], on, heldBlock = null, pastCycle = 'ICT-2026-Q4' } = {}) {
  const sessions = {
    [SID]: { id: SID, coach_user_id: COACH, draw_id: 'd-now', visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: {} },
    'sess-old': { id: 'sess-old', coach_user_id: COACH, draw_id: 'd-old', grade: 3, form: 'A', item_bank_version: 'sa-battery', device: { block: past[0] || null } },
    'sess-other': { id: 'sess-other', coach_user_id: COACH, draw_id: 'd-other', grade: 3, form: 'A', item_bank_version: 'sa-battery', device: { block: otherPast[0] || null } },
  };
  const bySession = { 'sess-old': past.map((b) => ({ block: TASK_OF[b] })), 'sess-other': otherPast.map((b) => ({ block: TASK_OF[b] })) };
  const draws = {
    'd-now': { id: 'd-now', cycle_id: 'ICT-2026-Q4', school_id: SCHOOL, student_id: 'st-1', status: 'tested' },
    'd-old': { id: 'd-old', cycle_id: pastCycle, school_id: SCHOOL, student_id: 'st-1', status: 'tested' },
    'd-other': { id: 'd-other', cycle_id: 'ICT-2026-Q4', school_id: SCHOOL, student_id: 'st-2', status: 'tested' },
  };
  const mateSessions = mates.map((b, i) => ({ id: `mate-${i}`, draw_id: `dm-${i}`, device: { block: b } }));
  const calls = { setClient: [], markSynced: [] };
  const store = {
    getSession: async (id) => ({ ok: true, session: sessions[id] || null }),
    getDraw: async (id) => ({ ok: true, draw: draws[id] || null }),
    listSchoolDraws: async (school, cycle) => ({ ok: true, draws: Object.values(draws).filter((d) => d.school_id === school && d.cycle_id === cycle) }),
    listTestedDraws: async (school) => ({ ok: true, draws: Object.values(draws).filter((d) => d.school_id === school && d.status === 'tested') }),
    getSessionByDraw: async (drawId) => ({ ok: true, session: Object.values(sessions).find((s) => s.draw_id === drawId) || null }),
    listBlocks: async (id) => ({ ok: true, blocks: bySession[id] || [] }),
    listSessionsForVisit: async () => ({ ok: true, sessions: [sessions[SID], ...mateSessions] }),
    createSession: async () => ({ ok: true, session: sessions[SID], created: true }),
    recordTiming: async () => ({ ok: true }),
  };
  const saStore = {
    findByClient: async () => ({ ok: true, sessionId: null }),
    setClient: async (id, v) => { calls.setClient.push(v); return { ok: true }; },
    summary: async () => ({ ok: true, block: heldBlock }),
    markSynced: async (id, v) => { calls.markSynced.push(v); return { ok: true, device: { block: v.block } }; },
  };
  const draw = { markOutcome: async () => ({ ok: true, list: null }) };
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store, saStore, draw,
    now: () => NOW,
    log: () => {}, logError: () => {},
    ...(on === undefined ? {} : { blockByHistory: on }),
  };
  return { deps, calls };
}

const present = (deps, block) => sa.dayOutcome({
  userId: COACH, schoolId: SCHOOL, drawId: 'd-now', outcome: 'present', clientSessionId: '11111111-2222-4333-8444-555555555555', block,
}, deps);

describe('the battery the server picks', () => {
  test('switch ON: a child who took today\'s first block earlier gets the next one', async () => {
    const { deps, calls } = world({ past: [at(0)], on: true });
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.status).toBe('ok');
    expect(out.battery.block).toBe(at(1));
    expect(calls.markSynced[0]).toEqual({ block: at(1) });
  });

  test('switch ON: a block the child took in an earlier cycle at this school is skipped too (a returning child)', async () => {
    const { deps } = world({ past: [at(0)], pastCycle: 'ICT-2026-Q3', on: true });
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.battery.block).toBe(at(1));
  });

  test('switch ON: skips both the child\'s past blocks and the blocks other children of the visit hold', async () => {
    const { deps } = world({ past: [at(0)], mates: [at(1)], on: true });
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.battery.block).toBe(at(2));
  });

  test('switch ON: another child\'s history is not this child\'s', async () => {
    const { deps } = world({ otherPast: [at(0)], on: true });
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.battery.block).toBe(at(0));
  });

  test('switch ON: a child who has taken every block falls back to today\'s rotation', async () => {
    const { deps } = world({ past: BLOCKS.slice(), mates: [at(0)], on: true });
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.battery.block).toBe(at(1));
  });

  test('switch OFF: today\'s rotation only, the history unread', async () => {
    const { deps } = world({ past: [at(0)], on: false });
    deps.store.listSchoolDraws = async () => { throw new Error('history read with the switch off'); };
    deps.store.listTestedDraws = deps.store.listSchoolDraws;
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.battery.block).toBe(at(0));
  });
});

describe('present, with the phone\'s block', () => {
  test('switch ON: a phone block the child already took is replaced, and the answer says which block', async () => {
    const { deps, calls } = world({ past: [at(0)], on: true });
    const out = await present(deps, at(0));
    expect(out.status).toBe('ok');
    expect(out.block).toBe(at(1));
    expect(calls.setClient[0].block).toBe(at(1));
  });

  test('switch ON: a phone block the child has not taken stands', async () => {
    const { deps, calls } = world({ past: [at(0)], on: true });
    const out = await present(deps, at(2));
    expect(out.block).toBe(at(2));
    expect(calls.setClient[0].block).toBe(at(2));
  });

  test('switch ON: the whole battery stands', async () => {
    const { deps, calls } = world({ past: [at(0)], on: true });
    const out = await present(deps, 'full');
    expect(out.block).toBe('full');
    expect(calls.setClient[0].block).toBe('full');
  });

  test('switch OFF: the phone\'s block is kept and the answer is today\'s', async () => {
    const { deps, calls } = world({ past: [at(0)], on: false });
    const out = await present(deps, at(0));
    expect(out).toEqual({ status: 'ok', sessionId: SID, list: null });
    expect(calls.setClient[0].block).toBe(at(0));
  });
});

describe('the switch', () => {
  const load = (rows, error = null) => {
    jest.resetModules();
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }),
    }));
    return require('../../shared/services/child-test/app/block-history');
  };
  afterEach(() => { jest.dontMock('../../shared/config/supabase'); jest.resetModules(); });

  test('is on for JSON true only', async () => {
    expect(await load([{ key: 'sa_block_by_history', value: true }]).on()).toBe(true);
    expect(await load([{ key: 'sa_block_by_history', value: 'true' }]).on()).toBe(false);
    expect(await load([]).on()).toBe(false);
  });

  test('fails closed on a read error', async () => {
    expect(await load(null, { message: 'down' }).on()).toBe(false);
  });
});
