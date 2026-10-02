/**
 * child-test mock-lane driver (.claude/qa/shared/features/child-test.cjs, bd-s1oo0.9).
 *
 * The child test is being built in lanes while this spec and driver land first, so the driver's most
 * important property is HONESTY: a scenario whose code is not on the commit under test is recorded
 * BLOCKED with the lane it waits on — never a PASS, never silently missing. These tests pin that, the
 * spec ↔ driver id binding, the preconditions (no stack, no creds, a production URL), and the gate
 * scenarios driven against a scripted bot. Mocked at the boundary only: the WhatsApp side (the api
 * object feature-runner hands a driver), the stack lever, and HTTP to Supabase (global.fetch).
 *
 * Red-first: fails before the driver exists (Cannot find module).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DRIVER = path.join(__dirname, '../../.claude/qa/shared/features/child-test.cjs');
const SPEC = path.join(__dirname, '../../tests/features/whatsapp/niete/child-test.feature');
const driver = require(DRIVER);

function specIds() {
  const lines = fs.readFileSync(SPEC, 'utf8').split('\n');
  const ids = [], excused = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith('@')) continue;
    const m = t.match(/@(CT\d{2})\b/);
    if (m) (t.includes('@no-mock-driver') ? excused : ids).push(m[1]);
  }
  return { ids, excused };
}

function tmpRoot(withLanes) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-driver-'));
  for (const lane of withLanes) for (const f of driver.LANE_FILES[lane]) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), '// stub\n');
  }
  return d;
}

const collect = () => { const out = []; const rec = (id, name, verdict, evidence) => out.push({ id, name, verdict, evidence }); return { out, rec }; };
const byId = (out) => Object.fromEntries(out.map((r) => [r.id, r]));

describe('child-test driver: spec binding', () => {
  test('the driver records exactly the spec ids, minus the @no-mock-driver ones', () => {
    const { ids, excused } = specIds();
    expect(ids.length).toBeGreaterThan(20);
    expect(driver.SCENARIOS.map((s) => s[0])).toEqual(ids);
    expect(excused).toEqual(['CT32']);
  });
});

describe('child-test driver: honest BLOCKED until the code lands', () => {
  test('no lane on the commit → every scenario BLOCKED naming the lanes it waits on, nothing driven', async () => {
    const { out, rec } = collect();
    const api = new Proxy({}, { get: () => () => { throw new Error('nothing may be driven'); } });
    await driver.run({ api, rec, root: tmpRoot([]), env: {} });
    expect(out).toHaveLength(driver.SCENARIOS.length);
    expect(out.every((r) => r.verdict === 'BLOCKED')).toBe(true);
    const r = byId(out);
    expect(r.CT21.evidence.reason).toMatch(/^pending L3\+L4:/);
    expect(r.CT05.evidence.reason).toMatch(/^pending L3\+L4\+L5:/);
    expect(r.CT07.evidence.reason).toMatch(/^pending L3\+L4\+L5\+L6:.*child-test-check-endpoint\.js/);
  });

  test('only L3+L4 landed → list scenarios pass the lane check, scoring and Flow scenarios stay pending', async () => {
    const { out, rec } = collect();
    await driver.run({ api: {}, rec, root: tmpRoot(['L3', 'L4']), env: {}, stack: { runDir: () => '' } });
    const r = byId(out);
    expect(r.CT06.evidence.reason).toMatch(/^pending L5:/);
    expect(r.CT08.evidence.reason).toMatch(/^pending L5\+L6:/);
    expect(r.CT20.evidence.reason).toMatch(/no RUN_DIR/);       // lane present, stack absent
    expect(out.every((x) => x.verdict === 'BLOCKED')).toBe(true);
  });

  test('a production Supabase URL is refused before anything is written', async () => {
    const { out, rec } = collect();
    const env = { NIETE_SANDBOX_SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co', NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY: 'k', E2E_DRIVER: '923000000001' };
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    await driver.run({ api: {}, rec, root: tmpRoot(['L3', 'L4', 'L5', 'L6']), env, stack: { runDir: () => '/run' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.every((x) => x.verdict === 'BLOCKED' && /production project/.test(x.evidence.reason))).toBe(true);
  });
});

describe('child-test driver: the gate, driven against a scripted bot', () => {
  const SIM = { id: 'sim-school', name: 'SIM — School', emis: '999' };
  let calls;
  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
      const u = String(url); calls.push({ method: opts.method || 'GET', url: u });
      const json = (b) => ({ ok: true, json: async () => b });
      if (u.includes('/users?')) return json([{ id: 'coach-uid', region: 'niete', preferred_language: 'en' }]);
      if (u.includes('/schools?')) return json([SIM]);
      if (u.includes('/child_test_draws?')) return json([]);
      return json([]);
    });
  });

  function scriptedBot() {
    const st = { enabled: true, role: 'teacher', region: 'niete', roster: false, outbox: [] };
    const reply = (txt, extra = {}) => ({ ok: true, txt, ...extra });
    const api = {
      async resetFlow() { return { ok: true }; },
      async setRole(r) { st.role = r; return { ok: true }; },
      async setUser(p) { if (p.region) st.region = p.region; return { ok: true }; },
      async setRoster() { st.roster = true; return { ok: true }; },
      async clearRoster() { st.roster = false; return { ok: true }; },
      async freshReset() { return 1; },
      async fresh() { return []; },
      async sendWait(text) {
        if (text !== '/egra') return reply('ok');
        if (!st.enabled || !/^niete/.test(st.region)) return reply("Sorry, I didn't get that. Send /menu.");
        if (st.role !== 'coach') return reply('The child test is for coaches and school leaders.');
        if (st.roster) return reply('This school has no Grade 3 or Grade 5 class list yet. Send the register photos with /roster first, then /egra.');
        return reply("I couldn't open today's list just now. Please send /egra again in a minute.");
      },
    };
    const stack = { runDir: () => '/run', restart: async (_p, envOver) => { st.enabled = envOver.CHILD_TEST_ENABLED === 'true'; return { ok: true }; } };
    return { api, stack, st };
  }

  test('flag off is inert, a teacher is denied, a non-ICT coach gets nothing, a school with no class list is told so', async () => {
    const { out, rec } = collect();
    const { api, stack } = scriptedBot();
    const env = { NIETE_SANDBOX_SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY: 'k', E2E_DRIVER: '923000000001' };
    await driver.run({ api, rec, root: tmpRoot(['L3', 'L4', 'L5', 'L6']), env, stack });
    const r = byId(out);
    expect(r.CT20.verdict).toBe('PASS');
    expect(r.CT21.verdict).toBe('PASS');
    expect(r.CT22.verdict).toBe('PASS');
    expect(r.CT30.verdict).toBe('PASS');
    // No list arrived for the SIM school: CT09 fails on the evidence, everything downstream is BLOCKED with why.
    expect(r.CT09.verdict).toBe('FAIL');
    expect(r.CT03.verdict).toBe('BLOCKED');
    expect(r.CT03.evidence.reason).toMatch(/no list arrived/);
    expect(out).toHaveLength(driver.SCENARIOS.length);
    // The SIM assignment is made for the run and removed in the finally, whatever happened.
    const ls = calls.filter((c) => c.url.includes('/leader_schools'));
    expect(ls.some((c) => c.method === 'POST')).toBe(true);
    expect(ls[ls.length - 1].method).toBe('DELETE');
  });

  test('a failing CHILD_TEST_ENABLED restart blocks the rest with the reason instead of driving a gated-off bot', async () => {
    const { out, rec } = collect();
    const { api } = scriptedBot();
    const stack = { runDir: () => '/run', restart: async (_p, e) => (e.CHILD_TEST_ENABLED === 'true' ? { ok: false, err: 'boom' } : { ok: true }) };
    const env = { NIETE_SANDBOX_SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY: 'k', E2E_DRIVER: '923000000001' };
    await driver.run({ api, rec, root: tmpRoot(['L3', 'L4', 'L5', 'L6']), env, stack });
    const r = byId(out);
    expect(r.CT20.verdict).toBe('PASS');
    expect(r.CT21.verdict).toBe('BLOCKED');
    expect(r.CT21.evidence.reason).toMatch(/could not restart the bot with CHILD_TEST_ENABLED=true/);
  });
});
