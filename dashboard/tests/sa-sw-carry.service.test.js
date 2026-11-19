'use strict';
/**
 * A SESSION bump keeps what did not change (dashboard/sa/sw.js, install and activate). A new SESSION's cache takes an older
 * cache's entry if, and only if, the entry's own bytes hash (SHA-1) to the NEW lock's sha1 for its path. Anything else is
 * fetched by the next prepare; no record from an earlier worker is needed. The battery files are never carried. activate
 * makes a second pass (what the old worker kept while the new one installed) and only then deletes the older cache.
 *
 * The worker runs in a vm with an in-memory Cache Storage (real Request/Response/crypto), driven through its own install,
 * activate and message listeners, so every row executes the shipped code path.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../sa/sw.js'), 'utf8');
// The worker phones run before this change (sa-40, no carry): the phone's starting point in every row.
const BEFORE = fs.readFileSync(path.join(__dirname, 'fixtures/sa-sw-before-carry.js'), 'utf8');
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, '../sa/clips.lock.json'), 'utf8'));
const ORIGIN = 'https://portal.test';
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const typeOf = (p) => (/\.mp3$/.test(p) ? 'audio/mpeg' : /\.json$/.test(p) ? 'application/json' : /\.webp$/.test(p) ? 'image/webp' : 'application/javascript');

/** lock path → served URL (the batteries are served by name at /sa/batteries/). */
function urlOf(p) {
  if (p.startsWith('dashboard/sa/')) return `${ORIGIN}/sa/${p.slice('dashboard/sa/'.length)}`;
  return `${ORIGIN}/sa/batteries/${path.basename(p)}`;
}

/** A tree: { session, files: { lockPath: Buffer } }, its lock, and what it serves. */
function tree(session, files, { unlocked = [] } = {}) {
  const lock = { session, about: 'test', files: {} };
  for (const [p, b] of Object.entries(files)) if (!unlocked.includes(p)) lock.files[p] = sha1(b);
  const served = new Map(Object.entries(files).map(([p, b]) => [urlOf(p), b]));
  return { session, files, lock, served };
}

/** In-memory Cache Storage shared by every worker the "phone" runs. */
function phone() {
  const stores = new Map();
  const norm = (r) => { const u = new URL(typeof r === 'string' ? r : r.url, `${ORIGIN}/sa/`); return u.toString(); };
  const noSearch = (r) => { const u = new URL(norm(r)); u.search = ''; return u.toString(); };
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: (r, o) => {
        let v = m.get(norm(r));
        if (!v && o && o.ignoreSearch) { const k = noSearch(r); for (const [key, x] of m) if (noSearch(key) === k) { v = x; break; } }
        return Promise.resolve(v ? new Response(v.buf, { status: 200, headers: v.headers }) : undefined);
      },
      put: (r, res) => res.arrayBuffer().then((ab) => { m.set(norm(r), { buf: Buffer.from(ab), headers: [...res.headers] }); }),
      keys: () => Promise.resolve([...m.keys()].map((k) => new Request(k))),
      delete: (r) => Promise.resolve(m.delete(norm(r))),
    };
  }
  const caches = {
    open: (n) => Promise.resolve(store(n)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (n) => Promise.resolve(stores.delete(n)),
    has: (n) => Promise.resolve(stores.has(n)),
    match: async (r, o) => { for (const n of stores.keys()) { const hit = await store(n).match(r, o); if (hit) return hit; } return undefined; },
  };
  return { stores, caches };
}

