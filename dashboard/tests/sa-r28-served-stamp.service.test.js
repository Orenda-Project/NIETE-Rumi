'use strict';
/**
 * Round 28: device_ready says which build the session ran on, so a read can cut sessions across a deploy.
 *   page     the VERSION baked into sa-page.js: the page code that ran (equal to sw.js VERSION in the same tree)
 *   sw       the VERSION of each worker that answered the preparation, in reply order ('a+b' when two did); null when none said
 *   session  the sa-session-* cache the clips were in once prepared ('a+b' when split); null when none held them or the
 *            worker did not answer in 2 s
 * The prepare replies carry sw and post exactly when they did before: the cache lookup is its own message ({ type: 'held' }),
 * sent once after the last clip step, capped at 2 s in the page, and nothing the child sees waits on it (the opening, the
 * readiness verdict, the refusal). A newer worker that takes the page over mid-session (skipWaiting + clients.claim, no
 * reload) is logged as worker_swap { from, to, task }. The value stays within the server's MAX_EVENT_DATA (300 characters
 * of JSON, or the whole value is dropped).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const page = require('../sa/sa-page');
const MINI = require('./fixtures/sa-battery.g3-ur.mini.json');

const SW_SRC = fs.readFileSync(path.join(__dirname, '../sa/sw.js'), 'utf8');
const OFFLINE_SRC = fs.readFileSync(path.join(__dirname, '../sa/sa-offline.js'), 'utf8');
const O = 'https://portal.test';
const BURL = '/sa/batteries/sa.coach.G3.A.ur.json';
const SW_VERSION = /var VERSION = '([^']+)'/.exec(SW_SRC)[1];
const SW_SESSION = /var SESSION = '([^']+)'/.exec(SW_SRC)[1];
const NEXT_SRC = SW_SRC.replace(`var VERSION = '${SW_VERSION}'`, "var VERSION = 'sa-next'").replace(`var SESSION = '${SW_SESSION}'`, "var SESSION = 'sa-session-next'");

function res(u) {
  const type = /\.json$/.test(u) ? 'application/json' : /\.(mp3|m4a|ogg)$/.test(u) ? 'audio/mpeg' : 'image/webp';
  return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : h.toLowerCase() === 'content-length' ? '1' : null) } };
}

/**
 * The real sw.js in a sandbox. held = { cacheName: [urls] } on the phone before the preparation; src runs another build of
 * the worker (the next deploy); keysHang: caches.keys() never settles (the cache lookup stalls). posted = every final reply, in order.
 */
function bootWorker({ held = {}, src = SW_SRC, keysHang = false } = {}) {
  const listeners = {};
  const posted = [];
  const abs = (u) => new URL(u, `${O}/sa/`).href;
  const named = new Map(Object.entries(held).map(([k, list]) => [k, new Map(list.map((u) => [abs(u), res(u)]))]));
  const store = (name) => { if (!named.has(name)) named.set(name, new Map()); return named.get(name); };
  const caches = {
    keys: () => (keysHang ? new Promise(() => {}) : Promise.resolve([...named.keys()])),
    delete: (k) => Promise.resolve(named.delete(k)),
    open: (name) => Promise.resolve({
      put: (u, r) => { store(name).set(abs(u), r); return Promise.resolve(); },
      match: (u) => Promise.resolve(store(name).get(abs(u))),
    }),
    match: (u) => Promise.resolve([...named.values()].map((m) => m.get(abs(u))).find(Boolean)),
  };
  const self = {
    location: { href: `${O}/sa/sw.js` },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const fetched = [];
  vm.runInNewContext(src, { self, caches, URL, Promise, fetch: (u) => { fetched.push(String(u)); return Promise.resolve(res(u)); }, setTimeout, clearTimeout, setInterval, clearInterval, console });
  const active = {
    state: 'activated',
    postMessage: (msg, ports) => {
      const port = (ports || [])[0];
      // a stage's progress ticks (sa-39) are not replies: only the final answer is recorded
      const wrapped = port && { postMessage: (d) => { if (!d || d.type !== 'progress') posted.push({ type: msg.type, urls: msg.urls, reply: d, at: Date.now() }); port.postMessage(d); } };
      listeners.message({ data: msg, ports: wrapped ? [wrapped] : [], waitUntil: () => {} });
    },
  };
  return { active, named, posted, fetched };
}

class FakeChannel {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = { postMessage: (d) => { if (this.port1.onmessage) this.port1.onmessage({ data: d }); } };
  }
}

