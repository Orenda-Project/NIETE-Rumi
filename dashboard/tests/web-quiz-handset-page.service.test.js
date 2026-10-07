/**
 * The one-shot handset link on the page (wq.js boot): a bot-sent button lands on /q/<code>#x=<token>.
 * The page keeps the fragment in sessionStorage, drops it from the address bar before anything else,
 * redeems it once with its device (POST bind), stores the device the server minted, and then: one child
 * = straight in as that child (via 'handset'); several = the remembered cards; any refusal = today's
 * landing, the fragment forgotten. The token is never sent as part of a URL.
 * The page's boot slice runs for real in a vm with the bot (api) and the browser as fakes.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(process.env.WQ_SRC || path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  function handsetX()');
const END = SRC.indexOf('  var HX = ');

function page({ hash = '', stored = {}, session = {}, reply = null } = {}) {
  const calls = []; const screens = []; const events = []; const starts = []; const remembered = []; const history = [];
  const ss = { ...session };
  const ctx = {
    CODE: 'AB12CD', Q: { topic: 'Plants' }, CLS: { teacher: 'Ms T', label: '3-A' }, TW: { opening: 'Opening your quiz…' },
    T: { from: (t, l) => `${t} · ${l}` }, esc: (s) => String(s == null ? '' : s), bar: () => '', jug: (m, say) => `<p>${say}</p>`, wireBar: () => {},
    location: { hash, pathname: '/q/AB12CD', search: '' },
    window: { history: { state: null, replaceState: (st, t, url) => history.push(url) } },
    sessionStorage: { getItem: (k) => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = v; }, removeItem: (k) => { delete ss[k]; } },
    sget: (k, d) => (k in stored ? stored[k] : d), sset: (k, v) => { stored[k] = v; },
    render: (h, name) => screens.push(name), ev: (n, p) => events.push({ n, p }),
    rememberKid: (c) => remembered.push(c), startSession: (pick, kid) => starts.push({ pick, kid }), landing: () => screens.push('M3'),
    api: (m, p, body) => { calls.push({ m, p, body }); return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply); },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.handsetX = handsetX; this.handsetBind = handsetBind;`, ctx);
  return { ctx, calls, screens, events, starts, remembered, history, ss, stored };
}
const flush = () => new Promise((r) => setImmediate(r));

beforeAll(() => { expect(START).toBeGreaterThan(0); expect(END).toBeGreaterThan(START); });

test('the fragment is kept in sessionStorage and dropped from the address bar before the bind; the bind carries code, token and the known device', async () => {
  const p = page({ hash: '#x=TOK.sig', stored: { wq_d: 'dddddddddddddddddddddd' }, reply: { ok: true, status: 200, body: { kids: [{ chip: 'c1', first: 'Ayesha', animal: 'cat' }], one: 'c1', device_ref: 'dddddddddddddddddddddd' } } });
  const x = p.ctx.handsetX();
  expect(x).toBe('TOK.sig');
  expect(p.ss.wq_x).toBe('TOK.sig');
  expect(p.history).toEqual(['/q/AB12CD']);          // no hash, no token
  p.ctx.handsetBind(x);
  expect(p.screens).toEqual(['M4-opening']);           // nothing to tap while the server answers
  await flush();
  expect(p.calls).toEqual([{ m: 'POST', p: 'bind', body: { code: 'AB12CD', x: 'TOK.sig', device_ref: 'dddddddddddddddddddddd' } }]);
  expect(p.calls[0].p).not.toContain('TOK');           // never in a URL
  expect(p.starts).toEqual([{ pick: { chip: 'c1', via: 'handset' }, kid: { chip: 'c1', first: 'Ayesha', animal: 'cat' } }]);
  expect(p.remembered).toHaveLength(1);
  expect(p.ss.wq_x).toBeUndefined();
  expect(p.events.map((e) => e.n)).toEqual(['identity_pick', 'handset_page']);
});

test('a fresh browser: the device the server minted is stored BEFORE the start; several children = the cards (landing)', async () => {
  const p = page({ hash: '#x=TOK.sig', reply: { ok: true, status: 200, body: { kids: [{ chip: 'c1', first: 'A', animal: 'cat' }, { chip: 'c2', first: 'B', animal: 'dog' }], one: null, device_ref: 'eeeeeeeeeeeeeeeeeeeeee' } } });
  p.ctx.handsetBind(p.ctx.handsetX());
  expect(p.calls[0].body.device_ref).toBeUndefined();
  await flush();
  expect(p.stored.wq_d).toBe('eeeeeeeeeeeeeeeeeeeeee');
  expect(p.remembered.map((k) => k.chip)).toEqual(['c1', 'c2']);
  expect(p.starts).toEqual([]);
  expect(p.screens).toEqual(['M4-opening', 'M3']);
});

test('used, expired, off, or offline: today\'s landing, the fragment forgotten, nothing started', async () => {
  for (const reply of [{ ok: false, status: 409, body: { error: 'used' } }, { ok: false, status: 503, body: { error: 'web_quiz_off' } }, new Error('net')]) {
    const p = page({ hash: '#x=TOK.sig', reply });
    p.ctx.handsetBind(p.ctx.handsetX());
    await flush();
    expect(p.starts).toEqual([]);
    expect(p.screens[p.screens.length - 1]).toBe('M3');
    expect(p.ss.wq_x).toBeUndefined();
    expect(p.events.find((e) => e.n === 'handset_page').p.ok).toBe(0);
  }
});

test('no fragment: nothing to redeem; a fragment lost mid-bind (reload) is taken from sessionStorage', () => {
  expect(page().ctx.handsetX()).toBe('');
  expect(page({ hash: '#other=1' }).ctx.handsetX()).toBe('');
  expect(page({ session: { wq_x: 'KEPT.sig' } }).ctx.handsetX()).toBe('KEPT.sig');
});
