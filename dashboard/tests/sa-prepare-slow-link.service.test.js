'use strict';
/**
 * The Start gate on a slow phone link (the morning a third of the coaches saw «آواز ابھی تیار نہیں»): the page asked the
 * worker for the session's clips in three stages and gave each a fixed 60 s, so a phone whose clips were still arriving
 * was refused, and a stage that did not answer in time counted all its clips as missing. Now:
 *   (a) a stage waits while the worker reports progress, and gives up only after 20 s with no file kept and no byte received
 *   (b) a stage that gave up counts what is really on the phone (caches.match), never "all missing"
 *   (c) the worker still fetches six at a time
 *   (d) a fetch is given up only when it stalls (no answer, or no body bytes, for 20 s), then tried once more; a clip that
 *       keeps arriving slowly is never cut
 *   (e) a URL already being fetched is not fetched again by a second prepare (a coach's Try again)
 *   device fields: prep_ms, prep_bytes, prep_gaveup_stage, prep_missing beside clips_cached on device_ready
 * Every row runs the page's real prepare()/prepareSession() against the worker's real prefetch over streamed bodies,
 * on a fake clock.
 */

const KB = 1024;

// a channel whose two ends just call each other (Node's real ports would keep the test process alive)
function Channel() {
  const a = {}; const b = {};
  a.postMessage = (data) => b.onmessage && b.onmessage({ data });
  b.postMessage = (data) => a.onmessage && a.onmessage({ data });
  this.port1 = a; this.port2 = b;
}

/**
 * A phone's link. spec(url, try) → { hang?, status?, size, chunk, every, latency }: hang = never answers (until aborted);
 * the body comes `chunk` bytes every `every` ms. deadAt (ms from the start): nothing answers after it and open bodies stop.
 */
function makeNet({ spec, deadAt = null }) {
  const tries = {};
  const t0 = Date.now();
  const dead = () => deadAt != null && Date.now() - t0 >= deadAt;
  const fetchFn = (u, init) => {
    tries[u] = (tries[u] || 0) + 1;
    const sig = init && init.signal;
    const s = spec(u, tries[u]);
    return new Promise((resolve, reject) => {
      if (sig) sig.addEventListener('abort', () => reject(new Error('aborted')));
      if (s.hang) return;
      setTimeout(() => {
        if (dead()) return;
        if (s.status && s.status !== 200) { resolve(new Response('not found', { status: s.status })); return; }
        let sent = 0;
        let timer = null;
        const body = new ReadableStream({
          start(c) {
            const push = () => {
              if (dead()) return; // the body stops, the request stays open
              const k = Math.min(s.chunk, s.size - sent);
              c.enqueue(new Uint8Array(k));
              sent += k;
              if (sent >= s.size) c.close(); else timer = setTimeout(push, s.every);
            };
            if (sig) sig.addEventListener('abort', () => { clearTimeout(timer); try { c.error(new Error('aborted')); } catch (_) { /* closed */ } });
            timer = setTimeout(push, s.every);
          },
        });
        resolve(new Response(body, { status: 200, headers: { 'content-type': s.type || 'audio/mpeg' } }));
      }, s.latency != null ? s.latency : 100);
    });
  };
  return { fetchFn, tries };
}

/** The page's sa-offline.js and the worker's sw.js, fresh, over one phone cache and one link. */
function phone(net) {
  const cache = new Map();
  let swMod;
  let page;
  const io = {
    fetch: net.fetchFn,
    match: async (u) => cache.get(u),
    put: async (u, res) => { const buf = await res.arrayBuffer(); cache.set(u, buf); },
    ok: (u, res) => !!res && res.ok,
    abort: () => new AbortController(),
  };
  const sw = {
    postMessage(msg, [port]) {
      // the build stamp's own ask: the real worker answers it from its caches, never the network (sw.js message handler)
      if (msg.type === 'held') { port.postMessage({ sw: swMod.VERSION, session: null }); return; }
      if (typeof swMod.prepareReply === 'function') { swMod.prepareReply(msg, msg.urls, port, io); return; }
      // the worker as it was: prefetch, then the answer
      let bytes = 0;
      swMod.prefetch(msg.urls, Object.assign({}, io, { fresh: msg.fresh || [], onBytes: (n) => { bytes += n; } })).then((missing) => {
        port.postMessage({ ok: missing.length === 0, cached: msg.urls.length - missing.length, missing, bytes });
      });
    },
  };
  const keep = global.self;
  global.self = {
    navigator: { serviceWorker: { register: async () => ({}), ready: Promise.resolve({ active: sw }) } },
    MessageChannel: Channel,
    caches: { match: async (u) => cache.get(u) },
  };
  jest.isolateModules(() => { swMod = require('../sa/sw'); page = require('../sa/sa-offline'); });
  global.self = keep;
  return { cache, page, swMod };
}