/** The real sa-offline.js as the browser loads it (SAE.prepare), on a phone whose active worker is w. */
function phoneWith(w) {
  const reg = { active: w.active, installing: null, waiting: null, update: () => Promise.resolve() };
  const root = {
    navigator: { serviceWorker: { getRegistration: () => Promise.resolve(reg), register: () => Promise.resolve(reg), ready: Promise.resolve(reg), controller: w.active } },
    MessageChannel: FakeChannel,
    localStorage: null,
  };
  vm.runInNewContext(OFFLINE_SRC, { self: root, URL, Promise, setTimeout, clearTimeout, console });
  return root.SAE;
}

function fakeEngine() {
  const logs = [];
  const hooks = {};
  return {
    logs,
    session_id: 's1',
    runner: { log: (type, o) => logs.push([type, o]) },
    view: {},
    on: (name, fn) => { (hooks[name] = hooks[name] || []).push(fn); },
    fire: (name, e) => (hooks[name] || []).forEach((fn) => fn(e)),
  };
}

/** device_ready as sa-page.js logs it after a real preparation. */
async function deviceReady(SAE) {
  const engine = fakeEngine();
  const battery = page.pick(MINI, 'full');
  await page.voiceGate(engine, page.prepareOf(SAE, battery, 'ur', BURL), { battery });
  const hit = engine.logs.find(([t]) => t === 'device_ready');
  return hit && hit[1].value;
}

const clipsOf = () => require('../sa/sa-offline').urls(page.pick(MINI, 'full'), 'ur', '/');

describe('the page\'s own build', () => {
  test('sa-page.js carries a VERSION, and it is sw.js VERSION in the same tree (a one-sided bump fails here)', () => {
    expect(typeof page.VERSION).toBe('string');
    expect(page.VERSION).toBe(SW_VERSION);
  });
});

describe('(a) a fresh phone: page = sw = the served VERSION, session = the served SESSION', () => {
  test('every clip prepared into the worker\'s SESSION', async () => {
    const v = await deviceReady(phoneWith(bootWorker()));
    expect(v).toMatchObject({ ready: true, voice: 'clips', page: SW_VERSION, sw: SW_VERSION, session: SW_SESSION });
  });
});

describe('(b) deploy day: the page loaded under worker N, worker N+1 prepares', () => {
  test('page names the code that ran, sw the worker that answered, session the cache the clips came from', async () => {
    expect(NEXT_SRC).not.toBe(SW_SRC);
    const v = await deviceReady(phoneWith(bootWorker({ src: NEXT_SRC, held: { 'sa-session-next': clipsOf() } })));
    expect(v).toMatchObject({ page: SW_VERSION, sw: 'sa-next', session: 'sa-session-next' });
  });

  test('session is where the clips really were, not the worker\'s constant (an older cache not yet deleted)', async () => {
    const v = await deviceReady(phoneWith(bootWorker({ held: { 'sa-session-older': clipsOf() } })));
    expect(v).toMatchObject({ page: SW_VERSION, sw: SW_VERSION, session: 'sa-session-older' });
  });

  test('R-c: the opening answered by one worker and the rest by the next: sw names both, in reply order', async () => {
    const n = bootWorker();
    const n1 = bootWorker({ src: NEXT_SRC });
    let asks = 0;
    // the first clip step (the opening) goes to worker N; every later message to worker N+1, which took over meanwhile
    const swapping = { postMessage: (msg, ports) => { asks += 1; (msg.type === 'prepare' && asks <= 2 ? n : n1).active.postMessage(msg, ports); } };
    const v = await deviceReady(phoneWith({ active: swapping }));
    expect(v.sw).toBe(`${SW_VERSION}+sa-next`);
  });
});

