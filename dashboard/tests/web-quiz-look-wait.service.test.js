/**
 * The look's waits and one-next rule (web_quiz_one_button → `wq-1b`; web_quiz_adventure_look → `wq-adv`). CSS only.
 *
 * - a Jugnu bubble with no words yet is not drawn (an empty white pill read as broken);
 * - a list still loading in the page (the shelf, Games, Videos) gets Jugnu flying over its skeleton after 1.5 s, still
 *   (shown at once) under reduced motion;
 * - under the adventure look the skeleton blocks stand out from the ground (contrast ≥ 1.3:1, from the tokens);
 * - the storybook reader shows one "next": when its main button says Next, the › page arrow steps aside (its slot kept).
 * Switch off: every rule sits under html.wq-1b / html.wq-adv.
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const ADV = fs.readFileSync(path.join(WQ, 'wq-adventure.css'), 'utf8');

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const token = (css, name) => (new RegExp(`${name}:(#[0-9a-fA-F]{6})`).exec(css) || [])[1];

describe('a Jugnu bubble with no words is not drawn', () => {
  test('html.wq-1b .wq-say:empty is hidden', () => {
    expect(CSS).toContain('html.wq-1b .wq-say:empty{display:none}');
  });
});

describe('a list loading in the page: Jugnu over the skeleton after 1.5 s', () => {
  test('the skeleton holds a flying Jugnu that appears 1.5 s in, never catches a tap, and is still under reduced motion', () => {
    // the door lists' skeleton, the storybook shelf's grid while it loads, and the reader's own page wait
    const SK = 'html.wq-1b .wq-dskel,html.wq-1b .wqs-grid[aria-busy=true],html.wq-1b .wqs-skel.wqs-big';
    expect(CSS).toContain(`${SK}{position:relative}`);
    const r = /html\.wq-1b \.wq-dskel::after,html\.wq-1b \.wqs-grid\[aria-busy=true\]::after,html\.wq-1b \.wqs-skel\.wqs-big::after\{([^}]*)\}/.exec(CSS);
    expect(r).not.toBeNull();
    expect(r[1]).toMatch(/background:url\(\/wq\/jugnu\/idle\.webp\) center\/contain no-repeat/);
    expect(r[1]).toMatch(/opacity:0/);
    expect(r[1]).toMatch(/animation:wq-skjug [^;]* 1\.5s /);
    expect(r[1]).toMatch(/pointer-events:none/);
    expect(CSS).toContain('@media (prefers-reduced-motion:reduce){html.wq-1b .wq-dskel::after,html.wq-1b .wqs-grid[aria-busy=true]::after,html.wq-1b .wqs-skel.wqs-big::after{animation:none;opacity:1}}');
  });
});

describe('the adventure look: skeleton blocks stand out from the ground', () => {
  test('--skel against --ground is at least 1.3:1, and the skeleton blocks paint from --skel', () => {
    const ground = token(ADV, '--ground');
    const skel = token(ADV, '--skel');
    expect(ground).toBeTruthy();
    expect(skel).toBeTruthy();
    expect(contrast(ground, skel)).toBeGreaterThanOrEqual(1.3);
    const rule = /html\.wq-adv \.wqa-skel,html\.wq-adv \[data-skel\],[^{]*\{([^}]*)\}/.exec(ADV);
    // the storybook shelf's and reader's skeleton blocks are in that list too
    expect(/html\.wq-adv \.wqa-skel,html\.wq-adv \[data-skel\],([^{]*)\{/.exec(ADV)[1]).toContain('html.wq-adv .wqs-skel');
    expect(rule[1]).toMatch(/background:linear-gradient\(90deg,var\(--skel\) 0 40%,var\(--skel-hi\) 50%,var\(--skel\) 60%\)/);
  });
});

describe('the reader: one "next"', () => {
  test('when the main button says Next, the › page arrow steps aside (its slot kept, so nothing moves)', () => {
    expect(CSS).toContain('html.wq-1b .wqs-ctl:has(.wqs-main.wqs-next) .wqs-arr[data-tap=next]{visibility:hidden}');
  });
});

describe('switch off: nothing moves', () => {
  test('the new rules sit under html.wq-1b (wq.css) or html.wq-adv (wq-adventure.css)', () => {
    ['.wq-say:empty', '.wq-dskel::after', '.wq-dskel,', ':has(.wqs-main.wqs-next)'].forEach((s) => {
      const i = CSS.indexOf(s);
      expect(i).toBeGreaterThan(-1);
      expect(CSS.slice(CSS.lastIndexOf('}', i) + 1, i)).toMatch(/html\.wq-1b /);
    });
  });
});

describe('the quiz question wraps balanced (a «؟» or a short last word never sits alone on line 2)', () => {
  test('html.wq-1b .wq-qtext takes text-wrap:balance', () => {
    expect(CSS).toContain('html.wq-1b .wq-qtext{text-wrap:balance}');
  });
});

describe('the storybook done screen: Next, Share and Home share the column width', () => {
  test('the finish card in the reader\'s centred sheet stretches to the column (it no longer shrinks to its words)', () => {
    expect(CSS).toContain('html.wq-1b .wqs-sheet>.wqfc{align-self:stretch}');
  });
});
