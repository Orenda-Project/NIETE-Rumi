'use strict';
/**
 * app_settings web_quiz_edge_learn (default off, only the stored JSON boolean true is on, 30 s cache): the bot tells a
 * fresh portal process the page switches it would otherwise learn only from a quiz or hub payload.
 * GET /api/internal/wq/edge → {learn:false} when off (nothing else), else {learn:true, fast, brand, rt[, ui][, one_face]}:
 * only the fields the edge learns from payloads, read through the same cached switches the payloads use.
 *
 * Reads (the three-assert shape): OFF reads exactly its own key; with the page switches already cached by a page
 * (same run), ON reads no more than OFF plus its own named key; a cold ON reads at most its own key and the five
 * named page switches.
 */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: {}, reads: [] };
  const from = () => {
    let key = null;
    const q = {
      select: () => q,
      eq: (_c, k) => { key = k; return q; },
      maybeSingle: async () => { state.reads.push(key); return { data: key in state.rows ? { key, value: state.rows[key] } : null, error: null }; },
    };
    return q;
  };
  return { from, __state: state };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const express = require('express');
const supabase = require('../../../shared/config/supabase');

const KEY = 'web_quiz_edge_learn';
const PAGE_KEYS = ['web_quiz_fast', 'web_quiz_rich_telemetry', 'web_quiz_ur_polish', 'web_quiz_one_face', 'web_quiz_brand'];
// OFF: the endpoint reads its own key once, nothing else (recorded on this code; the constant the OFF row must equal).
const OFF_READS_COLD = 1;

function resetAll() {
  require('../../../shared/services/quiz/web-quiz-edge-learn')._reset();
  require('../../../shared/services/quiz/web-quiz-fast')._reset();
  require('../../../shared/services/quiz/web-quiz-telemetry')._reset();
  require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
  require('../../../shared/services/quiz/web-quiz-one-face')._reset();
  require('../../../shared/config/web-quiz-brand')._resetCache();
  supabase.__state.reads = [];
}
const tick = () => new Promise((r) => setImmediate(r));
/** What a page answer would have warmed: every page switch cached (the non-waiting ones after their background read). */
async function warmPageSwitches() {
  require('../../../shared/services/quiz/web-quiz-fast').on();
  require('../../../shared/services/quiz/web-quiz-one-face').on();
  await require('../../../shared/services/quiz/web-quiz-telemetry').flag();
  await require('../../../shared/services/quiz/web-quiz-ur-polish').flag();
  await require('../../../shared/config/web-quiz-brand').resolveBrandKey({ db: supabase });
  await tick(); await tick();
}