describe('the cache lookup never holds up a prepare reply (O-100a)', () => {
  test('R-a: with the lookup stalled, every prepare reply still posts, and none of them carries a lookup', async () => {
    const w = bootWorker({ keysHang: true });
    const SAE = phoneWith(w);
    const battery = page.pick(MINI, 'full');
    const r = await SAE.prepare(battery, { lang: 'ur', battery_url: BURL, base: '/' });
    const prepares = w.posted.filter((p) => p.type === 'prepare');
    expect(prepares.length).toBeGreaterThanOrEqual(4);
    prepares.forEach((p) => { expect(p.reply.sw).toBe(SW_VERSION); expect('session' in p.reply).toBe(false); });
    expect(r).toMatchObject({ ready: true, voice: 'clips' });
  });

  test('R-b: the held reply never arrives: session null at most 2 s after the last clip step, ready and voice as when it arrives', async () => {
    const battery = page.pick(MINI, 'full');
    const ok = await phoneWith(bootWorker()).prepare(battery, { lang: 'ur', battery_url: BURL, base: '/' });
    const w = bootWorker({ keysHang: true });
    const r = await phoneWith(w).prepare(battery, { lang: 'ur', battery_url: BURL, base: '/' });
    const session = await r.held;
    const lastClip = Math.max(...w.posted.filter((p) => p.type === 'prepare').map((p) => p.at));
    expect(session).toBeNull();
    expect(Date.now() - lastClip).toBeLessThanOrEqual(2200);
    const pick = (o) => ({ ready: o.ready, voice: o.voice, clips_total: o.clips_total, clips_cached: o.clips_cached, battery: o.battery });
    expect(pick(r)).toEqual(pick(ok));
    expect(await ok.held).toBe(SW_SESSION);
  });

  test('the held ask is one message, after the clip steps, naming every clip of the part', async () => {
    const w = bootWorker();
    const r = await phoneWith(w).prepare(page.pick(MINI, 'full'), { lang: 'ur', battery_url: BURL, base: '/' });
    expect(await r.held).toBe(SW_SESSION);
    const held = w.posted.filter((p) => p.type === 'held');
    const lastClip = Math.max(...w.posted.filter((p) => p.type === 'prepare').map((p) => p.at));
    expect(held[0].at).toBeGreaterThanOrEqual(lastClip);
    expect(held).toHaveLength(1);
    expect([...held[0].urls].sort()).toEqual([...clipsOf()].sort());
  });

  test('a refusal (no clip, no phone voice) is not held back by a stalled lookup: device_ready then voice_not_ready at once', async () => {
    const engine = fakeEngine();
    engine.view.refuse = () => {};
    let settle;
    const held = new Promise((r) => { settle = r; });
    const t0 = Date.now();
    await page.voiceGate(engine, Promise.resolve({ ready: false, voice: 'none', clips_total: 10, clips_cached: 0, sw: SW_VERSION, held }), {});
    expect(Date.now() - t0).toBeLessThan(200);
    expect(engine.logs.map(([t]) => t)).toEqual(['device_ready', 'voice_not_ready']);
    expect(engine.logs[0][1].value).toMatchObject({ page: SW_VERSION, sw: SW_VERSION, session: null });
    settle('sa-session-x');
  });
});

describe('(c) the worker does not say', () => {
  test('a worker of a build before the stamp (no sw in its reply, no held reply): sw and session null, the start not refused', async () => {
    const w = bootWorker();
    const before = {
      postMessage: (msg, ports) => {
        if (msg.type !== 'prepare') return; // an older worker ignores a message it does not know
        w.active.postMessage(msg, [{ postMessage: ({ sw, session, ...rest }) => ports[0].postMessage(rest) }]);
      },
    };
    const v = await deviceReady(phoneWith({ active: before }));
    expect(v).toMatchObject({ voice: 'clips', page: SW_VERSION, sw: null, session: null });
  });

  test('no worker on the phone: sw and session null', async () => {
    const root = { navigator: {}, localStorage: null };
    vm.runInNewContext(OFFLINE_SRC, { self: root, URL, Promise, setTimeout, clearTimeout, console });
    const v = await deviceReady(root.SAE);
    expect(v).toMatchObject({ page: SW_VERSION, sw: null, session: null });
  });
});

describe('names are joined, never cut', () => {
  test('R-d: three caches → the first two and "+…"; the value is dropped to null only when a name is absurdly long', () => {
    const { names } = require('../sa/sa-offline');
    expect(names(['sa-session-v29', 'sa-session-v30', 'sa-session-v31'])).toBe('sa-session-v29+sa-session-v30+…');
    expect(names(['a', 'a', 'b'])).toBe('a+b');
    expect(names([null, undefined])).toBeNull();
  });
});

