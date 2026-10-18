/**
 * The storybook shelf and reader in the one button look (html.wq-1b, wq.css; app_settings web_quiz_one_button).
 *
 * - the reader's page arrows are the icon kind: a --btn-icon circle (--r-icon) with the second skin's line and ledge,
 *   pressed like .wqs-ic in English AND in Urdu, still at rest with reduced motion, not pressed when disabled, and the
 *   Urdu mirror on the drawing (never the box);
 * - a shelf cover's title keeps two lines' room (clamped at two, a fixed two-line height) in English and in the
 *   Urdu face, so a one-line and a two-line title sit in rows of equal covers;
 * - the shelf's and the reader's boxes take their corners from the three tokens only (--r-card, --r-btn, --r-icon);
 * - switch off: wq-stories.js / wq-stories.css carry no one-button rule, every new rule sits under html.wq-1b.
 *
 * Every value is the one that WINS: all rules of wq.css then wq-stories.css (the order the page loads them) that
 * match the element in the given state are collected, and the highest specificity, then the last in source order,
 * decides; a later rule that overrides an earlier one is seen.
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const SCSS = fs.readFileSync(path.join(WQ, 'wq-stories.css'), 'utf8');
const SJS = fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8');

// `selector{body}` with no brace inside; a rule inside an @media block is found the same way (its `media` kept)
const rulesOf = (css) => {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rx = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rx.exec(src))) {
    const before = src.slice(0, m.index);
    const open = before.lastIndexOf('@media');
    const media = open >= 0 && (before.slice(open).match(/\{/g) || []).length > (before.slice(open).match(/\}/g) || []).length ? before.slice(open, before.indexOf('{', open)) : '';
    out.push({ sel: m[1].trim(), body: m[2], media });
  }
  return out;
};
const R = rulesOf(CSS);
const ALL = [...R, ...rulesOf(SCSS)];

// specificity as one number (ids, classes/attributes/pseudo-classes, types); :not()/:is() count their argument, :where() nothing
const spec = (sel) => {
  const s = sel.replace(/:where\([^)]*\)/g, '').replace(/:(?:not|is)\(([^)]*)\)/g, ' $1').replace(/::[\w-]+/g, '');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
  const c = (s.replace(/\[[^\]]*\]/g, '').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return a * 1e6 + b * 1e3 + c;
};
const TOK = /\.[\w-]+|\[[^\]]*\]|:(?:not|is|where)\([^)]*\)|:[\w-]+|^[a-z][\w-]*/gi;
// does one comma part select the element `target` (a class `.x` or a tag) in context ctx?
//   ctx.states  pseudo-classes it is in (':active', ':disabled'); ctx.attrs  attributes on it ('[lang=ur]');
//   ctx.anc     ancestor classes besides .wqs; ctx.rtl  inside .wqs[dir=rtl]
const applies = (part, target, ctx) => {
  const comps = part.trim().split(/\s*[\s>+~]\s*/);
  const last = comps.pop().match(TOK) || [];
  if (!last.includes(target)) return false;
  const okLast = last.every((t) => t === target || (ctx.states || []).includes(t) || (ctx.attrs || []).includes(t) || /^:(not|where|is)\(/.test(t) || (/^[a-z]/i.test(t) && /^\./.test(target) && t === 'button'));
  if (!okLast) return false;
  const anc = ['html', '.wq-1b', '.wqs', ...(ctx.anc || [])];
  return comps.every((c) => (c.match(TOK) || []).every((t) => anc.includes(t) || (t === '[dir=rtl]' && ctx.rtl) || /^:(not|where|is)\(/.test(t)));
};
const win = (target, prop, ctx = {}) => {
  let best = null;
  ALL.forEach((r, i) => {
    if (r.media && !(ctx.media && ctx.media.test(r.media))) return;
    r.sel.split(',').forEach((part) => {
      if (!applies(part, target, ctx)) return;
      r.body.split(';').forEach((d) => {
        const k = d.indexOf(':');
        if (k < 0 || d.slice(0, k).trim() !== prop) return;
        const cand = { s: spec(part), i, v: d.slice(k + 1).trim(), part };
        if (!best || cand.s > best.s || (cand.s === best.s && cand.i >= best.i)) best = cand;
      });
    });
  });
  return best ? best.v : null;
};
const RTL = { rtl: true };
const PRESS = { states: [':active'] };
const RM = /prefers-reduced-motion/;
const ARR_PRESS = 'translateY(2px) scale(var(--press-s))';

describe('the cascade reader itself', () => {
  test('a later rule of the same weight wins; a heavier one wins wherever it sits', () => {
    expect(win('.wqs-arr', 'border-radius', {})).toBe('var(--r-icon)'); // (0,2,1) over wq-stories.css .wqs-arr 32px (0,1,0)
    expect(spec('html.wq-1b .wqs[dir=rtl] .wqs-arr')).toBeGreaterThan(spec('html.wq-1b .wqs-arr:active'));
    expect(spec('html.wq-1b .wqs[dir=rtl] .wqs-arr:active')).toBeGreaterThan(spec('html.wq-1b .wqs[dir=rtl] .wqs-arr'));
  });
});

describe('the reader\'s page arrows: the icon kind', () => {
  test('at rest: a --btn-icon circle with the second skin\'s line and ledge', () => {
    expect(win('.wqs-arr', 'width')).toBe('var(--btn-icon)');
    expect(win('.wqs-arr', 'height')).toBe('var(--btn-icon)');
    expect(win('.wqs-arr', 'border-radius')).toBe('var(--r-icon)');
    expect(win('.wqs-arr', 'border')).toBe('2px solid var(--line)');
    expect(win('.wqs-arr', 'box-shadow')).toBe('0 var(--btn-d2) 0 var(--line)');
    expect(win('.wqs-arr', '-webkit-tap-highlight-color')).toBe('transparent');
  });
  test('the narrowest phones (a max-width rule in force): still the token, in both languages', () => {
    const narrow = { media: /max-width/ };
    expect(win('.wqs-arr', 'width', narrow)).toBe('var(--btn-icon)');
    expect(win('.wqs-arr', 'height', { ...narrow, rtl: true })).toBe('var(--btn-icon)');
  });
  test('English: pressed like .wqs-ic', () => {
    expect(win('.wqs-arr', 'transform', PRESS)).toBe(ARR_PRESS);
    expect(win('.wqs-arr', 'transform', PRESS)).toBe(win('.wqs-ic', 'transform', PRESS));
    expect(win('.wqs-arr', 'box-shadow', PRESS)).toBe('0 2px 0 var(--line)');
    expect(win('.wqs-arr', 'filter', PRESS)).toBe('brightness(var(--press-dim))');
  });
  test('Urdu: pressed like .wqs-ic too (the mirror on the box would otherwise outweigh the press)', () => {
    expect(win('.wqs-arr', 'transform', { ...RTL, ...PRESS })).toBe(ARR_PRESS);
    expect(win('.wqs-arr', 'box-shadow', { ...RTL, ...PRESS })).toBe('0 2px 0 var(--line)');
  });
  test('Urdu at rest: the box is not turned, the drawing is', () => {
    expect(win('.wqs-arr', 'transform', RTL)).toBe('none');
    expect(win('svg', 'transform', { ...RTL, anc: ['.wqs-arr'] })).toBe('scaleX(-1)');
  });
  test('reduced motion: a press does not move the arrow, in either language', () => {
    expect(win('.wqs-arr', 'transform', { ...PRESS, media: RM })).toBe('none');
    expect(win('.wqs-arr', 'transform', { ...RTL, ...PRESS, media: RM })).toBe('none');
  });
  test('a disabled arrow does not press (no move, no dim, the resting ledge)', () => {
    const dis = { states: [':active', ':disabled'] };
    expect(win('.wqs-arr', 'transform', dis)).toBe('none');
    expect(win('.wqs-arr', 'filter', dis)).toBe('none');
    expect(win('.wqs-arr', 'box-shadow', dis)).toBe('0 var(--btn-d2) 0 var(--line)');
    expect(win('.wqs-arr', 'transform', { ...dis, rtl: true })).toBe('none');
  });
});

describe('the reader\'s screens keep the gutter', () => {
  test('every reader screen (not the shelf, which its door already frames) pads --gutter on both edges', () => {
    expect(win('.wqs', 'padding-inline')).toBe('var(--gutter)');
  });
});

describe('a shelf cover\'s title keeps two lines\' room', () => {
  const B = { anc: ['.wqs-book', '.wqs-grid'] };
  test('English: clamped at two lines, a fixed two-line height', () => {
    expect(win('b', 'display', B)).toBe('-webkit-box');
    expect(win('b', '-webkit-line-clamp', B)).toBe('2');
    expect(win('b', '-webkit-box-orient', B)).toBe('vertical');
    expect(win('b', 'overflow', B)).toBe('hidden');
    const lh = win('b', 'line-height', B);
    expect(lh).toBeTruthy();
    expect(win('b', 'height', B)).toBe(`calc(2em * ${lh})`);
  });
  test('Urdu: the Nastaliq face at the Urdu line token, the same two-line height', () => {
    const U = { ...B, attrs: ['[lang=ur]'] };
    expect(win('b', 'font-family', U)).toBe('var(--fu)');
    expect(win('b', 'line-height', U)).toBe('var(--btn-lh-ur)');
    expect(win('b', 'height', U)).toBe('calc(2em * var(--btn-lh-ur))');
    expect(win('b', '-webkit-line-clamp', U)).toBe('2');
  });
});

describe('the corners: three tokens only', () => {
  const TOKENS = ['var(--r-card)', 'var(--r-btn)', 'var(--r-icon)'];
  test.each([
    // the shelf
    ['.wqs-book', {}, 'var(--r-card)'], ['.wqs-tcard', {}, 'var(--r-card)'],
    ['.wqs-cov', { anc: ['.wqs-book'] }, 'var(--r-btn)'], ['img', { anc: ['.wqs-tcard'] }, 'var(--r-btn)'],
    ['.wqs-gl', {}, 'var(--r-btn)'], ['.wqs-chip', {}, 'var(--r-btn)'], ['.wqs-rib', { anc: ['.wqs-tcard'] }, 'var(--r-btn)'],
    ['.wqs-tick', {}, 'var(--r-icon)'],
    // the loading cover (and the reader's loading page): the card radius, set once by the one button system for the
    // waiting boxes; on the shelf it is one of the three already there (the book card), so the shelf stays at three
    ['.wqs-skel', {}, 'var(--r-card)'],
    // the reader
    ['.wqs-stage', {}, 'var(--r-card)'], ['.wqs-qc', {}, 'var(--r-card)'],
    ['.wqs-whole', {}, 'var(--r-btn)'], ['.wqs-slow', {}, 'var(--r-btn)'], ['.wqs-opt', {}, 'var(--r-btn)'], ['img', { anc: ['.wqs-opt', '.wqs-opts', '.wqs-orow'] }, 'var(--r-btn)'],
    ['.wqs-main', {}, 'var(--r-btn)'], ['.wqs-ic', {}, 'var(--r-icon)'], ['.wqs-arr', {}, 'var(--r-icon)'],
  ])('%s %j wins %s', (t, ctx, want) => {
    expect(win(t, 'border-radius', ctx)).toBe(want);
    expect(TOKENS).toContain(want);
  });
  test('the ribbon on a cover: its rounded end is --r-btn (its flat end stays square)', () => {
    expect(win('.wqs-rib', 'border-start-end-radius')).toBe('var(--r-btn)');
    expect(win('.wqs-rib', 'border-end-end-radius')).toBe('var(--r-btn)');
  });
  test('one owner per radius: no two wq-1b rules set .wqs-skel\'s corner (a later one would silently win)', () => {
    const n = R.filter((r) => !r.media && /border-radius\s*:/.test(r.body) && r.sel.split(',').some((s) => /^html\.wq-1b \.wqs-skel$/.test(s.trim()))).length;
    expect(n).toBe(1);
  });
});

describe('switch off: today\'s storybook bytes', () => {
  test('the storybook\'s own files carry no one-button rule; every wqs rule the look adds sits under html.wq-1b', () => {
    expect(SCSS).not.toMatch(/wq-1b/);
    expect(SJS).not.toMatch(/wq-1b/);
    const start = CSS.indexOf('/* ONE button system');
    const end = CSS.indexOf('/* ===== one Urdu face');
    expect(start).toBeGreaterThan(0);
    rulesOf(CSS.slice(start, end)).filter((r) => /\.wqs-/.test(r.sel)).forEach((r) => {
      r.sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^html\.wq-1b/));
    });
  });
});
