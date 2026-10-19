'use strict';
/**
 * app_settings web_quiz_edge_learn (default off, only the stored JSON boolean true is on, 30 s cache): the bot tells a
 * fresh portal process the page switches it would otherwise learn only from a quiz or hub payload.
 * GET /api/internal/wq/edge → {learn:false} when off (nothing else), else {learn:true, fast, brand, rt[, ui], one_face, wait_ux, wait_share}:
 * only the fields the edge learns from payloads, read through the same cached switches the payloads use.
 *
 * Reads (the three-assert shape): the key rides the hub's one batched read (web-quiz-hub-flags.js KEYS), never a read
 * of its own. OFF cold reads exactly that one read; with the page switches already cached by a page (same run), ON reads
 * no more than OFF; a cold ON reads at most that read and the five named page switches.
 * The hub answer says `edge_learn: true` while on (carry, from that read's cache), so a portal that stopped asking
 * (off is one ask per process) starts again; off, the hub answer is untouched.
 */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: {}, reads: [] };
  const from = () => {
    let key = null;
    let keys = null;
    const q = {
      select: () => q,
      eq: (_c, k) => { key = k; return q; },
      maybeSingle: async () => { state.reads.push(key); return { data: key in state.rows ? { key, value: state.rows[key] } : null, error: null }; },
      // the hub's one batched read (web-quiz-hub-flags.js): recorded as 'hub', its keys kept for the test to check
      in: (_c, ks) => { keys = ks; return q; },
      // web-quiz-fast.js reads its own switch together with the story-board one (also an .in()): that is the fast switch's read
      then: (res, rej) => { if (!keys) keys = [key]; const fastRead = keys.includes('web_quiz_story_board_refuse'); state.reads.push(fastRead ? 'web_quiz_fast' : 'hub'); if (!fastRead) state.hubKeys = keys; return Promise.resolve({ data: keys.filter((k) => k in state.rows).map((k) => ({ key: k, value: state.rows[k] })), error: null }).then(res, rej); },
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
// OFF: the endpoint makes the hub's one batched read, nothing else (recorded on this code; the constant the OFF row must equal).
const OFF_READS_COLD = 1;
const HUB_READ = 'hub';

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
    supabase.__state.rows = { [KEY]: true, web_quiz_fast: true, web_quiz_rich_telemetry: true, web_quiz_ur_polish: true, web_quiz_one_face: true, web_quiz_brand: 'rumi', web_quiz_wait_ux: true };
    await warmPageSwitches();
    const { status, body } = await ask();
    expect(status).toBe(200);
    expect(body).toEqual({ learn: true, fast: true, brand: 'rumi', rt: true, ui: { ur2: true }, one_face: true, adv: false, wait_ux: true, wait_share: false, wait_hops: false, wait_home: false, plain_paint: false, closed_lang: false, busy_page: false, busy_retry: false });
  });

  test('(e) on with web_quiz_home_inline and web_quiz_early_unlock: home_inline and early_unlock true (a fresh portal\'s first new phone gets the inline Home); off: neither field', async () => {
    supabase.__state.rows = { [KEY]: true, web_quiz_home_inline: true, web_quiz_early_unlock: true };
    await warmPageSwitches();
    const on = (await ask()).body;
    expect([on.home_inline, on.early_unlock]).toEqual([true, true]);
    supabase.__state.rows = { [KEY]: true, web_quiz_home_inline: false };
    resetAll();
    await warmPageSwitches();
    const off = (await ask()).body;
    expect(['home_inline' in off, 'early_unlock' in off]).toEqual([false, false]);
  });

  test('(e) on with web_quiz_home_inline and the v3 home: home_v3 1 (a fresh portal\'s first new phone carries the home\'s files); the fallback home, the pack, or neither home_inline nor early_unlock: no home_v3', async () => {
    supabase.__state.rows = { [KEY]: true, web_quiz_home_inline: true, web_quiz_home_v3: true };
    require('../../../shared/services/quiz/web-quiz-hub-home')._resetCache();
    await warmPageSwitches();
    expect((await ask()).body.home_v3).toBe(1);
    for (const rows of [{ web_quiz_home_inline: true, web_quiz_home_v3: true, web_quiz_home_fallback_v3: true }, { web_quiz_home_inline: true, web_quiz_home_v3: true, web_quiz_pack: true }, { web_quiz_home_v3: true }, { web_quiz_home_inline: true }]) {
      supabase.__state.rows = { [KEY]: true, ...rows };
      resetAll();
      require('../../../shared/services/quiz/web-quiz-hub-home')._resetCache();
      await warmPageSwitches();
      expect([rows, 'home_v3' in (await ask()).body]).toEqual([rows, false]);
    }
  });

  test('(e) on with web_quiz_ur_polish and web_quiz_face_lite: ui says fl too (the light Urdu face reaches the first Urdu page a portal draws); face_lite off: ui as before', async () => {
    supabase.__state.rows = { [KEY]: true, web_quiz_ur_polish: true, web_quiz_face_lite: true };
    await warmPageSwitches();
    expect((await ask()).body.ui).toEqual({ ur2: true, fl: true });
    supabase.__state.rows = { [KEY]: true, web_quiz_ur_polish: true, web_quiz_face_lite: false };
    resetAll();
    await warmPageSwitches();
    expect((await ask()).body.ui).toEqual({ ur2: true });
  });

  test('(e) on with web_quiz_adventure_look and web_quiz_one_button: adv true (the streamed head keeps the look); either off: adv false (said, never left out)', async () => {
    supabase.__state.rows = { [KEY]: true, web_quiz_adventure_look: true, web_quiz_one_button: true };
    await warmPageSwitches();
    expect((await ask()).body.adv).toBe(true);
    supabase.__state.rows = { [KEY]: true, web_quiz_adventure_look: true };
    resetAll();
    await warmPageSwitches();
    expect((await ask()).body.adv).toBe(false);
  });

  test('(e) on with web_quiz_minify: min true (a fresh portal\'s first page names the minified files); off: no min field', async () => {
    supabase.__state.rows = { [KEY]: true, web_quiz_minify: true };
    await warmPageSwitches();
    expect((await ask()).body.min).toBe(true);
    supabase.__state.rows = { [KEY]: true, web_quiz_minify: false };
    resetAll();
    await warmPageSwitches();
    expect('min' in (await ask()).body).toBe(false);
  });

  test('(e) on with every page switch off: no ui; one_face, adv, wait_ux, wait_share, wait_hops, wait_home and busy_page say false (off is said, never left out)', async () => {
    supabase.__state.rows = { [KEY]: true };
    await warmPageSwitches();
    const { body } = await ask();
    expect(Object.keys(body).sort()).toEqual(['adv', 'brand', 'busy_page', 'busy_retry', 'closed_lang', 'fast', 'learn', 'one_face', 'plain_paint', 'rt', 'wait_home', 'wait_hops', 'wait_share', 'wait_ux']);
    expect(body).toMatchObject({ learn: true, fast: false, rt: false, one_face: false, adv: false, wait_ux: false, wait_share: false, wait_hops: false, wait_home: false, plain_paint: false, closed_lang: false, busy_page: false, busy_retry: false });
    expect(typeof body.brand).toBe('string');
  });

  test('(e) reads: OFF == its own key; ON (page switches cached) <= OFF + its own named key; cold ON <= own + five', async () => {
    // OFF, cold
    await ask();
    const off = supabase.__state.reads.slice();
    expect(off).toEqual([HUB_READ]);
    expect(off.length).toBe(OFF_READS_COLD);
    expect(supabase.__state.hubKeys).toContain(KEY); // the key rides the hub's read
    // OFF, the page switches cached by a page (same run) and the hub's read stale
    resetAll(); await warmPageSwitches(); supabase.__state.reads = [];
    await ask();
    const offWarm = supabase.__state.reads.slice();
    expect(offWarm).toEqual([HUB_READ]);
    // ON, the same warm state
    supabase.__state.rows = { [KEY]: true };
    resetAll(); await warmPageSwitches(); supabase.__state.reads = [];
    await ask();
    const onWarm = supabase.__state.reads.slice();
    expect(onWarm.length).toBeLessThanOrEqual(offWarm.length);
    expect(onWarm.filter((k) => k !== HUB_READ)).toEqual([]);
    // ON, everything cold: its own key and at most the five named page switches, each once
    resetAll();
    await ask(); await tick(); await tick();
    const cold = supabase.__state.reads.slice();
    expect(cold.length).toBeLessThanOrEqual(1 + PAGE_KEYS.length);
    expect(new Set(cold).size).toBe(cold.length);
    cold.forEach((k) => expect([HUB_READ, ...PAGE_KEYS]).toContain(k));
    expect(cold).not.toContain(KEY); // never a read of its own
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
    expect(supabase.__state.reads).toEqual([HUB_READ]);
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  test.each([[true, true], ['true', false], [1, false], [{}, false], [null, false]])('(e) on: wait_ux %p → %p, from the same batched read (no read of its own)', async (v, want) => {
    supabase.__state.rows = v === null ? { [KEY]: true } : { [KEY]: true, web_quiz_wait_ux: v };
    await warmPageSwitches(); supabase.__state.reads = [];
    const { body } = await ask();
    expect(body.wait_ux).toBe(want);
    expect(supabase.__state.reads).toEqual([HUB_READ]);
    expect(supabase.__state.hubKeys).toContain('web_quiz_wait_ux');
  });

  // wait_share (the frame's read share) as web-quiz-wait-ux.js carry() puts it on a hub answer: wait_ux AND hub_fanout.
  test.each([[true, true, true], [true, false, false], [false, true, false], [true, 'true', false]])('(e) on: wait_ux %p + web_quiz_hub_fanout %p → wait_share %p, from the same batched read', async (wu, fan, want) => {
    supabase.__state.rows = { [KEY]: true, web_quiz_wait_ux: wu, web_quiz_hub_fanout: fan };
    await warmPageSwitches(); supabase.__state.reads = [];
    const { body } = await ask();
    expect(body.wait_share).toBe(want);
    expect(supabase.__state.reads).toEqual([HUB_READ]);
    expect(supabase.__state.hubKeys).toEqual(expect.arrayContaining(['web_quiz_wait_ux', 'web_quiz_hub_fanout']));
  });

  // plain_paint (a guessed first paint says no words) and closed_lang (the closed pages in the child's language): both ride the
  // hub's one batched read the answer already awaits, so a fresh bot process says them at once, never from a cold cache.
  test.each([[true, true, true], [true, false, false], [false, true, false], [true, 'true', false]])('(e) on: web_quiz_fast %p + web_quiz_plain_paint %p → plain_paint %p, from the same batched read', async (fast, pp, want) => {
    supabase.__state.rows = { [KEY]: true, web_quiz_fast: fast, web_quiz_plain_paint: pp };
    await warmPageSwitches();
    const before = supabase.__state.reads.length;
    const { body } = await ask();
    expect(body.plain_paint).toBe(want);
    expect(supabase.__state.hubKeys).toEqual(expect.arrayContaining(['web_quiz_plain_paint']));
    expect(supabase.__state.reads.length - before).toBeLessThanOrEqual(1);
  });

  test.each([[true, true], [false, false], ['true', false], [undefined, false]])('(e) on: web_quiz_closed_lang %p → closed_lang %p, from the same batched read', async (cl, want) => {
    supabase.__state.rows = { [KEY]: true, ...(cl === undefined ? {} : { web_quiz_closed_lang: cl }) };
    await warmPageSwitches();
    const { body } = await ask();
    expect(body.closed_lang).toBe(want);
    expect(supabase.__state.hubKeys).toEqual(expect.arrayContaining(['web_quiz_closed_lang']));
  });

  // wait_hops (the bar while the page is left) as web-quiz-wait-ux.js carry() puts it on a hub answer: wait_ux AND wait_hops.
  test.each([[true, true, true], [true, false, false], [false, true, false], [true, 'true', false]])('(e) on: wait_ux %p + web_quiz_wait_hops %p → wait_hops %p, from the same batched read', async (wu, hops, want) => {
    supabase.__state.rows = { [KEY]: true, web_quiz_wait_ux: wu, web_quiz_wait_hops: hops };
    await warmPageSwitches(); supabase.__state.reads = [];
    const { body } = await ask();
    expect(body.wait_hops).toBe(want);
    expect(supabase.__state.reads).toEqual([HUB_READ]);
    expect(supabase.__state.hubKeys).toEqual(expect.arrayContaining(['web_quiz_wait_ux', 'web_quiz_wait_hops']));
  });

  // wait_home (the kept Home in the early frame) as web-quiz-wait-ux.js carry() puts it on a hub answer: wait_ux AND wait_home.
  test.each([[true, true, true], [true, false, false], [false, true, false], [true, 'true', false]])('(e) on: wait_ux %p + web_quiz_wait_home %p → wait_home %p, from the same batched read', async (wu, hops, want) => {
    supabase.__state.rows = { [KEY]: true, web_quiz_wait_ux: wu, web_quiz_wait_home: hops };
    await warmPageSwitches(); supabase.__state.reads = [];
    const { body } = await ask();
    expect(body.wait_home).toBe(want);
    expect(supabase.__state.reads).toEqual([HUB_READ]);
    expect(supabase.__state.hubKeys).toEqual(expect.arrayContaining(['web_quiz_wait_ux', 'web_quiz_wait_home']));
  });

  test('another read of the hub\'s KEYS (prime(rows), the join\'s) fills this switch: then no read at all', async () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain(KEY);
    await warmPageSwitches(); supabase.__state.reads = [];
    Flags.prime([{ key: 'web_quiz_fast', value: true }, { key: KEY, value: true }], Date.now());
    expect((await ask()).body.learn).toBe(true);
    resetAll(); await warmPageSwitches(); supabase.__state.reads = [];
    Flags.prime([{ key: KEY, value: 'true' }], Date.now());
    expect((await ask()).body).toEqual({ learn: false });
    expect(supabase.__state.reads).toEqual([]);
  });

});

