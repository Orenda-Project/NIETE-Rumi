'use strict';
/**
 * FICO6 fix-shadow (bd-qix9oh.241): the DC v6 read is stored however late it lands.
 *
 * settle() waits GRACE_MS for the v6 read beside V3; a slower reply was stored as status 'timeout' and the real one
 * dropped. storeLate() now puts the real one in that place when it lands (analysis_data.shadow.fico17_v6, or
 * dc.fico17_v6 on switch 'v6'): that key only, never over a newer result, never over another writer.
 *
 * Real: shadow.js start/settle/patch/storeLate, the late write. Mocked at the boundary: the database (in memory, with
 * the updated_at trigger), the logger, the model call (analyzePedagogy), the switch.
 */
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
let mockTick = 0;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const b = mockFake.from(table);
    const update = b.update;
    b.update = (values) => { mockTick += 1; return update({ ...values, updated_at: `2026-11-11T16:00:${String(mockTick).padStart(2, '0')}.000000+00:00` }); };
    return b;
  },
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/fico-rubric-switch', () => ({
  isAnySet: jest.fn(() => Promise.resolve(true)),
  regionOfUser: jest.fn(() => Promise.resolve('Sihala')),
  dcRubric: jest.fn(() => Promise.resolve(global.__DC)),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn() }));

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const Shadow = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');
const LateWrite = require('../../bot/shared/services/coaching/frameworks/fico17-v6/late-write');

const TRANSCRIPT = Array.from({ length: 40 }, (_, i) => `[${String(i).padStart(2, '0')}:30] Teacher (EN): Line ${i} of the lesson about plants and water.`).join('\n\n');
const session = () => mockFake.__tables.coaching_sessions[0];
const copy = (v) => JSON.parse(JSON.stringify(v));
const noWait = { sleep: () => Promise.resolve() };

// What the analysis write leaves: V3's own analysis and the timeout blob settle() returned in the v6 read's place.
function analysed(timedOut) {
  mockFake.__tables.coaching_sessions = [{
    id: 'sess-1', status: 'analysis_complete', updated_at: '2026-11-11T15:59:00.000000+00:00',
    analysis_data: { framework: 'fico', domains: { a: 1 }, scores: { overall_percentage: 61 }, ...Shadow.patch(timedOut) },
  }];
  return copy(session().analysis_data);
}

let release;
beforeEach(() => {
  jest.clearAllMocks();
  mockTick = 0;
  mockFake = createFakeSupabase({});
  global.__DC = 'shadow';
  // The v6 read: a reply that will not validate is enough here (status 'invalid' is a real, stored result).
  GPT5MiniService.analyzePedagogy.mockImplementation(() => new Promise((r) => { release = () => r({ analysis: { levels: {} }, usage: null }); }));
});

async function lateRun({ mode = 'shadow' } = {}) {
  global.__DC = mode;
  const task = Shadow.start({ session: { id: 'sess-1', user_id: 'u1', users: { region: 'Sihala' } }, metadata: { duration: 2400 }, frameworkKey: 'fico', transcript: TRANSCRIPT });
  const timedOut = await Shadow.settle(task, 5); // the grace runs out before the reply
  return { task, timedOut };
}

