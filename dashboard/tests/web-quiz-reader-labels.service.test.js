/**
 * The storybook reader's icons say what they do (web_quiz_one_button → `wq-1b` on <html>; wq.css only).
 *
 * - every icon-only button in the reader (the top bar's Back / Close / Sound, the page bar's Page before / Next page)
 *   shows its own name as a caption under its circle: the aria-label the reader already writes, in English and Urdu,
 *   so the words are today's reviewed copy and the reader's markup does not change;
 * - "Slower" is a circle with a tortoise a child reads at a glance, its own word under it like the others;
 * - the captions keep the page gutter: the page bar sits 14 px in, so the widest caption stays inside 16 px;
 * - in Urdu a page arrow's glyph turns and its caption never does;
 * - a media play ▶ on the Urdu home is never mirrored under wq-1b (only a direction would be);
 * - switch off: wq-stories.js / wq-stories.css are untouched, and every new rule sits under html.wq-1b.
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const SJS = fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8');
const HCSS = fs.readFileSync(path.join(WQ, 'wq-home.css'), 'utf8');

const rules = (css) => {
  const out = [];
  const rx = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rx.exec(css.replace(/\/\*[\s\S]*?\*\//g, '')))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
};
const body = (sel) => rules(CSS).filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body).join(';');

function K() {
  const win = { location: { hash: '' }, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, setTimeout, clearTimeout };
  const doc = { getElementById: () => null, querySelector: () => null, addEventListener() {}, createElement: (tag) => ({ tag }), head: { appendChild() {} } };
  vm.runInContext(SJS, vm.createContext({ window: win, document: doc, JSON, Math, String, Number, Array, Object, Promise, encodeURIComponent, Date }));
  return win.WQSTORIES._k;
}

describe('the captions are the reader\'s own names for its buttons', () => {
  const k = K();
  test.each([
    ['en', 'Back', 'Close', 'Sound', 'Page before', 'Next page', 'Slower'],
    ['ur', 'واپس', 'بند کریں', 'آواز', 'پچھلا صفحہ', 'اگلا صفحہ', 'آہستہ'],
  ])('%s: every icon-only button carries the word its caption shows', (l, back, close, sound, prev, next, slow) => {
    const t = k.T[l];
    expect(k.ic(t, 'back', t.back, '‹')).toContain(`aria-label="${back}"`);
    expect(k.ic(t, 'close', t.close, '✕')).toContain(`aria-label="${close}"`);
    expect(k.top(l, '', 'Mina Testwala', true)).toContain(`aria-label="${sound}"`);
    expect([t.prevP, t.nextP, t.slow]).toEqual([prev, next, slow]);
    // the page bar writes them on its arrows, and Slower carries its word as text
    expect(SJS).toContain('<button class="wqs-arr" data-tap="prev"\' + (i ? \'\' : \' disabled\') + \' aria-label="\' + esc(t.prevP) + \'">');
    expect(SJS).toContain('<button class="wqs-arr" data-tap="next" aria-label="\' + esc(t.nextP) + \'">');
    expect(SJS).toContain('IC.slow + \' \' + esc(t.slow) + \'</button>');
  });
});

describe('wq.css under wq-1b: a caption under each circle', () => {
  test('the top bar\'s icons and the page arrows show their aria-label under the circle, centred, one line', () => {
    const cap = body('html.wq-1b .wqs-ctl .wqs-arr::after');
    expect(cap).toBe(body('html.wq-1b .wqs-top .wqs-ic::after'));
    expect(cap).toMatch(/content:attr\(aria-label\)/);
    expect(cap).toMatch(/position:absolute;top:calc\(100% \+ 4px\);left:50%;transform:translateX\(-50%\)/);
    expect(cap).toMatch(/white-space:nowrap/);
    expect(cap).toMatch(/pointer-events:none/);
    expect(body('html.wq-1b .wqs-ctl .wqs-arr')).toMatch(/position:relative;overflow:visible;margin-bottom:var\(--cap-h\)/);
    expect(body('html.wq-1b .wqs-top .wqs-ic')).toMatch(/margin-bottom:var\(--cap-h\)/);
    expect(body('html.wq-1b .wqs')).toContain('--cap-h:20px');
    expect(body('html.wq-1b .wqs[lang=ur]')).toContain('--cap-h:26px');
  });
  test('the circles stay the icon kind (#2831: 48, --r-icon): a caption never makes the circle a tile', () => {
    expect(body('html.wq-1b .wqs-ctl .wqs-arr')).not.toMatch(/border-radius|width|height:/);
    expect(body('html.wq-1b .wqs-top .wqs-ic')).not.toMatch(/border-radius|width|height:/);
  });
  test('the bars line up: the title on the circles\' line, the circles centred on the main button', () => {
    expect(body('html.wq-1b .wqs-top')).toContain('align-items:flex-start');
    expect(body('html.wq-1b .wqs-top h2')).toContain('line-height:var(--btn-icon)');
    expect(body('html.wq-1b .wqs-ctl')).toContain('align-items:flex-start');
    expect(body('html.wq-1b .wqs-ctl .wqs-arr')).toContain('margin-top:calc((var(--btn-h) - var(--btn-icon)) / 2)');
  });
  test('the gutter: the page bar sits 14 px in, so "Page before" (74 px wide at 12 px) stays inside 16 px', () => {
    expect(body('html.wq-1b .wqs-ctl')).toMatch(/padding-inline:14px/);
    // the reader's own padding under wq-1b is the 16 px gutter; 16 + 14 + 24 (half a 48 circle) − 37 (half the widest
    // caption) = 17 ≥ 16 (measured in Chromium at 360: the caption spans 17..91)
    expect(CSS).toContain('html.wq-1b .wqs:not(.wqs-shelf){padding-inline:var(--gutter)}');
    expect(16 + 14 + 24 - 37).toBeGreaterThanOrEqual(16);
  });
  test('Urdu: the arrow\'s glyph turns, the button (and so its caption) never does', () => {
    expect(CSS).toContain('html.wq-1b .wqs[dir=rtl] .wqs-arr{transform:none}');
    expect(CSS).toContain('html.wq-1b .wqs[dir=rtl] .wqs-arr svg{transform:scaleX(-1)}');
  });
});

describe('wq.css under wq-1b: Slower is a tortoise in a circle, its word under it', () => {
  const s = body('html.wq-1b .wqs-ctl .wqs-slow');
  test('a 48 circle like the arrows, the word below it on the captions\' line', () => {
    expect(s).toMatch(/width:var\(--btn-icon\);height:var\(--btn-icon\)/);
    expect(s).toMatch(/border-radius:var\(--r-icon\)/);
    expect(s).toMatch(/flex-direction:column/);
    expect(s).toMatch(/overflow:visible/);
    expect(s).toMatch(/margin-bottom:var\(--cap-h\)/);
    expect(body('html.wq-1b .wqs-ctl .wqs-slow[aria-pressed=true]')).toMatch(/background:#d6f5e3;border-color:var\(--hl\)/);
  });
  test('the small glyph gives way to a tortoise drawn in the text colour', () => {
    expect(body('html.wq-1b .wqs-ctl .wqs-slow .wqs-g')).toBe('display:none');
    const t = body('html.wq-1b .wqs-ctl .wqs-slow::before');
    expect(t).toMatch(/background:currentColor/);
    expect(t).toMatch(/-webkit-mask:url\("data:image\/svg\+xml,[^"]+"\) center\/contain no-repeat;mask:url\("data:image\/svg\+xml,[^"]+"\)/);
    expect(t).toMatch(/width:34px;height:25px/);
  });
});

describe('switch off: nothing moves', () => {
  test('the reader\'s files carry no one-button rule; every new wq.css rule sits under html.wq-1b', () => {
    expect(SJS).not.toMatch(/wq-1b|wqs-lbl|--cap-h/);
    expect(fs.readFileSync(path.join(WQ, 'wq-stories.css'), 'utf8')).not.toMatch(/wq-1b|--cap-h|wqs-tort/);
    rules(CSS).filter((r) => /--cap-h|::after|wqs-slow::before|\.wqs-ctl|\.wqs-top/.test(r.sel + r.body) && /wqs/.test(r.sel))
      .forEach((r) => r.sel.split(',').forEach((x) => expect([x.trim(), /^html\.wq-1b[\[ ]/.test(x.trim())]).toEqual([x.trim(), true])));
  });
});

describe('wq-home.css: a play ▶ is never mirrored on the Urdu home under wq-1b', () => {
  test('the unmirror comes after today\'s mirror and outweighs it', () => {
    const today = HCSS.indexOf('html[dir=rtl] .wq-ngo{transform:scaleX(-1)}');
    const fix = HCSS.indexOf('html.wq-1b[dir=rtl] .wq-ngo{transform:none}');
    expect(today).toBeGreaterThan(-1);
    expect(fix).toBeGreaterThan(today);
  });
});