// the welcome (opening), three more lines, and 24 task clips
function battery(n = 24) {
  const tasks = [];
  for (let i = 0; i < n; i++) tasks.push({ id: `t${i}`, mode: 'tap', instruction: { text: 'x', audio: `sa/v4/ur/task${i}.mp3` }, items: [] });
  return {
    battery_id: 'b',
    lines: {
      welcome: { ur: 'سلام', audio: 'sa/v4/ur/welcome.mp3' },
      a: { ur: 'ا', audio: 'sa/v4/ur/line-a.mp3' },
      b: { ur: 'ب', audio: 'sa/v4/ur/line-b.mp3' },
      c: { ur: 'ج', audio: 'sa/v4/ur/line-c.mp3' },
    },
    tasks,
  };
}

const BURL = '/sa/batteries/sa.coach.G2.A.ur.json';
const json = { size: 4 * KB, chunk: 4 * KB, every: 50, type: 'application/json' };

/** Runs a promise on the fake clock, a second at a time, up to capS. → { value, at } (at = ms on the clock) */
async function settle(p, capS = 900) {
  let done = false; let value; const t0 = Date.now();
  p.then((v) => { done = true; value = v; }, (e) => { done = true; value = { error: String(e) }; });
  for (let i = 0; i < capS && !done; i++) await jest.advanceTimersByTimeAsync(1000);
  return { value, at: Date.now() - t0, done };
}

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] }); });
afterEach(() => { jest.useRealTimers(); });

function prepareOn(p, b) {
  return p.page.prepareSession(b, { lang: 'ur', battery_url: BURL, base: '/', speech: null, storage: null, localStorage: null });
}

describe('(a) a slow link that keeps delivering is waited for', () => {
  test('R1: 16 KB clips at 1 KB/s each (a stage takes over 60 s) and one clip whose first try hangs → voice clips, the hung clip tried again', async () => {
    const hung = '/sa/v4/ur/task7.mp3';
    const net = makeNet({ spec: (u, n) => (u === BURL ? json : u === hung && n === 1 ? { hang: true } : { size: 16 * KB, chunk: KB, every: 1000 }) });
    const p = phone(net);
    const b = battery();
    const r = await settle(prepareOn(p, b));
    expect(r.done).toBe(true);
    expect(r.value.voice).toBe('clips');
    expect(r.value.clips_cached).toBe(r.value.clips_total);
    expect(r.value.prep_gaveup_stage).toBeNull();
    expect(r.value.prep_missing).toBe(0);
    expect(net.tries[hung]).toBe(2);
    expect(r.value.prep_ms).toBeGreaterThan(60000);
    expect(r.value.prep_bytes).toBeGreaterThanOrEqual(28 * 16 * KB);
  });
});