describe('a DC v6 read slower than the grace', () => {
  test("'shadow': the real result replaces the timeout blob in shadow.fico17_v6; V3 is byte-identical", async () => {
    const { task, timedOut } = await lateRun();
    expect(timedOut).toMatchObject({ status: 'timeout', mode: 'shadow' });
    const before = analysed(timedOut);
    release();
    const res = await Shadow.storeLate(task, timedOut, 'sess-1', noWait);
    expect(res).toMatchObject({ ok: true, written: true });
    const ad = session().analysis_data;
    expect(ad.shadow.fico17_v6).toMatchObject({ status: 'invalid', rubric: 'fico17_v6', mode: 'shadow', late: true });
    const { shadow: _s, ...v3 } = copy(ad);
    const { shadow: _b, ...v3Before } = before;
    expect(JSON.stringify(v3)).toBe(JSON.stringify(v3Before));
    expect(ad).not.toHaveProperty('dc');
    expect(session().status).toBe('analysis_complete');
  });

  test("'v6': it lands in dc.fico17_v6", async () => {
    const { task, timedOut } = await lateRun({ mode: 'v6' });
    analysed(timedOut);
    release();
    await Shadow.storeLate(task, timedOut, 'sess-1', noWait);
    expect(session().analysis_data.dc.fico17_v6).toMatchObject({ status: 'invalid', mode: 'v6', late: true });
    expect(session().analysis_data).not.toHaveProperty('shadow');
  });

  test('a newer result in that place (a re-analysis) is left as it is', async () => {
    const { task, timedOut } = await lateRun();
    analysed(timedOut);
    session().analysis_data.shadow.fico17_v6 = { status: 'ok', at: '2026-11-11T16:30:00.000Z', mode: 'shadow' };
    const kept = copy(session());
    release();
    const res = await Shadow.storeLate(task, timedOut, 'sess-1', noWait);
    expect(res).toMatchObject({ ok: false, written: false });
    expect(session()).toEqual(kept);
  });

  test('idempotent: run twice, written once', async () => {
    const { task, timedOut } = await lateRun();
    analysed(timedOut);
    release();
    await Shadow.storeLate(task, timedOut, 'sess-1', noWait);
    const once = copy(session());
    const res = await Shadow.storeLate(task, timedOut, 'sess-1', noWait);
    expect(res).toMatchObject({ ok: true, written: false });
    expect(session()).toEqual(once);
  });

  test('every session write is guarded by the updated_at it read', async () => {
    const { task, timedOut } = await lateRun();
    analysed(timedOut);
    release();
    await Shadow.storeLate(task, timedOut, 'sess-1', noWait);
    const writes = mockFake.__calls.filter((c) => c.table === 'coaching_sessions' && c.action === 'update');
    expect(writes.length).toBeGreaterThan(0);
    for (const c of writes) expect(c.filters).toContainEqual(['eq', 'updated_at', expect.any(String)]);
  });
});

describe('anything that did not time out: nothing to do', () => {
  test('a read inside the grace, the switch off, no blob', async () => {
    GPT5MiniService.analyzePedagogy.mockImplementation(() => Promise.resolve({ analysis: { levels: {} }, usage: null }));
    const task = Shadow.start({ session: { id: 'sess-1', user_id: 'u1', users: { region: 'Sihala' } }, metadata: {}, frameworkKey: 'fico', transcript: TRANSCRIPT });
    const blob = await Shadow.settle(task, 1000);
    expect(blob.status).not.toBe('timeout');
    expect(await Shadow.storeLate(task, blob, 'sess-1', noWait)).toEqual({ started: false });
    expect(await Shadow.storeLate(null, null, 'sess-1', noWait)).toEqual({ started: false });
    expect(mockFake.__calls).toHaveLength(0);
  });

  test('the switch was off: the task resolves null, nothing is written', async () => {
    global.__DC = 'v3';
    const timedOut = { status: 'timeout', at: 'x' };
    expect(await Shadow.storeLate(Promise.resolve(null), timedOut, 'sess-1', noWait)).toMatchObject({ started: true, ok: false });
    expect(mockFake.__calls).toHaveLength(0);
  });
});

describe('analysis-processor: the hook', () => {
  test('storeLate is called after the analysis write is known to have landed, with the task and what settle returned', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/analysis-processor.service'), 'utf8');
    const write = src.indexOf('...ficoV6Shadow.patch(v6Shadow)');
    const refused = src.indexOf("analysis finished but the session is over — not reopened");
    const hook = src.indexOf('ficoV6Shadow.storeLate(v6ShadowTask, v6Shadow, coachingSessionId)');
    expect(write).toBeGreaterThan(0);
    expect(hook).toBeGreaterThan(refused);
    expect(refused).toBeGreaterThan(write);
  });
  test('the late write keeps its own timing seam', () => {
    expect(typeof LateWrite.timing.sleep).toBe('function');
  });
});
