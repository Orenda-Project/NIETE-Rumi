'use strict';
/**
 * Round 8 (the reviewer's 28 Oct list: "loading the roster and the test in advance", "once a test starts it should run
 * offline"): the coach page puts a visit's batteries on the phone before the school (switches sa_r8_offline_prep and
 * sa_r8_offline_first).
 *
 *   sw.js       a prepare re-reads its `fresh` URLs from the network (a battery file changes under one URL when a switch
 *               flips) but keeps the cached copy when the network fails; it reports the bytes it fetched; a check
 *               message answers what is on the phone without fetching anything.
 *   sa-offline  prepVisit({ forms }) reads each battery fresh, then asks for every clip in its language and every
 *               picture, a chunk at a time with progress; checkVisit({ forms }) says whether all of it is there.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { prepVisit, checkVisit, urls, images } = require('../sa/sa-offline');
const MINI = require('./fixtures/sa-battery.g3-ur.mini.json');

const SRC = fs.readFileSync(path.join(__dirname, '../sa/sw.js'), 'utf8');
const O = 'https://portal.test';

function res(type, body, len) {
  return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : h.toLowerCase() === 'content-length' ? String(len) : null) }, body };
}

/** The worker in a sandbox: kept = url → body; net(url) → a response or a throw; fetched = every network read. */
function bootWorker(kept, net) {
  const listeners = {};
  const fetched = [];
  const store = new Map(Object.entries(kept || {}));
  const self = {
    location: { href: `${O}/sa/sw.js` },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const abs = (u) => new URL(u, `${O}/sa/`).href;
  const caches = {
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    match: (u) => Promise.resolve(store.has(abs(u)) ? res('audio/mpeg', store.get(abs(u)), 1) : undefined),
    open: () => Promise.resolve({ put: (u, r) => { store.set(abs(u), r.body); return Promise.resolve(); } }),
  };
  const fetch = (u) => { fetched.push(abs(u)); return Promise.resolve().then(() => net(abs(u))); };
  vm.runInNewContext(SRC, { self, caches, URL, Promise, fetch, setTimeout: (fn) => setTimeout(fn, 0), console });
  function send(msg) {
    return new Promise((ok) => {
      let wait;
      listeners.message({ data: msg, ports: [{ postMessage: ok }], waitUntil: (p) => { wait = p; } });
      return wait;
    });
  }
  return { send, store, fetched };
}

const BAT = `${O}/sa/batteries/sa.coach.G3.A.ur.json`;
const CLIP = `${O}/sa/v1/ur/aaaaaaaaaaaa.mp3`;

describe('the worker (sw.js): fresh, bytes, check', () => {
  test('a fresh URL is read from the network even when a copy is kept, and the bytes are counted', async () => {
    const w = bootWorker({ [BAT]: 'old' }, (u) => (u.endsWith('.json') ? res('application/json', 'new', 700) : res('audio/mpeg', 'clip', 300)));
    const r = await w.send({ type: 'prepare', urls: [BAT, CLIP], fresh: [BAT] });
    expect(r).toMatchObject({ ok: true, cached: 2, missing: [], bytes: 1000 });
    expect(w.store.get(BAT)).toBe('new');
    expect(w.fetched.sort()).toEqual([BAT, CLIP].sort());
  });

  test('a fresh URL the network cannot give keeps the phone\'s copy and is not missing (prepared again while offline)', async () => {
    const w = bootWorker({ [BAT]: 'old' }, () => { throw new Error('offline'); });
    const r = await w.send({ type: 'prepare', urls: [BAT], fresh: [BAT] });
    expect(r).toMatchObject({ ok: true, cached: 1, missing: [], bytes: 0 });
    expect(w.store.get(BAT)).toBe('old');
  });

  test('without fresh, a kept file is never fetched again (the old prepare, unchanged)', async () => {
    const w = bootWorker({ [CLIP]: 'kept' }, () => res('audio/mpeg', 'x', 5));
    const r = await w.send({ type: 'prepare', urls: [CLIP] });
    expect(r).toMatchObject({ ok: true, cached: 1, missing: [] });
    expect(w.fetched).toEqual([]);
  });

  test('check answers what is on the phone and fetches nothing', async () => {
    const w = bootWorker({ [CLIP]: 'kept' }, () => res('audio/mpeg', 'x', 5));
    const r = await w.send({ type: 'check', urls: [CLIP, BAT] });
    expect(r).toEqual({ ok: false, cached: 1, missing: [BAT] });
    expect(w.fetched).toEqual([]);
  });
});

/** A fake worker for the page side: answers prepare/check from a set of URLs the network "has". */
function fakeAsk(onNet, kept) {
  const have = new Set(kept || []);
  const msgs = [];
  const ask = async (m) => {
    msgs.push(m);
    const missing = [];
    let bytes = 0;
    for (const u of m.urls) {
      if (m.type === 'check') { if (!have.has(u)) missing.push(u); continue; }
      if (onNet(u)) { have.add(u); bytes += 10; } else if (!have.has(u)) missing.push(u);
    }
    return m.type === 'check' ? { ok: !missing.length, cached: m.urls.length - missing.length, missing }
      : { ok: !missing.length, cached: m.urls.length - missing.length, missing, bytes };
  };
  return { ask, msgs, have };
}

describe('the page (sa-offline.js prepVisit / checkVisit)', () => {
  const FORM = 'sa.coach.G3.A.ur';
  const BURL = `/sa/batteries/${FORM}.json`;
  const all = [...urls(MINI, 'ur', '/'), ...images(MINI, 'ur'), ...require('../sa/sa-offline').ART];

  test('prepVisit: the battery fresh first, then every clip and picture in chunks, with progress, all on the phone', async () => {
    const f = fakeAsk(() => true);
    const seen = [];
    const r = await prepVisit({ forms: [FORM], ask: f.ask, readBattery: async (u) => (u === BURL ? MINI : null), chunk: 7, onProgress: (p) => seen.push(p) });
    expect(f.msgs[0]).toEqual({ type: 'prepare', urls: [BURL], fresh: [BURL] });
    expect(f.msgs.slice(1).every((m) => m.type === 'prepare' && m.urls.length <= 7 && !m.fresh)).toBe(true);
    const asked = f.msgs.slice(1).flatMap((m) => m.urls);
    expect(asked.sort()).toEqual([...new Set(all)].sort());
    expect(r).toMatchObject({ ok: true, total: all.length + 1, cached: all.length + 1, missing: 0 });
    expect(r.bytes).toBe((all.length + 1) * 10);
    expect(r.forms).toEqual([{ form: FORM, ok: true, files: all.length + 1 - require('../sa/sa-offline').ART.length, missing: 0 }]); // Jugnu's pictures are the visit's, not the form's
    expect(seen[seen.length - 1]).toMatchObject({ done: all.length + 1, total: all.length + 1 });
  });

  test('prepVisit with the network gone part-way: not ok, the missing count says how many, nothing throws', async () => {
    let n = 0;
    const f = fakeAsk(() => (n += 1) <= 5);
    const r = await prepVisit({ forms: [FORM], ask: f.ask, readBattery: async () => MINI, chunk: 50 });
    expect(r.ok).toBe(false);
    expect(r.missing).toBe(all.length + 1 - 5);
    expect(r.forms[0].ok).toBe(false);
  });

  test('prepVisit: a battery that cannot be read is that form missing, the other forms still go', async () => {
    const f = fakeAsk(() => true);
    const r = await prepVisit({ forms: ['sa.coach.G1.A.ur', FORM], ask: f.ask, readBattery: async (u) => (u === BURL ? MINI : null) });
    expect(r.ok).toBe(false);
    expect(r.forms.map((x) => [x.form, x.ok])).toEqual([['sa.coach.G1.A.ur', false], [FORM, true]]);
  });

  test('prepVisit ignores a name that is not a battery form (never builds a URL from it)', async () => {
    const f = fakeAsk(() => true);
    const r = await prepVisit({ forms: ['../../etc', FORM], ask: f.ask, readBattery: async () => MINI });
    expect(r.forms.map((x) => x.form)).toEqual([FORM]);
    expect(f.msgs[0].urls).toEqual([BURL]);
  });

  test('checkVisit: ready only when the battery and every clip and picture are on the phone; fetches nothing fresh', async () => {
    const f = fakeAsk(() => false, [BURL, ...all]);
    const r = await checkVisit({ forms: [FORM], ask: f.ask, readBattery: async () => MINI });
    expect(r).toMatchObject({ ready: true, total: all.length + 1, cached: all.length + 1 });
    expect(f.msgs.every((m) => m.type === 'check')).toBe(true);
    const g = fakeAsk(() => false, [BURL, ...all.slice(1)]);
    expect(await checkVisit({ forms: [FORM], ask: g.ask, readBattery: async () => MINI })).toMatchObject({ ready: false, cached: all.length });
    const h = fakeAsk(() => false, []);
    expect(await checkVisit({ forms: [FORM], ask: h.ask, readBattery: async () => null })).toMatchObject({ ready: false, cached: 0 });
  });

  test('no service worker on the phone: prepVisit and checkVisit answer not ready, never throw', async () => {
    expect(await prepVisit({ forms: [FORM] })).toMatchObject({ ok: false, why: 'no_service_worker' });
    expect(await checkVisit({ forms: [FORM] })).toMatchObject({ ready: false, why: 'no_service_worker' });
  });
});

describe('the child\'s own part (sa_r8_offline_first gates Start on it)', () => {
  const page = require('../sa/sa-page');
  const { partOf } = require('../sa/sa-offline');
  const FULL = (() => {
    // the fixture with a variant task and every block the page knows, so pick() and rotate() are both exercised
    const b = JSON.parse(JSON.stringify(MINI));
    const ids = b.tasks.map((t) => t.id);
    b.blocks = { B1: ids.slice(0, 2), B2: ids.slice(1, 3) };
    b.rdf = ids.slice(0, 2);
    b.rdf_items = { [ids[0]]: 2 };
    b.rdf_auto = ids.slice(1);
    b.rdf_manual = ids.slice(1);
    const t = b.tasks[1];
    t.variants = [{ id: 'v1', items: t.items.slice(0, 1) }, { id: 'v2', items: t.items.slice(1, 2) }];
    return b;
  })();

  test('partOf is exactly the page\'s own pick + rotate, for every block and session', () => {
    for (const block of [null, 'full', 'B1', 'B2', 'rdf', 'rdf_auto', 'rdf_manual', 'nope']) {
      for (const seed of ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3', 'dddddddd-4']) {
        const want = page.rotate(page.pick(FULL, block), seed);
        expect(partOf(FULL, block, seed)).toEqual(want);
        expect(urls(partOf(FULL, block, seed), 'ur', '/')).toEqual(urls(want, 'ur', '/'));
      }
    }
  });

  test('prepVisit with a part: the battery and only that part\'s clips and pictures', async () => {
    const f = fakeAsk(() => true);
    const part = { block: 'B1', seed: 'aaaaaaaa-1' };
    const want = [...urls(partOf(FULL, 'B1', 'aaaaaaaa-1'), 'ur', '/'), ...images(partOf(FULL, 'B1', 'aaaaaaaa-1'), 'ur'), ...require('../sa/sa-offline').ART];
    const r = await prepVisit({ forms: ['sa.coach.G3.A.ur'], part, ask: f.ask, readBattery: async () => FULL });
    const asked = f.msgs.slice(1).flatMap((m) => m.urls);
    expect(asked.sort()).toEqual([...new Set(want)].sort());
    expect(asked.length).toBeLessThan([...urls(FULL, 'ur', '/'), ...images(FULL, 'ur')].length);
    expect(r).toMatchObject({ ok: true, total: new Set(want).size + 1 });
  });
});

describe('Jugnu\'s pictures go on the phone too (they were missing offline: /wq/jugnu_<mood>.webp)', () => {
  const { ART } = require('../sa/sa-offline');
  test('ART is every mood the child\'s screens draw, and each file exists', () => {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '../sa/sa-ui.js'), 'utf8');
    const moods = new Set([...ui.matchAll(/jugnu\('([a-z]+)'/g)].map((m) => m[1]).concat(['correct', 'notyet']));
    for (const m of moods) expect(ART).toContain(`/wq/jugnu_${m}.webp`);
    for (const u of ART) expect(fs.existsSync(path.join(__dirname, '../public', u))).toBe(true);
  });
  test('prepVisit asks for them once, after the battery', async () => {
    const f = fakeAsk(() => true);
    await prepVisit({ forms: ['sa.coach.G3.A.ur', 'sa.coach.G3.A.en'], ask: f.ask, readBattery: async () => MINI });
    const asked = f.msgs.slice(1).flatMap((m) => m.urls);
    for (const u of ART) expect(asked.filter((x) => x === u)).toHaveLength(1);
  });
});
