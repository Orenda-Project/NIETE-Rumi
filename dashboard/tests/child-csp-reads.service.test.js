/**
 * The child pages' switch adds no settings read: web_quiz_child_csp rides the web quiz's one grouped app_settings read
 * (web-quiz-brotli-flag.js KEYS, with web_quiz_brotli and quiz_edge_security_headers) on its one 30 s timer.
 *
 * The real routers with their own process switches (no reader handed in) over a fake database client that counts
 * every app_settings query: one child page with the switch OFF makes exactly ONE read — the same count as before
 * this switch — and that read asks for all three keys; ten pages and a join page inside 30 s still make one. Each
 * switch takes its own row's value from that one answer (JSON true only).
 */
const db = { rows: [], calls: [] };
jest.mock('../config/supabase', () => ({
  from: (table) => ({
    select: (cols) => ({
      eq: (col, key) => { db.calls.push({ table, cols, eq: key }); return { maybeSingle: async () => ({ data: db.rows.find((r) => r.key === key) || null, error: null }) }; },
      in: async (col, keys) => { db.calls.push({ table, cols, in: [...keys].sort() }); return { data: db.rows.filter((r) => keys.includes(r.key)), error: null }; },
    }),
  }),
}));

const KEYS3 = ['quiz_edge_security_headers', 'web_quiz_brotli', 'web_quiz_child_csp'];
const HDR = 'content-security-policy-report-only';
const tick = () => new Promise((r) => setImmediate(r));

/**
 * A fresh module registry (fresh process switches), the harness loaded in it. resetModules, not isolateModules: the
 * routers require some modules lazily (when a router is made), and those must land in the same registry — as in one
 * running process.
 */
function fresh() {
  jest.resetModules();
  return require('./child-page-harness');
}
const freshFlag = () => { jest.resetModules(); return require('../routes/web-quiz-brotli-flag'); };
const rowOf = (H, name) => H.ROWS.find((r) => r[0] === name);

beforeEach(() => { db.rows = []; db.calls = []; });

describe('switch OFF: a child page makes exactly the one read it made before', () => {
  test('one hub page → 1 read, of app_settings, asking for the three keys together', async () => {
    const H = fresh();
    const got = await H.run(rowOf(H, 'hub.page'), { routerOpts: { logEvent: () => {} } });
    expect(got.status).toBe(200);
    expect(got.headers[HDR]).toBeUndefined();
    expect(db.calls.length).toBe(1);   // the base's one read (web_quiz_brotli), not one more
    expect(db.calls[0]).toEqual({ table: 'app_settings', cols: 'key, value', in: KEYS3 });
  });

  test('ten child pages and a join page inside 30 s → still 1 read', async () => {
    const H = fresh();
    const wq = await H.serve('wq');
    const join = await H.serve('join');
    try {
      const paths = [`/h/${H.HUB_TOKEN}`, '/q/AB12CD', '/q/AB12CD/class', '/q/AB12CD/schools', '/c/x', '/k/x', '/j/x', `/h/${H.HUB_TOKEN}`, '/q/AB12CD', '/h/not-a-token'];
      for (const p of paths) expect([p, (await wq.send('GET', p)).headers[HDR]]).toEqual([p, undefined]);
      await tick();
      expect((await join.send('GET', `/quiz/join/${H.JOIN_TOKEN}`)).headers[HDR]).toBeUndefined();
      expect(db.calls.length).toBe(1);
    } finally {
      await wq.close();
      await join.close();
    }
  });
});

describe('each switch takes its own value from the one answer', () => {
  async function twoPages(rows) {
    db.rows = rows;
    const H = fresh();
    const s = await H.serve('wq');
    try {
      await s.send('GET', `/h/${H.HUB_TOKEN}`);   // starts the read (the first answer never waits: OFF)
      await tick(); await tick();
      return await s.send('GET', `/h/${H.HUB_TOKEN}`);
    } finally {
      await s.close();
    }
  }
  test('web_quiz_child_csp true (brotli false) → the policy; still one read', async () => {
    const got = await twoPages([{ key: 'web_quiz_child_csp', value: true }, { key: 'web_quiz_brotli', value: false }]);
    expect(got.headers[HDR]).toMatch(/^default-src 'self'/);
    expect(db.calls).toHaveLength(1);
  });
  test.each([
    ['only web_quiz_brotli true', [{ key: 'web_quiz_brotli', value: true }]],
    ['only quiz_edge_security_headers true', [{ key: 'quiz_edge_security_headers', value: true }]],
    ['web_quiz_child_csp the string true', [{ key: 'web_quiz_child_csp', value: 'true' }]],
    ['web_quiz_child_csp 1', [{ key: 'web_quiz_child_csp', value: 1 }]],
    ['no rows', []],
  ])('%s → no policy', async (_, rows) => {
    const got = await twoPages(rows);
    expect(got.headers[HDR]).toBeUndefined();
    expect(db.calls).toHaveLength(1);
  });
  test('web_quiz_brotli answers from the same read: true only for its own row', async () => {
    db.rows = [{ key: 'web_quiz_child_csp', value: true }, { key: 'web_quiz_brotli', value: 'true' }];
    const Flag = freshFlag();
    expect(Flag.brotliOn()).toBe(false);
    await tick(); await tick();
    expect([Flag.brotliOn(), Flag.settingOn('web_quiz_child_csp'), Flag.settingOn('quiz_edge_security_headers')]).toEqual([false, true, false]);
    db.rows = [{ key: 'web_quiz_brotli', value: true }];
    const Flag2 = freshFlag();
    Flag2.brotliOn();
    await tick(); await tick();
    expect([Flag2.brotliOn(), Flag2.settingOn('web_quiz_child_csp')]).toEqual([true, false]);
    expect(Flag2.settingOn('some_other_key')).toBe(false);
    expect(db.calls).toHaveLength(2);   // one per fresh process, never one per key
    expect(Flag2.KEYS).toEqual(['web_quiz_brotli', 'quiz_edge_security_headers', 'web_quiz_child_csp']);
  });
});
