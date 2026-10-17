/**
 * One button system (app_settings web_quiz_one_button → the bot's `one_button` → `wq-1b` on <html>).
 *
 * - wq.css: the component's kinds (`.wq-btn--primary/--secondary/--icon/--home/--share/--speaker/--hold` and the land
 *   colours) all exist, and EVERY kind sets its own --edge, so no button's ledge falls back to another colour's.
 * - wq-tel.js: the class goes on <html> only for the JSON boolean true; anything else leaves the page as it is.
 * - wq-home.js (run in a vm): off, the grown-ups button is today's markup byte for byte; on, it says it is held
 *   ("Hold for grown-ups"), carries the ring and the lock, and a short tap shows "Keep holding" (EN + UR).
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
  home_v3: 1, head: { dots: 2, today: false, jar: { fresh: true } },
  doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [], videos: null },
};
const KINDS = ['primary', 'secondary', 'icon', 'home', 'share', 'speaker', 'hold', 's1', 's2', 's3'];

// Every rule whose whole selector is one `.wq-btn--<kind>`: the kind's own definition.
// (A rule is `selector{body}` with no brace inside; a rule inside an @media block is found the same way.)
const rulesOf = (css) => {
  const out = [];
  const rx = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rx.exec(css.replace(/\/\*[\s\S]*?\*\//g, '')))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
};
const kindRules = () => {
  const out = {};
  rulesOf(CSS).forEach(({ sel, body }) => {
    const m = /^\.wq-btn--([a-z0-9]+)$/.exec(sel);
    if (m) out[m[1]] = (out[m[1]] || '') + body;
  });
  return out;
};

describe('wq.css: the one button component', () => {
  test('every kind the other screens use exists', () => {
    expect(Object.keys(kindRules()).sort()).toEqual([...KINDS].sort());
  });
  test.each(KINDS)('.wq-btn--%s sets its own --edge (its ledge is a shade of its own fill)', (k) => {
    expect(kindRules()[k]).toMatch(/--edge:/);
  });
  test('no kind draws its ledge from the brand colour by default (only primary, whose fill IS the brand)', () => {
    const r = kindRules();
    KINDS.filter((k) => k !== 'primary').forEach((k) => expect([k, /--edge:var\(--brand/.test(r[k])]).toEqual([k, false]));
    expect(CSS).not.toMatch(/--sh-btn:[^;]*var\(--bd,/);
  });
  test('every kind centres its label both ways and kills the tap flash', () => {
    const shared = /\.wq-btn--primary,\.wq-btn--secondary,\.wq-btn--share,\.wq-btn--icon,\.wq-btn--speaker,\.wq-btn--home,\.wq-btn--hold\{([^}]*)\}/.exec(CSS);
    expect(shared).not.toBeNull();
    expect(shared[1]).toMatch(/display:flex/);
    expect(shared[1]).toMatch(/align-items:center/);
    expect(shared[1]).toMatch(/justify-content:center/);
    expect(shared[1]).toMatch(/-webkit-tap-highlight-color:transparent/);
  });
  test('the tokens live in :root at today\'s values (the adventure look redefines them; off changes nothing)', () => {
    const root = CSS.slice(CSS.indexOf(':root{'), CSS.indexOf('}', CSS.indexOf(':root{')));
    ['--gutter:16px', '--btn-h:60px', '--btn-h2:52px', '--btn-icon:56px', '--r-btn:18px', '--btn-fs-ur:19px', '--btn-fs-ur-sm:18px'].forEach((t) => expect(root).toContain(t));
  });
  test('the Urdu button sizes come from the tokens, not literals', () => {
    expect(CSS).toContain('html[lang=ur] .wq-btn{font-weight:700;font-size:var(--btn-fs-ur);line-height:1.9}');
    expect(CSS).toContain('html.wq-ur2[lang=ur] .wq-btn{font-size:var(--btn-fs-ur);');
    expect(CSS).toContain('html.wq-ur2[lang=ur] .wq-btn{font-size:var(--btn-fs-ur-sm)}');
  });
  test('the re-skin of today\'s buttons and the gutter apply only under wq-1b', () => {
    const tail = CSS.slice(CSS.indexOf('/* ONE button system'));
    const rules = rulesOf(tail.slice(0, tail.indexOf('@supports')));
    expect(rules.length).toBeGreaterThan(20);
    rules.forEach(({ sel }) => sel.split(',').forEach((s) => expect([s.trim(), s.trim().startsWith('html.wq-1b')]).toEqual([s.trim(), true])));
  });
});

describe('wq-tel.js: the class on <html>', () => {
  const run = (boot) => {
    const cls = new Set();
    const doc = {
      documentElement: { classList: { add: (c) => cls.add(c) } },
      getElementById: (id) => (id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
    };
    const win = {};
    vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8'), { window: win, document: doc, navigator: {}, location: { href: 'https://x.test/h/t' }, JSON, Math, Date, setTimeout, clearTimeout });
    return { cls, W: win.WQT };
  };
  test('JSON true: wq-1b', () => expect(run({ one_button: true }).cls.has('wq-1b')).toBe(true));
  test.each([['absent', {}], ['the string true', { one_button: 'true' }], ['1', { one_button: 1 }], ['false', { one_button: false }]])('%s: no class', (_n, boot) => {
    expect(run(boot).cls.size).toBe(0);
  });
  test('a page that gets its answer later (the library) sets it the same way', () => {
    const { cls, W } = run({});
    W.oneButton({ one_button: 'yes' });
    expect(cls.size).toBe(0);
    W.oneButton({ one_button: true });
    expect(cls.has('wq-1b')).toBe(true);
  });
});

function loadHome() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  return win.WQHOME;
}
const grownOf = (html) => html.slice(html.indexOf('<footer class="wq-grown">'), html.indexOf('</footer>') + 9);

describe('wq-home.js: the grown-ups hold', () => {
  const H = loadHome();
  test.each(['en', 'ur'])('%s off: today\'s button, byte for byte', (lang) => {
    const t = lang === 'ur' ? { g: 'بڑوں کے لیے', h: 'دبائے رکھیں' } : { g: 'Grown-ups', h: 'Press and hold' };
    expect(grownOf(H.html({ ...HOME, lang }, { token: TOKEN, lang }))).toBe(`<footer class="wq-grown"><button class="wq-gbtn" type="button" data-tap="grownups" aria-label="${t.g} — ${t.h}"><i class="wq-gfill"></i>${t.g}</button></footer>`);
  });
  test.each([['the string true', 'true'], ['1', 1]])('%s: today\'s button', (_n, v) => {
    expect(grownOf(H.html({ ...HOME, one_button: v }, { token: TOKEN, lang: 'en' }))).toContain('class="wq-gbtn"');
  });
  test.each([['en', 'Hold for grown-ups', 'Keep holding…'], ['ur', 'بڑوں کے لیے دبائے رکھیں', 'تھوڑی دیر اور دبائے رکھیں…']])('%s on: the hold kind says it is held, has the ring and the lock, and a hidden "keep holding" line', (lang, label, keep) => {
    const g = grownOf(H.html({ ...HOME, lang, one_button: true }, { token: TOKEN, lang }));
    expect(g).toContain('class="wq-btn wq-btn--hold"');
    expect(g).toContain(`<span class="wq-glab" data-hold-label>${label}</span>`);
    expect(g).toMatch(/data-hold-ring[^>]*>.*<circle class="wq-garc"[^>]*pathLength="100"/);
    expect(g).toMatch(/<svg viewBox="0 0 24 24"[^>]*><path/);
    expect(g).toContain(`data-hold-hint role="status" hidden>${keep}</p>`);
    expect(g).not.toContain('wq-gfill');
  });
});

describe('wq-home.js hold(): a short tap answers, a full hold opens', () => {
  const src = fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8');
  const body = src.slice(src.indexOf('function hold('), src.indexOf('\n  }', src.indexOf("['pointerup', 'pointerleave'")) + 4);
  const make = () => {
    const ls = {};
    const classes = new Set();
    const el = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, addEventListener: (n, f) => { ls[n] = f; } };
    const hint = { hidden: true };
    const calls = { vibrate: 0, juice: [] };
    const sb = { navigator: { vibrate: () => { calls.vibrate += 1; return true; } }, setTimeout, clearTimeout, juice: (f) => calls.juice.push(f) };
    vm.runInNewContext(`${body}; this.hold = hold;`, sb);
    return { ls, classes, el, hint, calls, hold: sb.hold };
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('a tap let go early: nothing opens, "keep holding" shows for 1.5 s, then hides', () => {
    const k = make();
    const done = jest.fn();
    k.hold(k.el, done, k.hint);
    k.ls.pointerdown({ preventDefault() {} });
    expect(k.classes.has('held')).toBe(true);
    jest.advanceTimersByTime(300);
    k.ls.pointerup();
    expect(done).not.toHaveBeenCalled();
    expect(k.hint.hidden).toBe(false);
    jest.advanceTimersByTime(1499);
    expect(k.hint.hidden).toBe(false);
    jest.advanceTimersByTime(2);
    expect(k.hint.hidden).toBe(true);
  });
  test('held 2 s: it opens once, with a buzz and the tap sound, and the hint stays hidden', () => {
    const k = make();
    const done = jest.fn();
    k.hold(k.el, done, k.hint);
    k.ls.pointerdown({ preventDefault() {} });
    k.ls.touchstart({ preventDefault() {} });
    jest.advanceTimersByTime(2000);
    k.ls.pointerup();
    expect(done).toHaveBeenCalledTimes(1);
    expect(k.calls.vibrate).toBe(1);
    expect(k.calls.juice).toEqual(['tap']);
    expect(k.hint.hidden).toBe(true);
  });
  test('without a hint (off): a short tap is silent, as today', () => {
    const k = make();
    const done = jest.fn();
    k.hold(k.el, done);
    k.ls.pointerdown({ preventDefault() {} });
    k.ls.pointerup();
    jest.advanceTimersByTime(3000);
    expect(done).not.toHaveBeenCalled();
    expect(k.calls.vibrate).toBe(0);
  });
});
