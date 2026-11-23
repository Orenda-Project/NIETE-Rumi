/**
 * bd-ptl6x9.7 — the weak-skill nudge's link opens ONE game: /j/<code>?ex=<game> → (the class link's steps) → the child's
 * hub with &ex=<game> → straight to /c/<hub token>?kid=<chip>#<game>, where the challenge page opens that game by its
 * id (wq-trail.js deep link; #numbers is the number warm-up). Only the three games; anything else is ignored. A locked
 * hub (another phone's link) or one with no child picked never jumps.
 *
 * The real page scripts run in a vm with a fake document, location and fetch.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CLASS_LINK = fs.readFileSync(path.join(WQ, 'class-link.js'), 'utf8');
const HUB = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');

function sandbox({ boot, search, answer }) {
  const location = { search, hash: '', href: null, replaced: null, replace(u) { this.replaced = u; } };
  const el = () => ({ innerHTML: '', textContent: '', classList: { add() {}, remove() {}, contains: () => false }, querySelectorAll: () => [], setAttribute() {}, appendChild() {}, addEventListener() {}, style: {} });
  const root = el();
  const document = {
    getElementById: (id) => (id === 'boot' ? { textContent: JSON.stringify(boot) } : id === 'wq' ? root : null),
    querySelector: () => null, querySelectorAll: () => [], createElement: el, documentElement: el(), head: el(), body: el(),
    addEventListener() {},
  };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const fetch = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer(url)) });
  const ctx = {
    document, location, localStorage, sessionStorage: localStorage, fetch, history: { replaceState() {} },
    navigator: { userAgent: 'test' }, setTimeout, clearTimeout, console, JSON, Math, Date, Uint8Array, encodeURIComponent, decodeURIComponent,
    crypto: { getRandomValues: (a) => a },
  };
  ctx.window = ctx;
  return { ctx, location };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('class link page: the game rides on to the hub', () => {
  async function arriveTo(search) {
    const { ctx, location } = sandbox({ boot: { view: 'class_link', code: 'KZ7QW3MN', lang: 'en' }, search, answer: () => ({ href: '/h/TOK?from=class_link' }) });
    vm.runInNewContext(CLASS_LINK, ctx);
    await flush(); await flush();
    return location.href;
  }
  test.each(['missing', 'numbers', 'bigger'])('?ex=%s → the hub link carries &ex=%s', async (g) => {
    expect(await arriveTo(`?ex=${g}`)).toBe(`/h/TOK?from=class_link&ex=${g}`);
  });
  test.each(['', '?ex=read', '?ex=<x>'])('%p → the hub link unchanged', async (s) => {
    expect(await arriveTo(s)).toBe('/h/TOK?from=class_link');
  });
});

describe('hub: ?ex= opens that game on the challenge page', () => {
  const run = (boot, search) => {
    const { ctx, location } = sandbox({ boot: { token: 'TOK', lang: 'en', kids: [{ chip: 'abc' }], ...boot }, search, answer: () => ({}) });
    try { vm.runInNewContext(HUB, ctx); } catch (_) { /* the rest of the hub needs a real DOM; the jump runs first */ }
    return location.replaced;
  };
  test('a picked child → /c/<token>?kid=<chip>#<game>', () => {
    expect(run({ kid: 'abc' }, '?from=class_link&ex=missing')).toBe('/c/TOK?kid=abc#missing');
    expect(run({ kid: 'abc' }, '?ex=numbers')).toBe('/c/TOK?kid=abc#numbers');
  });
  test.each([
    ['no child picked', {}, '?ex=missing'],
    ['a locked hub', { kid: 'abc', locked: true }, '?ex=missing'],
    ['a coach preview', { kid: 'abc', practice: true }, '?ex=missing'],
    ['a game outside the three', { kid: 'abc' }, '?ex=read'],
    ['no ex', { kid: 'abc' }, '?from=class_link'],
  ])('%s → no jump', (_, boot, search) => {
    expect(run(boot, search)).toBeNull();
  });
});
