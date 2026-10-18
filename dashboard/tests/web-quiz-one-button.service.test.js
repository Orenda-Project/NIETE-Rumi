/**
 * One button system (app_settings web_quiz_one_button → the bot's `one_button` → `wq-1b` on <html>).
 *
 * - wq.css: the component's kinds (`.wq-btn--primary/--secondary/--icon/--home/--share/--speaker/--hold` and the lands
 *   --st/--gm/--vd) all exist, EVERY kind sets its own --edge (no ledge falls back to another colour's), and they
 *   paint only from --fill/--on/--sh-btn, so a look changes tokens, never rules.
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
  lang: 'en', kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
  home_v3: 1, head: { dots: 2, today: false, jar: { fresh: true } },
  doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [], videos: null },
};
const KINDS = ['primary', 'secondary', 'icon', 'home', 'share', 'speaker', 'hold', 'st', 'gm', 'vd'];

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
  test('a kind\'s ledge is its own fill\'s: brand-filled kinds sit on --brand-d, a land on its own --land-*-edge, card-filled kinds on --line', () => {
    const r = kindRules();
    KINDS.forEach((k) => {
      const fill = (/--fill:([^;]+)/.exec(r[k]) || [])[1];
      const edge = (/--edge:([^;]+)/.exec(r[k]) || [])[1];
      const land = /^var\(--land-(st|gm|vd)\)$/.exec(fill || '');
      const want = land ? `var(--land-${land[1]}-edge)` : fill === 'var(--brand)' ? 'var(--brand-d)' : 'var(--line)';
      expect([k, edge]).toEqual([k, want]);
    });
    expect(CSS).not.toMatch(/--sh-btn:[^;]*var\(--bd,/);
  });
  test('no ledge colour leans on color-mix outside an @supports block (older phones would draw no ledge)', () => {
    expect(CSS.replace(/@supports[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')).not.toMatch(/--edge:\s*color-mix\(/);
  });
  test('the answer-option colours (--s1..--s4) are never a button\'s fill or ledge', () => {
    Object.values(kindRules()).forEach((b) => expect(b).not.toMatch(/var\(--s[1-4]/));
  });
  test('every kind centres its label both ways and kills the tap flash', () => {
    const shared = /\.wq-btn--primary,\.wq-btn--secondary,\.wq-btn--share,\.wq-btn--icon,\.wq-btn--speaker,\.wq-btn--home,\.wq-btn--hold\{([^}]*)\}/.exec(CSS);
    expect(shared).not.toBeNull();
    expect(shared[1]).toMatch(/display:flex/);
    expect(shared[1]).toMatch(/align-items:center/);
    expect(shared[1]).toMatch(/justify-content:center/);
    expect(shared[1]).toMatch(/-webkit-tap-highlight-color:transparent/);
    expect(shared[1]).toMatch(/background:var\(--fill\);color:var\(--on\);box-shadow:var\(--sh-btn\)/);
  });
  test('the tokens live in :root: main 56, second 52, two-line 76, icon a 48 circle; the Urdu sizes at today\'s values', () => {
    const root = CSS.slice(CSS.indexOf(':root{'), CSS.indexOf('}', CSS.indexOf(':root{')));
    ['--gutter:16px', '--btn-h:56px', '--btn-h2:52px', '--btn-h-2l:76px', '--btn-icon:48px', '--r-btn:18px', '--r-icon:50%', '--btn-fs-ur:19px', '--btn-fs-ur-sm:18px', '--press-y:4px'].forEach((t) => expect(root).toContain(t));
  });
  test('the height tokens are only ever read under wq-1b or by the new kinds (off changes nothing)', () => {
    CSS.split('}').filter((r) => /var\(--(btn-h|btn-h2|btn-h-2l|btn-icon|r-icon)\)/.test(r)).forEach((r) => {
      const sel = r.slice(0, r.indexOf('{')).replace(/^[\s\S]*\*\//, '').trim();
      sel.split(',').forEach((x) => expect([x.trim(), /^(html\.wq-1b|html\[lang=ur\]\[lang\] \.wq-btn\.wq-btn--|\.wq-btn--)/.test(x.trim()) || /^@media/.test(x.trim())]).toEqual([x.trim(), true]));
    });
  });
  test('a button\'s height is the token, set as height (a label line never grows it), in both languages', () => {
    expect(CSS).toContain('html.wq-1b .wq-btn:not([class*="wq-btn--"]){display:flex;align-items:center;justify-content:center;height:var(--btn-h);min-height:0;');
    expect(CSS).toMatch(/html\.wq-1b\[lang=ur\] \.wq-btn:not\(\[class\*="wq-btn--"\]\)\{[^}]*height:var\(--btn-h\);min-height:0/);
    expect(CSS).toContain('html[lang=ur][lang] .wq-btn.wq-btn--primary{height:var(--btn-h);min-height:0;');
  });
  test('three radii per screen under wq-1b: cards --r-card, buttons and the tiles inside boxes --r-btn, icons a circle', () => {
    expect(CSS).toContain('--r-card:22px');
    expect(CSS).toContain('html.wq-1b .wq-card,html.wq-1b .wq-qcard,html.wq-1b .wq-next{border-radius:var(--r-card)}');
    expect(CSS).toContain('html.wq-1b .wq-door,html.wq-1b .wq-nart,html.wq-1b .wq-tile{border-radius:var(--r-btn)}');
  });
  test('the Stories wait and empty boxes are cards too: the note and the cover placeholders take --r-card (3 radii while the shelf loads)', () => {
    expect(CSS).toContain('html.wq-1b .wq-soon,html.wq-1b .wqs-skel{border-radius:var(--r-card)}');
  });
  test('the answer shapes keep their own corners (a colour-blind cue, a glyph, not a box): no wq-1b rule rounds .wq-shp', () => {
    expect(CSS).not.toMatch(/html\.wq-1b[^{}]*\.wq-shp[^{}]*\{[^}]*border-radius/);
  });
  test('one height per list: every Games / Stories / Videos row (the teacher\'s week row too) is --row-h, its title one line', () => {
    expect(CSS).toContain('--row-h:88px');
    expect(CSS).toContain('html.wq-1b .wq-dli .wq-drow,html.wq-1b .wq-week .wq-drow{height:var(--row-h);min-height:0;overflow:hidden}');
    expect(CSS).toContain('html.wq-1b .wq-drow .wq-rtext b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}');
    expect(CSS).not.toMatch(/html\.wq-1b \.wq-week \.wq-drow\{[^}]*border-color:transparent/);
  });
  test('lint: no rule under .wq-adv sets border-radius, height or min-height on a .wq-btn (the look is tokens only)', () => {
    const bad = [];
    for (const f of fs.readdirSync(WQ).filter((n) => n.endsWith('.css'))) {
      const css = fs.readFileSync(path.join(WQ, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(',').filter((x) => /\.wq-adv\b/.test(x) && /\.wq-btn/.test(x));
        if (sels.length && /(^|;)\s*(border-radius|height|min-height)\s*:/.test(m[2])) bad.push(f + ': ' + m[1].trim());
      }
    }
    expect(bad).toEqual([]);
  });
  test('every icon-only control is a 48 circle, and the row speakers never stretch to the row', () => {
    expect(CSS).toMatch(/html\.wq-1b \.wq-homebtn,[^{]*\.wq-jar\{flex:none;width:var\(--btn-icon\)[^}]*border-radius:var\(--r-icon\)\}/);
    expect(CSS).toMatch(/html\.wq-1b button\.wq-dspk\{[^}]*align-self:center;[^}]*height:var\(--btn-icon\);min-height:0;[^}]*border-radius:var\(--r-icon\)/);
    expect(CSS).toMatch(/html\.wq-1b \.wqs-ic\{[^}]*border-radius:var\(--r-icon\)/);
    ['icon', 'speaker'].forEach((k) => expect(kindRules()[k]).toMatch(/border-radius:var\(--r-icon\)/));
  });
  test('one secondary height in both languages (the Urdu face\'s 60 px button line does not stretch it)', () => {
    expect(CSS).toContain('html[lang=ur][lang] .wq-btn.wq-btn--secondary,html[lang=ur][lang] .wq-btn.wq-btn--share{height:var(--btn-h2);min-height:0;');
    expect(CSS).not.toMatch(/--btn-h2-ur/);
  });
  test('the Urdu button sizes come from the tokens, not literals', () => {
    expect(CSS).toContain('html[lang=ur] .wq-btn{font-weight:700;font-size:var(--btn-fs-ur);line-height:1.9}');
    expect(CSS).toContain('html.wq-ur2[lang=ur] .wq-btn{font-size:var(--btn-fs-ur);');
    expect(CSS).toContain('html.wq-ur2[lang=ur] .wq-btn{font-size:var(--btn-fs-ur-sm)}');
  });
  test('the re-skin of today\'s buttons and the gutter apply only under wq-1b', () => {
    const tail = CSS.slice(CSS.indexOf('/* ONE button system'));
    const rules = rulesOf(tail.slice(0, tail.indexOf('/* The ONE button component for new markup')));
    expect(rules.length).toBeGreaterThan(20);
    // top-level commas only (an :is(a,button) list is one selector)
    rules.forEach(({ sel }) => sel.replace(/\([^()]*\)/g, '()').split(',').forEach((s) => expect([s.trim(), s.trim().startsWith('html.wq-1b')]).toEqual([s.trim(), true])));
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

describe('wq-home.css: the hold\'s "keep holding" line', () => {
  const css = fs.readFileSync(path.join(WQ, 'wq-home.css'), 'utf8');
  test('under wq-1b the hold stands over its hint, and the hint shows only when the page unhides it', () => {
    expect(css).toContain('html.wq-1b .wq-grown{flex-direction:column;align-items:center}');
    expect(css).toContain('html.wq-1b .wq-ghint[hidden]{display:none}');
    expect(css).toMatch(/html\.wq-1b\[lang=ur\] \.wq-ghint\{font-family:var\(--fu\)/);
  });
});

describe('wq-lib.js: the library page gets its answer later, and hands it to the class switch', () => {
  // The shipped wq-lib.js on its own, as the edge's library page loads it (the library tests' fake DOM, smaller).
  const run = (answer) => {
    const seen = [];
    const root = { innerHTML: '', querySelector: () => ({ addEventListener() {}, setAttribute() {}, getAttribute() {} }), addEventListener() {} };
    const boot = { textContent: JSON.stringify({ view: 'lib', hub: 'HUBTOK', kid: 'c1', lang: 'en' }) };
    const ctx = {
      console, JSON, Promise, setTimeout: () => 0,
      document: { documentElement: { classList: { contains: () => false } }, getElementById: (id) => (id === 'boot' ? boot : id === 'wql-root' ? root : null), querySelector: () => null, addEventListener() {} },
      location: { host: 'example.test', search: '', assign() {} },
      navigator: { userAgent: 'test' },
      fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(answer)) }),
      requestIdleCallback: (fn) => fn(),
      WQT: { oneButton: (j) => seen.push(j), push: () => false },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(WQ, 'wq-lib.js'), 'utf8'), ctx);
    return seen;
  };
  const flush = () => new Promise((r) => setImmediate(r));
  test('the library\'s answer goes to WQT.oneButton (on or off, wq-tel.js decides)', async () => {
    const on = run({ grade: '3', mine: null, grades: [], subjects: [], one_button: true });
    await flush(); await flush();
    expect(on).toHaveLength(1);
    expect(on[0].one_button).toBe(true);
    const off = run({ grade: '3', mine: null, grades: [], subjects: [] });
    await flush(); await flush();
    expect(off).toHaveLength(1);
    expect(off[0].one_button).toBeUndefined();
  });
});