describe('the value fits the server\'s MAX_EVENT_DATA', () => {
  test('the longest value device_ready can carry is at most 300 characters of JSON', () => {
    const engine = fakeEngine();
    const long = 'x'.repeat(500);
    const two = 'sa-session-v1000+sa-session-v1001+…';
    const o = {
      ready: true, voice: 'clips', persisted: true, clips_total: 99999, clips_cached: 99999,
      prep_ms: 9999999, prep_bytes: 999999999, prep_gaveup_stage: 'opening', prep_missing: 99999,
      sw: 'sa-1000+sa-1001+…', held: Promise.resolve(two),
    };
    return page.voiceGate(engine, Promise.resolve(o), {}).then(() => {
      const v = engine.logs[0][1].value;
      expect(JSON.stringify(v).length).toBeLessThanOrEqual(300);
      expect(v).toMatchObject({ page: SW_VERSION, sw: 'sa-1000+sa-1001+…', session: two });
      const engine2 = fakeEngine();
      return page.voiceGate(engine2, Promise.resolve({ ...o, sw: long, held: Promise.resolve(long) }), {}).then(() => {
        const w = engine2.logs[0][1].value;
        expect(JSON.stringify(w).length).toBeLessThanOrEqual(300);
        expect(w).toMatchObject({ sw: null, session: null });
      });
    });
  });
});

describe('the held ask never reaches the network', () => {
  test('a held ask naming clips that are not on the phone fetches nothing: session null, sw the worker\'s VERSION', async () => {
    const w = bootWorker();
    const reply = await new Promise((ok) => {
      const ch = new FakeChannel();
      ch.port1.onmessage = (e) => ok(e.data);
      w.active.postMessage({ type: 'held', urls: clipsOf() }, [ch.port2]);
    });
    expect(reply).toEqual({ sw: SW_VERSION, session: null });
    expect(w.fetched).toEqual([]);
  });
});

describe('the value fits beside the preparation fields', () => {
  test('names at the stamp cap never push the value past 300: sw and session go null, the rest is kept', () => {
    const engine = fakeEngine();
    const o = {
      ready: true, voice: 'clips', persisted: true, clips_total: 99999, clips_cached: 99999,
      prep_ms: 9999999, prep_bytes: 999999999, prep_gaveup_stage: 'opening', prep_missing: 99999,
      sw: 'w'.repeat(64), held: Promise.resolve('s'.repeat(64)),
    };
    return page.voiceGate(engine, Promise.resolve(o), {}).then(() => {
      const v = engine.logs[0][1].value;
      expect(JSON.stringify(v).length).toBeLessThanOrEqual(300);
      expect(v).toMatchObject({ page: SW_VERSION, sw: null, session: null, prep_ms: 9999999, prep_missing: 99999 });
    });
  });
});

describe('worker_swap: a newer worker takes the page over mid-session', () => {
  function container() {
    const ls = {};
    return {
      controller: null,
      addEventListener: (t, fn) => { (ls[t] = ls[t] || []).push(fn); },
      fire: (t) => (ls[t] || []).forEach((fn) => fn({})),
    };
  }

  test('a controllerchange mid-task → one event { from, to, task }; a second one logs again from the new worker', async () => {
    const engine = fakeEngine();
    const c = container();
    const asked = [];
    const version = (w) => { asked.push(w); return Promise.resolve(w && w.v); };
    page.swapWatch(engine, c, () => SW_VERSION, version);
    engine.fire('task_start', { type: 'task_start', task_id: 'ur.letter_sounds' });
    c.controller = { v: 'sa-next' };
    c.fire('controllerchange');
    await new Promise((r) => setTimeout(r, 0));
    engine.fire('task_end', { type: 'task_end', task_id: 'ur.letter_sounds' });
    c.controller = { v: 'sa-next2' };
    c.fire('controllerchange');
    await new Promise((r) => setTimeout(r, 0));
    const swaps = engine.logs.filter(([t]) => t === 'worker_swap').map(([, o]) => o.value);
    expect(swaps).toEqual([
      { from: SW_VERSION, to: 'sa-next', task: 'ur.letter_sounds' },
      { from: 'sa-next', to: 'sa-next2', task: null },
    ]);
  });

  test('no controllerchange → no event; a worker that does not answer → to null', async () => {
    const engine = fakeEngine();
    const c = container();
    page.swapWatch(engine, c, () => null, () => Promise.resolve(null));
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.logs.filter(([t]) => t === 'worker_swap')).toHaveLength(0);
    c.controller = {};
    c.fire('controllerchange');
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.logs.filter(([t]) => t === 'worker_swap').map(([, o]) => o.value)).toEqual([{ from: null, to: null, task: null }]);
  });

  test('the new worker\'s VERSION comes from the real worker\'s held reply (no urls), within 2 s', async () => {
    const { version } = require('../sa/sa-offline');
    const w = bootWorker({ src: NEXT_SRC });
    const SAE = phoneWith(w);
    expect(await SAE.offline.version(w.active)).toBe('sa-next');
    expect(await version(null)).toBeNull();
  });
});