describe('GET /api/internal/wq/edge', () => {
  let server; let base;
  const H = { headers: { 'x-api-key': 'route-key' } };
  const ask = async () => { const r = await fetch(`${base}/edge`, H); return { status: r.status, body: await r.json() }; };
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => { supabase.__state.rows = {}; resetAll(); });

  test('needs the internal key', async () => { expect((await fetch(`${base}/edge`)).status).toBe(401); });

  test('(e) off (no row): {learn:false} and no other field, even with every page switch on', async () => {
    supabase.__state.rows = { web_quiz_fast: true, web_quiz_rich_telemetry: true, web_quiz_ur_polish: true, web_quiz_one_face: true, web_quiz_brand: 'rumi' };
    await warmPageSwitches();
    supabase.__state.reads = [];
    expect(await ask()).toEqual({ status: 200, body: { learn: false } });
  });

  test.each([['true'], [' TRUE '], ['"true"'], [1], [{}], [{ enabled: true }], [false], ['yes']])('(e) strict key: %p → off', async (v) => {
    supabase.__state.rows = { [KEY]: v, web_quiz_fast: true };
    expect((await ask()).body).toEqual({ learn: false });
  });

  test('(e) on: only the allowed fields, as the payloads carry them', async () => {
    supabase.__state.rows = { [KEY]: true, web_quiz_fast: true, web_quiz_rich_telemetry: true, web_quiz_ur_polish: true, web_quiz_one_face: true, web_quiz_brand: 'rumi' };
    await warmPageSwitches();
    const { status, body } = await ask();
    expect(status).toBe(200);
    expect(body).toEqual({ learn: true, fast: true, brand: 'rumi', rt: true, ui: { ur2: true }, one_face: true });
  });

  test('(e) on with every page switch off: no ui, no one_face (as a switched-off payload)', async () => {
    supabase.__state.rows = { [KEY]: true };
    await warmPageSwitches();
    const { body } = await ask();
    expect(Object.keys(body).sort()).toEqual(['brand', 'fast', 'learn', 'rt']);
    expect(body).toMatchObject({ learn: true, fast: false, rt: false });
    expect(typeof body.brand).toBe('string');
  });

  test('(e) reads: OFF == its own key; ON (page switches cached) <= OFF + its own named key; cold ON <= own + five', async () => {
    // OFF, cold
    await ask();
    const off = supabase.__state.reads.slice();
    expect(off).toEqual([KEY]);
    expect(off.length).toBe(OFF_READS_COLD);
    // OFF, the page switches cached by a page (same run) and the own key stale
    resetAll(); await warmPageSwitches(); supabase.__state.reads = [];
    await ask();
    const offWarm = supabase.__state.reads.slice();
    expect(offWarm).toEqual([KEY]);
    // ON, the same warm state
    supabase.__state.rows = { [KEY]: true };
    resetAll(); await warmPageSwitches(); supabase.__state.reads = [];
    await ask();
    const onWarm = supabase.__state.reads.slice();
    expect(onWarm.length).toBeLessThanOrEqual(offWarm.length + 1);
    expect(onWarm.filter((k) => k !== KEY)).toEqual([]);
    // ON, everything cold: its own key and at most the five named page switches, each once
    resetAll();
    await ask(); await tick(); await tick();
    const cold = supabase.__state.reads.slice();
    expect(cold.length).toBeLessThanOrEqual(1 + PAGE_KEYS.length);
    expect(new Set(cold).size).toBe(cold.length);
    cold.forEach((k) => expect([KEY, ...PAGE_KEYS]).toContain(k));
    // and a second ask within 30 s reads nothing
    supabase.__state.reads = [];
    await ask();
    expect(supabase.__state.reads).toEqual([]);
  });

  test.each([[false], [true]])('(e) on=%p: N calls inside one cache window → ONE settings read in all (page switches cached)', async (on) => {
    supabase.__state.rows = on ? { [KEY]: true, web_quiz_fast: true } : {};
    await warmPageSwitches(); supabase.__state.reads = [];
    const bodies = [];
    for (let i = 0; i < 8; i += 1) bodies.push((await ask()).body);
    expect(supabase.__state.reads).toEqual([KEY]);
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  test('the hub\'s one settings read can fill this switch (hubSwitches row): then no read of its own', async () => {
    const EdgeLearn = require('../../../shared/services/quiz/web-quiz-edge-learn');
    expect(EdgeLearn.hubSwitches).toMatchObject({ name: 'edge-learn', keys: [KEY] });
    expect(EdgeLearn.hubSwitches.age(Date.now())).toBe('cold');
    await warmPageSwitches(); supabase.__state.reads = [];
    EdgeLearn.hubSwitches.prime([{ key: 'web_quiz_fast', value: true }, { key: KEY, value: true }], Date.now());
    expect(EdgeLearn.hubSwitches.age(Date.now())).toBe('fresh');
    expect((await ask()).body.learn).toBe(true);
    EdgeLearn.hubSwitches.prime([{ key: KEY, value: 'true' }], Date.now());
    expect((await ask()).body).toEqual({ learn: false });
    expect(supabase.__state.reads).toEqual([]);
  });
});