/** A server answering one tree; net counts every request by URL. */
function server() {
  const s = { tree: null, net: [], lockStatus: 200, lockSession: null };
  s.fetch = (u) => {
    const url = typeof u === 'string' ? u : u.url;
    const p = new URL(url).pathname;
    s.net.push(url);
    if (p === '/sa/clips.lock.json') {
      if (s.lockStatus !== 200) return Promise.resolve(new Response('no', { status: s.lockStatus, headers: { 'content-type': 'text/plain' } }));
      const lock = s.lockSession ? Object.assign({}, s.tree.lock, { session: s.lockSession }) : s.tree.lock;
      return Promise.resolve(new Response(JSON.stringify(lock), { headers: { 'content-type': 'application/json' } }));
    }
    if (/^\/sa\/[^/]+\.(js|css|html)$/.test(p)) return Promise.resolve(new Response('core', { headers: { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript' } }));
    const key = new URL(url); key.search = '';
    const b = s.tree.served.get(key.toString());
    if (!b) return Promise.resolve(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
    return Promise.resolve(new Response(b, { headers: { 'content-type': typeOf(p), 'content-length': String(b.length) } }));
  };
  return s;
}

/** The worker's source with its SESSION and VERSION set, run in a vm on the phone; returns its listeners. */
function boot(ph, srv, { session, version, src = SRC }) {
  const code = src.replace(/^var SESSION = '[^']*';/m, `var SESSION = '${session}';`).replace(/^var VERSION = '[^']*';/m, `var VERSION = '${version}';`);
  const listeners = {};
  const self = {
    location: { href: `${ORIGIN}/sa/sw.js`, origin: ORIGIN },
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  vm.runInNewContext(code, {
    self, caches: ph.caches, fetch: srv.fetch, URL, Request, Response, Headers, Promise, setTimeout, clearTimeout,
    setInterval, clearInterval, console, crypto: globalThis.crypto, AbortController, TextEncoder, TextDecoder,
  });
  return listeners;
}

const settle = (fn, ev = {}) => { let p = Promise.resolve(); fn(Object.assign({ waitUntil: (x) => { p = x; } }, ev)); return p; };

/** Install, then activate, a worker (a deploy reaching the phone). */
async function deploy(ph, srv, o) {
  const l = boot(ph, srv, o);
  await settle(l.install);
  await settle(l.activate);
  return l;
}

/** prepare(urls, fresh?) through the worker's message listener → its answer. */
function prepare(l, urls, fresh) {
  return new Promise((resolve) => {
    const port = { postMessage: (m) => { if (!m || m.type !== 'progress') resolve(m); } };
    const d = { type: 'prepare', urls };
    if (fresh) d.fresh = fresh;
    settle(l.message, { data: d, ports: [port] });
  });
}

const OLD = 'sa-session-v29';
const NEW = 'sa-session-v30';
const isBattery = (p) => p.startsWith('bot/');

/** Tree A: every path of the real lock, synthetic bytes. */
function treeA(extra = {}, opts) {
  const files = {};
  for (const p of Object.keys(REAL.files)) files[p] = Buffer.from(`A:${p}`);
  return tree(OLD, Object.assign(files, extra), opts);
}

/** Phone on the deployed worker before this change (sa-40, SESSION v29) prepares tree A; then (straight from it) the
 * bump to v30 reaches it. Returns what the v30 prepare fetched. */
async function bump(A, B, { middle = false, beforeBump, betweenInstallAndActivate, lockSession, lockStatus } = {}) {
  const ph = phone();
  const srv = server();
  srv.tree = A;
  const first = await deploy(ph, srv, { session: OLD, version: 'sa-40', src: BEFORE });
  const urlsA = [...A.served.keys()];
  const prepA = await prepare(first, urlsA);
  expect(prepA.missing).toEqual([]);
  // optionally a carry worker first with SESSION unchanged (nothing older to carry from: it reads no lock)
  if (middle) {
    srv.net = [];
    await deploy(ph, srv, { session: OLD, version: 'sa-41' });
    expect(srv.net.filter((u) => /clips\.lock\.json$/.test(u))).toEqual([]);
  }
  if (beforeBump) await beforeBump(ph);
  srv.tree = B;
  srv.lockSession = lockSession || null;
  if (lockStatus) srv.lockStatus = lockStatus;
  const l = boot(ph, srv, { session: NEW, version: 'sa-43' });
  await settle(l.install);
  const afterInstall = { keys: [...ph.stores.keys()], carried: [...(ph.stores.get(NEW) || new Map()).keys()] };
  if (betweenInstallAndActivate) await betweenInstallAndActivate({ ph, srv, first });
  await settle(l.activate);
  const afterActivate = { keys: [...ph.stores.keys()], carried: new Map(ph.stores.get(NEW) || []) };
  srv.net = [];
  const urlsB = [...B.served.keys()];
  const res = await prepare(l, urlsB);
  const fetched = srv.net.filter((u) => !/\/sa\/[^/]+\.(js|css|html)$/.test(new URL(u).pathname) && !/clips\.lock\.json$/.test(u));
  return { ph, res, fetched, afterInstall, afterActivate, urlsB };
}

describe('sw.js carries unchanged clips across a SESSION bump', () => {
  jest.setTimeout(60000);

  it('(i) 16 batteries changed and 121 new files: exactly those 137 are fetched, the other unchanged files are kept', async () => {
    const A = treeA();
    const filesB = Object.assign({}, A.files);
    const bats = Object.keys(filesB).filter(isBattery);
    expect(bats).toHaveLength(16);
    for (const p of bats) filesB[p] = Buffer.from(`B:${p}`);
    const added = [];
    for (let i = 0; i < 121; i++) { const p = `dashboard/sa/v6/ur/${String(i).padStart(12, '0')}.mp3`; filesB[p] = Buffer.from(`new ${i}`); added.push(urlOf(p)); }
    const B = tree(NEW, filesB);
    const { res, fetched, urlsB } = await bump(A, B);
    expect(res.missing).toEqual([]);
    const want = [...bats.map(urlOf), ...added].sort();
    expect(fetched.slice().sort()).toEqual(want);
    expect(urlsB.length - fetched.length).toBe(Object.keys(A.files).length - 16);
  });

  it('(ii-a) no record from any earlier worker, bytes equal: carried (only the batteries are fetched)', async () => {
    const A = treeA();
    const B = tree(NEW, A.files);
    const { fetched } = await bump(A, B);
    expect(fetched.sort()).toEqual(Object.keys(A.files).filter(isBattery).map(urlOf).sort());
  });

  it('(ii-b) no record, the same key re-voiced: fetched, and the phone holds the new bytes', async () => {
    const A = treeA();
    const filesB = Object.assign({}, A.files);
    const revoiced = Object.keys(filesB).filter((p) => p.startsWith('dashboard/sa/v4/ur/') && p.endsWith('.mp3')).slice(0, 3);
    for (const p of revoiced) filesB[p] = Buffer.from(`take 2 ${p}`);
    const B = tree(NEW, filesB);
    const { fetched, ph } = await bump(A, B);
    expect(fetched.filter((u) => !/\/batteries\//.test(u)).sort()).toEqual(revoiced.map(urlOf).sort());
    const got = await (await ph.caches.open(NEW)).match(urlOf(revoiced[0]));
    expect(Buffer.from(await got.arrayBuffer()).toString()).toBe(`take 2 ${revoiced[0]}`);
  });

  it('(ii-c) a straight jump from today\'s worker to a bump: only the changed and new files are fetched', async () => {
    const A = treeA();
    const filesB = Object.assign({}, A.files);
    const changed = Object.keys(filesB).filter((p) => p.startsWith('dashboard/sa/v4/en/') && p.endsWith('.mp3')).slice(0, 7);
    for (const p of changed) filesB[p] = Buffer.from(`B:${p}`);
    const added = ['dashboard/sa/v6/en/000000000001.mp3', 'dashboard/sa/v6/en/000000000002.mp3'];
    for (const p of added) filesB[p] = Buffer.from(`new ${p}`);
    const B = tree(NEW, filesB);
    const { fetched } = await bump(A, B);
    const want = [...changed, ...added, ...Object.keys(A.files).filter(isBattery)].map(urlOf).sort();
    expect(fetched.sort()).toEqual(want);
  });

  it('an entry whose path the new lock does not name is not carried (it is fetched when asked for)', async () => {
    const extra = 'dashboard/sa/v5/ur/aaaaaaaaaaaa.mp3';
    const A = treeA({ [extra]: Buffer.from('served, not in the new lock') });
    const B = tree(NEW, A.files, { unlocked: [extra] });
    const { fetched } = await bump(A, B);
    expect(fetched.filter((u) => !/\/batteries\//.test(u))).toEqual([urlOf(extra)]);
  });

  it('a VERSION-only update (no older SESSION cache) reads no lock, and a later bump still carries', async () => {
    const A = treeA();
    const B = tree(NEW, A.files);
    const { fetched } = await bump(A, B, { middle: true });
    expect(fetched.sort()).toEqual(Object.keys(A.files).filter(isBattery).map(urlOf).sort());
  });

  it('C-1: what the old worker keeps after the install\'s copy (a prepare it answered) is in the new cache after activate', async () => {
    const A = treeA();
    const late = 'dashboard/sa/v6/ur/late00000001.mp3';
    const B = tree(NEW, Object.assign({}, A.files, { [late]: Buffer.from('asked during install') }));
    let answer = null;
    const { afterActivate } = await bump(A, B, {
      betweenInstallAndActivate: async ({ ph: on, srv, first }) => {
        const keep = srv.tree;
        srv.tree = B; // the server already serves the new tree
        answer = await prepare(first, [urlOf(late)]);
        srv.tree = keep;
        expect((await (await on.caches.open(NEW)).match(urlOf(late)))).toBeUndefined();
      },
    });
    expect(answer.missing).toEqual([]);
    // read straight after activate, before any prepare of the new worker could fetch it
    expect(afterActivate.keys).not.toContain(OLD);
    const got = afterActivate.carried.get(urlOf(late));
    expect(got && got.buf.toString()).toBe('asked during install');
  });

  it('(iii) a short or corrupt old entry (bytes not the lock\'s) is fetched', async () => {
    const A = treeA();
    const B = tree(NEW, A.files);
    const shortP = 'dashboard/sa/v4/ur/' + Object.keys(A.files).find((p) => p.startsWith('dashboard/sa/v4/ur/')).split('/').pop();
    const corruptP = Object.keys(A.files).filter((p) => p.startsWith('dashboard/sa/v4/en/') && p.endsWith('.mp3'))[0];
    const { fetched } = await bump(A, B, {
      beforeBump: async (ph) => {
        const c = ph.stores.get(OLD);
        const short = c.get(urlOf(shortP)); short.buf = short.buf.subarray(0, 3);
        const bad = c.get(urlOf(corruptP)); bad.buf = Buffer.from(bad.buf.toString().replace(/A/g, 'Z'));
      },
    });
    expect(fetched.filter((u) => !/\/batteries\//.test(u)).sort()).toEqual([urlOf(shortP), urlOf(corruptP)].sort());
  });

  it('(iv) the old cache is still there after install (the copy) and goes only at activate', async () => {
    const A = treeA();
    const B = tree(NEW, A.files);
    const { afterInstall, ph } = await bump(A, B);
    expect(afterInstall.keys).toEqual(expect.arrayContaining([OLD, NEW]));
    expect(afterInstall.carried.length).toBeGreaterThan(4000);
    expect([...ph.stores.keys()]).not.toContain(OLD);
  });

  it('(v) a battery file is never carried, even unchanged and asked without fresh', async () => {
    const A = treeA();
    const B = tree(NEW, A.files);
    const { afterInstall, fetched } = await bump(A, B);
    expect(afterInstall.carried.filter((u) => /\/sa\/batteries\//.test(u))).toEqual([]);
    expect(fetched.sort()).toEqual(Object.keys(A.files).filter(isBattery).map(urlOf).sort());
  });

  it('(vi) a path unchanged whose bytes changed (re-voiced under its key) is fetched', async () => {
    const A = treeA();
    const filesB = Object.assign({}, A.files);
    const revoiced = Object.keys(filesB).filter((p) => p.startsWith('dashboard/sa/v4/ur/') && p.endsWith('.mp3')).slice(0, 5);
    for (const p of revoiced) filesB[p] = Buffer.from(`re-voiced ${p}`);
    const B = tree(NEW, filesB);
    const { fetched, ph } = await bump(A, B);
    expect(fetched.filter((u) => !/\/batteries\//.test(u)).sort()).toEqual(revoiced.map(urlOf).sort());
    const got = await (await ph.caches.open(NEW)).match(urlOf(revoiced[0]));
    expect(Buffer.from(await got.arrayBuffer()).toString()).toBe(`re-voiced ${revoiced[0]}`);
  });

  it('a lock that names another SESSION, or none served, carries nothing (everything fetched) and the install still completes', async () => {
    const A = treeA();
    const B = tree(NEW, A.files);
    const wrong = await bump(A, B, { lockSession: 'sa-session-v31' });
    expect(wrong.fetched.length).toBe(wrong.urlsB.length);
    const none = await bump(A, B, { lockStatus: 404 });
    expect(none.fetched.length).toBe(none.urlsB.length);
    expect(none.res.missing).toEqual([]);
  });
});