describe('(d) a slow clip is never cut; a stalled one is', () => {
  test('R2: one 40 KB clip trickling at 1 KB/s (40 s) is not aborted and is kept, on its first try', async () => {
    const slow = '/sa/v4/ur/task3.mp3';
    const net = makeNet({ spec: (u) => (u === BURL ? json : u === slow ? { size: 40 * KB, chunk: KB, every: 1000 } : { size: 8 * KB, chunk: 8 * KB, every: 200 }) });
    const p = phone(net);
    const r = await settle(prepareOn(p, battery()));
    expect(r.value.voice).toBe('clips');
    expect(net.tries[slow]).toBe(1);
    expect(p.cache.get(slow).byteLength).toBe(40 * KB);
  });

  test('a body that stops half way is given up after 20 s with no bytes and tried once more', async () => {
    const swMod = phone(makeNet({ spec: () => json })).swMod;
    const net = makeNet({ spec: (u, n) => (n === 1 ? { size: 8 * KB, chunk: 4 * KB, every: 500, latency: 100, stopAfter: 4 * KB } : { size: 8 * KB, chunk: 8 * KB, every: 100 }) });
    // the first try sends half its body, then nothing
    const base = net.fetchFn;
    const fetchFn = (u, init) => base(u, init).then((res) => {
      if (net.tries[u] !== 1) return res;
      const r = res.body.getReader();
      let first = true;
      const body = new ReadableStream({
        pull(c) {
          if (!first) return new Promise((_, no) => { if (init && init.signal) init.signal.addEventListener('abort', () => no(new Error('aborted'))); });
          first = false;
          return r.read().then((x) => { if (x.done) c.close(); else c.enqueue(x.value); });
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    });
    const kept = new Map();
    const t0 = Date.now();
    const r = await settle(swMod.prefetch(['/sa/v4/ur/x.mp3'], {
      fetch: fetchFn, match: async () => null, put: async (u, res) => { kept.set(u, await res.arrayBuffer()); }, ok: () => true,
      abort: () => new AbortController(),
    }), 120);
    expect(r.done).toBe(true);
    expect(r.value).toEqual([]);
    expect(net.tries['/sa/v4/ur/x.mp3']).toBe(2);
    expect(kept.get('/sa/v4/ur/x.mp3').byteLength).toBe(8 * KB);
    expect(r.at - 0).toBeLessThan(60000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20000);
  });
});

describe('(b) a dead link gives up and counts the phone', () => {
  test('R3: the link dies 30 s in → the stage gives up 20 s after the last progress, and clips_cached is what the phone holds', async () => {
    const net = makeNet({ deadAt: 30000, spec: (u) => (u === BURL ? json : { size: 8 * KB, chunk: KB, every: 1000 }) });
    const p = phone(net);
    const b = battery();
    const r = await settle(prepareOn(p, b));
    expect(r.done).toBe(true);
    const onPhone = p.page.urls(b, 'ur', '/').filter((u) => p.cache.has(u)).length;
    expect(onPhone).toBeGreaterThan(5);
    expect(r.value.clips_cached).toBe(onPhone);
    expect(r.value.prep_missing).toBe(r.value.clips_total - onPhone);
    expect(r.value.prep_gaveup_stage).toBe('rest');
    expect(r.value.voice).toBe('none');
    // three stages at most, each given up 20 s after its last news (no 60 s windows)
    expect(r.at).toBeLessThan(30000 + 3 * 20000 + 10000);
  });

  test('R1b: a clip dead on every try (404) keeps today\'s rule: not all clips → not clips; the missing count is logged, no stage gave up', async () => {
    const gone = '/sa/v4/ur/task5.mp3';
    const net = makeNet({ spec: (u) => (u === BURL ? json : u === gone ? { status: 404 } : { size: 8 * KB, chunk: 8 * KB, every: 200 }) });
    const p = phone(net);
    const r = await settle(prepareOn(p, battery()));
    expect(r.value.voice).toBe('none');
    expect(r.value.clips_cached).toBe(r.value.clips_total - 1);
    expect(r.value.prep_missing).toBe(1);
    expect(r.value.prep_gaveup_stage).toBeNull();
    expect(net.tries[gone]).toBe(2);
  });
});

describe('(e) a second prepare joins the downloads already running', () => {
  test('R4: a Try again 10 s into a prepare makes 0 duplicate requests, and both reach the single prepare\'s verdict', async () => {
    const net = makeNet({ spec: (u) => (u === BURL ? json : { size: 16 * KB, chunk: 2 * KB, every: 1000 }) });
    const p = phone(net);
    const b = battery();
    const one = prepareOn(p, b);
    await jest.advanceTimersByTimeAsync(10000);
    const two = prepareOn(p, b);
    const [r1, r2] = [await settle(one), await settle(two)];
    expect(r1.value.voice).toBe('clips');
    expect(r2.value.voice).toBe('clips');
    const dups = Object.entries(net.tries).filter(([u, n]) => n > 1 && /\.mp3$/.test(u));
    expect(dups).toEqual([]);
  });

  // A battery file is asked for `fresh` when a switch may have changed it under the same URL: a fresh ask must never end on
  // the copy a plain prepare is still matching. Both directions, every join window; a plain ask may join a fresh download.
  describe('a fresh ask never joins a plain prepare that may end on the kept copy', () => {
    const BAT = 'http://x/sa/batteries/sa.coach.G2.A.ur.json';
    const CLIP = 'http://x/sa/v4/ur/abc.mp3';
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    async function race(o) {
      const store = Object.assign({}, o.kept || {});
      const reqs = {};
      const sw = require('../sa/sw');
      const base = {
        fetch: async (u) => { reqs[u] = (reqs[u] || 0) + 1; await pause(o.fetchMs || 20); return { ok: true, status: 200, body: null, headers: { get: () => null }, v: o.net[u] }; },
        match: async (u) => { await pause(o.matchMs || 0); return store[u] ? { v: store[u] } : null; },
        put: async (u, res) => { store[u] = res.v; },
        ok: (u, res) => !!(res && res.ok),
        inflight: {}, retryMs: 5, idleMs: 2000,
      };
      const a = sw.prefetch(o.urls, Object.assign({}, base, { fresh: o.freshA || [] }));
      await pause(o.bAtMs || 0);
      const b = sw.prefetch(o.urls, Object.assign({}, base, { fresh: o.freshB || [] }));
      const [ma, mb] = await Promise.all([a, b]);
      return { kept: store[o.urls[0]], requests: reqs[o.urls[0]] || 0, missing: ma.length + mb.length };
    }
    beforeEach(() => { jest.useRealTimers(); });

    test.each([[50, 10], [200, 50], [5, 1], [0, 0]])('a plain prepare matching the kept copy (match %i ms), a fresh ask %i ms later → the network copy, 1 request', async (m, at) => {
      const r = await race({ urls: [BAT], kept: { [BAT]: 'OLD' }, net: { [BAT]: 'NEW' }, matchMs: m, bAtMs: at, freshB: [BAT] });
      expect(r).toEqual({ kept: 'NEW', requests: 1, missing: 0 });
    });
    test('the fresh ask first, a plain one joins it → the network copy, 1 request', async () => {
      const r = await race({ urls: [BAT], kept: { [BAT]: 'OLD' }, net: { [BAT]: 'NEW' }, matchMs: 50, bAtMs: 5, freshA: [BAT] });
      expect(r).toEqual({ kept: 'NEW', requests: 1, missing: 0 });
    });
    test('two plain prepares of a clip not on the phone → 1 request (R4)', async () => {
      const r = await race({ urls: [CLIP], net: { [CLIP]: 'NEW' }, fetchMs: 50, bAtMs: 10 });
      expect(r).toEqual({ kept: 'NEW', requests: 1, missing: 0 });
    });
    test('two fresh asks → 1 request', async () => {
      const r = await race({ urls: [BAT], kept: { [BAT]: 'OLD' }, net: { [BAT]: 'NEW' }, fetchMs: 50, bAtMs: 10, freshA: [BAT], freshB: [BAT] });
      expect(r).toEqual({ kept: 'NEW', requests: 1, missing: 0 });
    });
  });

  test('(c) still six at a time per prepare', async () => {
    let inFlight = 0; let most = 0;
    const net = makeNet({ spec: () => ({ size: 4 * KB, chunk: 4 * KB, every: 500 }) });
    const fetchFn = (u, init) => { inFlight++; most = Math.max(most, inFlight); return net.fetchFn(u, init).then((res) => res); };
    const { swMod } = phone(net);
    const urls = Array.from({ length: 20 }, (_, i) => `/sa/v4/ur/c${i}.mp3`);
    const r = await settle(swMod.prefetch(urls, {
      fetch: fetchFn, match: async () => null, put: async (u, res) => { await res.arrayBuffer(); inFlight--; }, ok: () => true,
      abort: () => new AbortController(),
    }), 120);
    expect(r.value).toEqual([]);
    expect(most).toBeLessThanOrEqual(6);
    expect(swMod.PREFETCH_AT_ONCE).toBe(6);
  });
});

describe('the worker\'s progress and an older page or worker', () => {
  test('with progress: true the worker says so at once and at least every 5 s; without it, only the answer (an older page)', async () => {
    const net = makeNet({ spec: () => ({ size: 16 * KB, chunk: KB, every: 1000 }) });
    const { swMod } = phone(net);
    const io = { fetch: net.fetchFn, match: async () => null, put: async (u, res) => { await res.arrayBuffer(); }, ok: () => true, abort: () => new AbortController() };
    const got = []; const old = [];
    swMod.prepareReply({ type: 'prepare', urls: ['/a.mp3'], progress: true }, ['/a.mp3'], { postMessage: (m) => got.push([Date.now(), m]) }, io);
    swMod.prepareReply({ type: 'prepare', urls: ['/b.mp3'] }, ['/b.mp3'], { postMessage: (m) => old.push(m) }, io);
    await jest.advanceTimersByTimeAsync(30000);
    const prog = got.filter(([, m]) => m.type === 'progress');
    expect(prog.length).toBeGreaterThanOrEqual(3);
    expect(prog[prog.length - 1][1].bytes).toBeGreaterThan(0);
    for (let i = 1; i < prog.length; i++) expect(prog[i][0] - prog[i - 1][0]).toBeLessThanOrEqual(5000);
    expect(got[got.length - 1][1]).toEqual(expect.objectContaining({ ok: true, cached: 1, missing: [] }));
    expect(old).toHaveLength(1);
    expect(old[0].type).toBeUndefined();
  });

  test('a worker that never reports progress (the previous one, still active) keeps the old 60 s window, never 20 s', async () => {
    const asks = [];
    const sw = { postMessage(msg, [port]) { asks.push([Date.now(), port]); } }; // answers nothing, ever
    const keep = global.self;
    const cache = new Map();
    global.self = { navigator: { serviceWorker: { register: async () => ({}), ready: Promise.resolve({ active: sw }) } }, MessageChannel: Channel, caches: { match: async (u) => cache.get(u) } };
    let page;
    jest.isolateModules(() => { page = require('../sa/sa-offline'); });
    global.self = keep;
    const r = await settle(page.prepare({ battery_url: BURL, battery: battery(2), lang: 'ur', base: '/' }), 400);
    expect(r.done).toBe(true);
    expect(r.at).toBeGreaterThanOrEqual(3 * 60000);
  });
});

describe('the device fields reach device_ready', () => {
  test('voiceGate logs prep_ms, prep_bytes, prep_gaveup_stage and prep_missing beside clips_cached', async () => {
    const pageJs = require('../sa/sa-page');
    const logs = [];
    const engine = { session_id: 's', runner: { log: (t, d) => logs.push([t, d]) }, view: { refuse: () => {} } };
    const o = { ready: true, voice: 'clips', persisted: true, clips_total: 150, clips_cached: 150, prep_ms: 91020, prep_bytes: 2400000, prep_gaveup_stage: null, prep_missing: 0 };
    await pageJs.voiceGate(engine, Promise.resolve(o), {});
    const v = logs.find(([t]) => t === 'device_ready')[1].value;
    expect(v).toEqual(expect.objectContaining({ clips_cached: 150, prep_ms: 91020, prep_bytes: 2400000, prep_gaveup_stage: null, prep_missing: 0 }));
    expect(JSON.stringify(v).length).toBeLessThan(300); // the server keeps an event's data up to 300 characters
  });
});

describe('the cache', () => {
  // The clips a phone holds live in this cache, so moving SESSION is a deliberate act that edits this line too.
  // It is not read from the lock: a real bump re-cuts the lock under the new name, and the check must still go red.
  const EXPECTED_SESSION = 'sa-session-v34';

  // the worker's SESSION from its source, run as the tests load it (module.exports, no service-worker globals)
  function sessionOf(src) {
    const module = { exports: {} };
    require('vm').runInNewContext(src, { module, Promise, Math, Date, JSON, String, Object, Array, setTimeout, clearTimeout });
    return module.exports.SESSION;
  }
  const SW_SRC = require('fs').readFileSync(require('path').join(__dirname, '../sa/sw.js'), 'utf8');
  // the one check both rows run: does this worker source still hold the pinned cache?
  const pinHolds = (src) => sessionOf(src) === EXPECTED_SESSION;

  test('VERSION moves on (the phones take the new worker and engine files); SESSION does not (they keep their clips)', () => {
    const sw = require('../sa/sw');
    expect(Number(sw.VERSION.replace('sa-', ''))).toBeGreaterThanOrEqual(39); // sa-39 or a later bump stacked on it
    expect(sw.SESSION).toBe(EXPECTED_SESSION);
    expect(pinHolds(SW_SRC)).toBe(true); // the source the next row rewrites is the worker under test
  });

  test('a worker whose SESSION moved fails the check, with or without the clips lock re-cut under the new name', () => {
    const next = 'sa-session-v' + (Number(EXPECTED_SESSION.split('-v')[1]) + 1); // the next bump, whatever today's is
    const bumped = SW_SRC.replace(/var SESSION = 'sa-session-v\d+';/, "var SESSION = '" + next + "';");
    expect(sessionOf(bumped)).toBe(next);
    const recutLock = Object.assign({}, require('../sa/clips.lock.json'), { session: next });
    expect(recutLock.session).toBe(sessionOf(bumped)); // the real bump: worker and lock agree again
    expect(pinHolds(bumped)).toBe(false); // and the same check the pin row runs goes red
  });
});
