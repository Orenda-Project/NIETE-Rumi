/**
 * The video library opened from the kid's hub (/lib/<hub token>): the shipped wq-lib.js on its own,
 * as the edge's library page loads it, in a vm with a small fake DOM. The bot API is the boundary.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIB = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-lib.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));
const V = (n) => `aaaaaa${String(n).padStart(2, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

function el(sel) {
  return { sel, listeners: {}, attrs: {}, innerHTML: '', addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n) { (this.listeners[n] || []).forEach((fn) => fn({})); }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; } };
}
function libPage({ lang = 'en', api = {}, kid = 'c1' } = {}) {
  const els = {};
  const root = el('#wql-root');
  root.querySelector = (s) => (els[s] = els[s] || el(s));
  const boot = { textContent: JSON.stringify({ view: 'lib', hub: 'HUBTOK', kid, lang }) };
  const fetches = [];
  const assigned = [];
  const ctx = {
    console, JSON, Promise, setTimeout: () => 0,
    document: { getElementById: (id) => (id === 'boot' ? boot : id === 'wql-root' ? root : null), querySelector: () => null, addEventListener() {} },
    location: { host: 'example.test', assign: (u) => assigned.push(u) },
    navigator: { userAgent: 'test' },
    fetch: (url, init) => {
      fetches.push({ url, init });
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      const r = hit ? api[hit] : {};
      const status = r && r.__status ? r.__status : 200;
      return Promise.resolve({ status, ok: status < 300, text: () => Promise.resolve(JSON.stringify(r)) });
    },
    requestIdleCallback: (fn) => fn(),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(LIB, ctx);
  return { ctx, root, els, fetches, assigned, html: () => root.innerHTML, moment: () => (/data-m="([^"]+)"/.exec(root.innerHTML) || [])[1] };
}

const L1 = { grade: '3', mine: null, grades: [{ g: '3', n: 6, art: '/wq/art/grade-3-1.webp' }], subjects: [{ key: 'Science', n: 3, art: '/wq/art/subject-science-1.webp' }] };
const L2 = { grade: '3', subject: 'Science', art: '/wq/art/subject-science-1.webp', chapters: [
  { name: 'Plants', videos: [{ vid: V(1), title: 'Roots', code: 'VID001', k: 'chipk1' }, { vid: V(2), title: 'Leaves' }] }] };
const API = { '/api/wq/lib/h/HUBTOK?kid=c1&s=Science': L2, '/api/wq/lib/h/HUBTOK?kid=c1': L1, '/api/wq/videos/start': { code: 'NEW001', k: 'chipnew' } };

test('opens on the subjects of the child\'s grade, from the hub token, with no Download (no session yet)', async () => {
  const p = libPage({ api: API });
  await flush(); await flush();
  expect(p.fetches[0].url).toBe('/api/wq/lib/h/HUBTOK?kid=c1');
  expect(p.moment()).toBe('M15');
  expect(p.html()).toContain('data-s="Science"');
  p.els['[data-s="Science"]'].fire('click');
  await flush(); await flush();
  expect(p.moment()).toBe('M15-ch');
  expect(p.html()).not.toContain('wql-dl');
});

test('a lesson with a class code opens /q/<code>?k=<chip>; one without asks start() with the hub token', async () => {
  const p = libPage({ api: API });
  await flush(); await flush();
  p.els['[data-s="Science"]'].fire('click');
  await flush(); await flush();
  p.els[`[data-v="${V(1)}"]`].fire('click');
  expect(p.assigned).toEqual(['/q/VID001?k=chipk1']);
  expect(p.fetches.some((f) => f.url === '/api/wq/videos/start')).toBe(false);
  const q = libPage({ api: API });
  await flush(); await flush();
  q.els['[data-s="Science"]'].fire('click');
  await flush(); await flush();
  q.els[`[data-v="${V(2)}"]`].fire('click');
  await flush(); await flush();
  const s = q.fetches.find((f) => f.url === '/api/wq/videos/start');
  expect(JSON.parse(s.init.body)).toEqual({ hub: 'HUBTOK', kid: 'c1', vid: V(2) });
  expect(q.assigned).toEqual(['/q/NEW001?k=chipnew']);
});

test('no teacher\'s quiz played yet (409 no_class): says so, in Urdu too, and stays on the list', async () => {
  const p = libPage({ lang: 'ur', api: { ...API, '/api/wq/videos/start': { __status: 409, error: 'no_class' } } });
  await flush(); await flush();
  p.els['[data-s="Science"]'].fire('click');
  await flush(); await flush();
  p.els[`[data-v="${V(2)}"]`].fire('click');
  await flush(); await flush();
  expect(p.assigned).toEqual([]);
  expect(p.html()).toContain('پہلے اپنے استاد کا کوئی کوئز کھیلیں');
});

test('Back from the subjects goes to the hub', async () => {
  const p = libPage({ api: API });
  await flush(); await flush();
  p.els['#wql-back'].fire('click');
  expect(p.assigned).toEqual(['/h/HUBTOK?kid=c1']);
});