describe('the hub answer says edge_learn while on (so a portal that stopped asking starts again)', () => {
  const EdgeLearn = () => require('../../../shared/services/quiz/web-quiz-edge-learn');
  const Flags = () => require('../../../shared/services/quiz/web-quiz-hub-flags');
  const HUB = () => ({ lang: 'en', kids: [{ chip: '0123456789abcdef' }], kid: '0123456789abcdef', brand: 'niete' });
  beforeEach(() => { supabase.__state.rows = {}; resetAll(); });

  test('on (the hub\'s read saw the key true): edge_learn: true, with no read of its own', async () => {
    Flags().prime([{ key: KEY, value: true }], Date.now());
    supabase.__state.reads = [];
    expect(await EdgeLearn().carry(Promise.resolve(HUB()))).toEqual({ ...HUB(), edge_learn: true });
    expect(supabase.__state.reads).toEqual([]);
  });
  test.each([['no row', null], ['the string "true"', 'true'], ['1', 1], ['false', false]])('off (%s): the hub answer untouched, byte for byte', async (_, v) => {
    Flags().prime(v === null ? [] : [{ key: KEY, value: v }], Date.now());
    expect(JSON.stringify(await EdgeLearn().carry(HUB()))).toBe(JSON.stringify(HUB()));
  });
  test('nothing cached (or older than 30 s): off', async () => {
    expect(await EdgeLearn().carry(HUB())).toEqual(HUB());
    Flags().prime([{ key: KEY, value: true }], Date.now() - 31 * 1000);
    expect(await EdgeLearn().carry(HUB())).toEqual(HUB());
  });
  test('only a hub answer carries it (an error or another shape is untouched)', async () => {
    Flags().prime([{ key: KEY, value: true }], Date.now());
    expect(await EdgeLearn().carry({ error: 'not_found' })).toEqual({ error: 'not_found' });
    expect(await EdgeLearn().carry(null)).toBe(null);
  });
  test('both hub routes (GET and POST /hub/:token) pass their answer through carry', () => {
    const src = require('fs').readFileSync(require.resolve('../../../shared/routes/web-quiz-internal.routes'), 'utf8');
    expect((src.match(/EdgeLearn\(\)\.carry\(HomePreload\.carry\([^\n]*?OneFace\.carry\(require\('\.\.\/services\/quiz\/web-quiz-hub'\)\.hub\(/g) || []).length).toBe(3);
  });
});
