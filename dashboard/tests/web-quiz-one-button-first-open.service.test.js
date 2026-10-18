/**
 * The one button look on a home drawn from the page's own hub call (web_quiz_one_button). The server render can go out
 * without `one_button` (a cold or stale switch cache), while the POST a moment later says `one_button: true`. hub.js
 * draws the home from that POST answer on a first open (unlock: the locked server render) and after "Who is playing?"
 * (pick), so the look's class on <html> must follow that answer too: the grown-ups hold is never drawn without
 * `wq-1b` (its ring would paint black), and never the other way round. public/wq/wq-tel.js + hub.js run whole in a vm
 * with a small fake DOM; the bot's JSON over fetch is the boundary. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TEL_SRC = fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8');
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const BOOTS = require('./fixtures/hub-play-boots.json');

const TOKEN = 'tok.tok';
const KID = BOOTS.done.kids[0];
const TWO = [KID, { ...KID, chip: '0000000000000002', first: 'Noor Testwala' }];

function page(boot, answer) {
  const classes = new Set();
  const timers = [];
  const chips = [];
  const heads = [];
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) { this._h = h; },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll(sel) {
      if (sel !== '[data-chip]') return [];
      const out = [];
      this._h.replace(/data-chip="([^"]+)"/g, (_m, chip) => {
        const b = { chip, ls: [], getAttribute: () => chip, addEventListener(n, fn) { if (n === 'click') this.ls.push(fn); } };
        out.push(b);
        chips.push(b);
        return '';
      });
      return out;
    },
    appendChild() {},
  };
  const ctx = {
    document: {
      documentElement: { setAttribute() {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle() {}, contains: (c) => classes.has(c) } },
      cookie: '',
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
      createElement: (tag) => ({ tag, setAttribute() {}, addEventListener() {} }),
      head: { appendChild(el) { heads.push(el); } },
    },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '', hash: '', protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob() {},
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(answer)) }),
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, decodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(TEL_SRC, ctx);
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  return { classes, chips, flush, heads };
}

describe('the look follows the answer the home is drawn from', () => {
  test('first open (locked server render without the field): the unlock answer says one_button: true → wq-1b', async () => {
    const p = page({ lang: 'en', token: TOKEN, brand: null, locked: true, kids: [] }, { ...BOOTS.done, one_button: true });
    await p.flush();
    expect(p.classes.has('wq-1b')).toBe(true);
  });
  test('"Who is playing?" (a family of two; the server render without the field): the picked child\'s answer says on → wq-1b', async () => {
    const p = page({ lang: 'en', token: TOKEN, brand: null, kids: TWO }, { ...BOOTS.done, one_button: true });
    await p.flush();
    expect(p.chips.length).toBe(2);
    expect(p.classes.has('wq-1b')).toBe(false);
    p.chips[0].ls.forEach((fn) => fn());
    await p.flush();
    expect(p.classes.has('wq-1b')).toBe(true);
  });
  test.each([['absent', undefined], ['false', false], ['the string true', 'true']])('switch %s in the answer: no class (off is today\'s)', async (_n, v) => {
    const answer = { ...BOOTS.done };
    if (v !== undefined) answer.one_button = v;
    const p = page({ lang: 'en', token: TOKEN, brand: null, locked: true, kids: [] }, answer);
    await p.flush();
    expect(p.classes.has('wq-1b')).toBe(false);
  });
});

// The adventure look rides the one button look (web_quiz_adventure_look, only with web_quiz_one_button): a first open
// whose server render went out without it takes the class, the sheet and the kit from the hub answer, at the version
// the edge put on that answer (`adv_v`), so the look never waits for the next load.
describe('the adventure look follows the answer the home is drawn from', () => {
  const V = 'abcdef0123';
  const tags = (p) => p.heads.map((el) => `${el.tag}:${el.href || el.src}`);
  test('first open: one_button + adv + adv_v → wq-adv, the sheet and the kit at that version, once', async () => {
    const p = page({ lang: 'en', token: TOKEN, brand: null, locked: true, kids: [] }, { ...BOOTS.done, one_button: true, adv: true, adv_v: V });
    await p.flush();
    expect(p.classes.has('wq-1b')).toBe(true);
    expect(p.classes.has('wq-adv')).toBe(true);
    expect(tags(p)).toEqual([`link:/wq/wq-adventure.css?v=${V}`, `script:/wq/wq-adv.js?v=${V}`]);
    expect(p.heads[0].rel).toBe('stylesheet');
  });
  test('"Who is playing?": the picked child\'s answer turns the look on', async () => {
    const p = page({ lang: 'en', token: TOKEN, brand: null, kids: TWO }, { ...BOOTS.done, one_button: true, adv: true, adv_v: V });
    await p.flush();
    expect(p.classes.has('wq-adv')).toBe(false);
    p.chips[0].ls.forEach((fn) => fn());
    await p.flush();
    expect(p.classes.has('wq-adv')).toBe(true);
    expect(tags(p)).toHaveLength(2);
  });
  test.each([
    ['adv without one_button', { adv: true, adv_v: V }],
    ['adv without its version', { one_button: true, adv: true }],
    ['a version that is not one', { one_button: true, adv: true, adv_v: '../x' }],
    ['the string true', { one_button: true, adv: 'true', adv_v: V }],
  ])('%s: no look, nothing fetched', async (_n, more) => {
    const p = page({ lang: 'en', token: TOKEN, brand: null, locked: true, kids: [] }, { ...BOOTS.done, ...more });
    await p.flush();
    expect(p.classes.has('wq-adv')).toBe(false);
    expect(p.heads).toEqual([]);
  });
  test('a page that already has the look (the edge drew it): nothing is linked twice', async () => {
    const p = page({ lang: 'en', token: TOKEN, brand: null, locked: true, kids: [] }, { ...BOOTS.done, one_button: true, adv: true, adv_v: V });
    p.classes.add('wq-adv');
    await p.flush();
    expect(p.heads).toEqual([]);
  });
});

describe('wq-home.js: the hold is drawn exactly when the page has the look', () => {
  const load = (has1b) => {
    const win = {};
    const document = { documentElement: { classList: { contains: (c) => has1b && c === 'wq-1b' } } };
    vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), { window: win, document, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent });
    return win.WQHOME;
  };
  const HOME = { ...BOOTS.done, home_v3: 1 };
  const grownOf = (html) => html.slice(html.indexOf('<footer class="wq-grown">'), html.indexOf('</footer>') + 9);
  test('the page has wq-1b (from its boot), the answer has no field (a stale cache): the hold, not today\'s button', () => {
    const g = grownOf(load(true).html({ ...HOME }, { token: TOKEN, lang: 'en' }));
    expect(g).toContain('class="wq-btn wq-btn--hold"');
    expect(g).not.toContain('wq-gfill');
  });
  test.each([['en', 'Hold for grown-ups'], ['ur', 'بڑوں کے لیے دبائے رکھیں']])('%s: the hold\'s spoken name is its visible words (label in name)', (lang, label) => {
    const g = grownOf(load(true).html({ ...HOME, lang }, { token: TOKEN, lang }));
    expect(g).toContain(`aria-label="${label}"`);
  });
  test('no wq-1b and no field: today\'s button', () => {
    expect(grownOf(load(false).html({ ...HOME }, { token: TOKEN, lang: 'en' }))).toContain('class="wq-gbtn"');
  });
});
