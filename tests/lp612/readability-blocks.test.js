/**
 * bd-a8veu.11 — READABILITY: colour blocks and a type hierarchy that holds the eye.
 *
 * Operator, item 11 of the v9.3 PDF review: *"the readability of the LP should be better with
 * colour blocks and formatting of text and font to hold the eye"*.
 *
 * THE CONSTRAINT THAT SHAPES THE WHOLE PASS: there is no vertical room. The gate fixture renders
 * at `t1 99% · t2 91% · t3 100% · t4 100%` of the page box against a hard cap of 4 teach pages
 * (render_lp.js:88). A readability pass that spends a single vertical pixel per section buys a
 * fifth page, and a fifth page is item 1 of this same review coming back. So every move below is
 * COLOUR, WEIGHT or INLINE-DIRECTION geometry — never padding, margin, leading or type size.
 * That is not a stylistic preference; it is the only budget available, and these tests are what
 * hold the next editor to it.
 *
 * The three defects, read off the regenerated PDF:
 *
 *   1. THE SECTION BAND LOSES TO ITS OWN CONTENTS. `.bar` is a pale wash (`.s-a` is #E3F3E9)
 *      carrying coloured text, and the very next element inside Activity is a SOLID green
 *      "WE DO" pill. The only navigational landmark in a seven-page document is outranked by a
 *      label inside it, so a teacher flipping for "Activity" has nothing to catch. The band now
 *      wears the colour its own badge already wore — the palette does not change, the fill moves
 *      from the tint to the strong colour, and the text turns white.
 *
 *   2. EVERY SMALL-CAPS LABEL IS THE SAME LABEL. `WARM-UP`, `KEY WORDS`, `KEY POINTS`,
 *      `DIFFERENTIATION` and `COMMON MISTAKES…` head a GROUP of sibling cards; `ON THE BOARD`,
 *      `WATCH OUT`, `EXIT TICKET` and `IF STUCK` name a single leaf. All ten are one 14px
 *      uppercase `.lbl`. The concept of a group heading already existed — three call sites had
 *      already reached for `style="color:var(--navy2)"` / `style="color:#8A5F04"` by hand — so
 *      this is a rule replacing three inline hacks, not a new abstraction.
 *
 *   3. THE TWO WORKED EXAMPLES ARE ONE GREY BOX TWICE. `.exq.we` (we-do) is tinted green to
 *      match its green tag; the default (`I do`) carries an amber tag on a grey hairline box.
 *      Same costume, different job.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const render = (doc, opts = {}) => buildHtml(doc, { docDir: path.dirname(FIXTURE), ...opts }).html;
const sheet = (out) => out.slice(0, out.indexOf('</style>'));
const body = (out) => out.slice(out.indexOf('</style>'));

/** The declaration block of one rule, by exact selector text.
 *  The boundary check is load-bearing: a bare `indexOf('p{')` matches inside `.wrap{`, and the
 *  body-floor assertion would then be reading some other rule entirely and passing by accident. */
function rule(css, selector) {
  const needle = selector + '{';
  let i = -1;
  for (;;) {
    i = css.indexOf(needle, i + 1);
    if (i < 0) return null;
    if (i === 0 || !/[A-Za-z0-9_.#)\]-]/.test(css[i - 1])) break;
  }
  const j = css.indexOf('}', i);
  return j < 0 ? null : css.slice(i + needle.length, j);
}

/** Every font-size in a declaration block, as numbers. The sheet is SCALED (scaledPx ≈ 1.1667), */
/*  so these are only ever compared to one another, never to the source value.                  */
const sizes = (decl) => [...(decl || '').matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));

const OUT = render(baseDoc(), { lang: 'en' });
const CSS = sheet(OUT);
const HTML = body(OUT);

/** The seven sections, and the strong colour each one's BADGE already carried. */
const SECTIONS = [
  ['.s-o', '#8A5F04'],          // objectives — the amber the band's own text already used
  ['.s-w', '#8A5F04'],          // warm-up
  ['.s-i', 'var(--navy2)'],     // introduction
  ['.s-d', 'var(--navy)'],      // development
  ['.s-a', 'var(--leaf)'],      // activity
  ['.s-c', '#584A93'],          // conclusion
  ['.s-h', '#5b6472'],          // homework
];

/** The pale tints the bands used to be filled with. None may survive as a band fill. */
const OLD_TINTS = ['#E1EAF6', '#EAF0F8', '#FBF1DF', '#ECE8F6', '#EFF1F4', 'var(--amber-soft)', 'var(--leaf-soft)'];

describe('the section band is a block of colour, not a wash', () => {
  test.each(SECTIONS)('%s is filled with the strong colour its badge already wore', (cls, colour) => {
    const decl = rule(CSS, cls);
    expect(decl).toBeTruthy();
    expect(decl).toMatch(new RegExp(`background:\\s*${colour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`, 'i'));
  });

  test('no band is still filled with one of the old pale tints', () => {
    for (const [cls] of SECTIONS) {
      const decl = rule(CSS, cls) || '';
      for (const tint of OLD_TINTS) expect(decl.toLowerCase()).not.toContain(tint.toLowerCase());
    }
  });

  test('the band prints its name and its minutes in white', () => {
    const decl = rule(CSS, '.bar .nm,.bar .mins');
    expect(decl).toBeTruthy();
    expect(decl).toMatch(/color:\s*#fff/i);
  });

  test('no section still overrides the band text with its own colour', () => {
    // A leftover `.s-d .nm{color:var(--navy)}` on a navy fill is invisible text.
    for (const [cls] of SECTIONS) {
      expect(CSS).not.toContain(`${cls} .nm`);
      expect(CSS).not.toContain(`${cls} .mins`);
    }
  });

  test('the badge is a translucent chip on the fill, not a second solid', () => {
    // One rule for all seven, because a per-section solid is now the band's own colour on itself:
    // a navy badge on a navy band is a hole. Translucent white reads on every one of the seven.
    const decl = rule(CSS, '.bar .badge');
    expect(decl).toMatch(/background:\s*rgba\(255,\s*255,\s*255,/);
    for (const [cls] of SECTIONS) expect(CSS).not.toContain(`${cls} .badge`);
  });

  test('the band outranks every label and pill inside its section', () => {
    const band = sizes(rule(CSS, '.bar .nm'))[0];
    expect(band).toBeGreaterThan(0);
    for (const sel of ['.lbl', '.exq .tag', '.pr .tag']) {
      const inner = sizes(rule(CSS, sel))[0];
      expect(inner).toBeGreaterThan(0);
      expect(band).toBeGreaterThan(inner);
    }
  });

  test('THE BUDGET: the band costs not one vertical pixel more than it did', () => {
    // padding, radii and borders do NOT pass through the type scale (see THE TYPE SCALE note in
    // template.js), so these are literal source values in the emitted sheet.
    const decl = rule(CSS, '.bar');
    expect(decl).toContain('padding:4px 11px');
    expect(decl).toContain('margin:0');
    const badge = rule(CSS, '.bar .badge');
    expect(badge).toContain('width:20px');
    expect(badge).toContain('height:20px');
  });
});

describe('a group heading and a leaf label are two different things', () => {
  test('there is a group variant of the label', () => {
    expect(rule(CSS, '.lbl.g')).toBeTruthy();
  });

  test('it is marked by an inline-start accent rule, so it costs no height', () => {
    const decl = rule(CSS, '.lbl.g');
    expect(decl).toMatch(/border-left:\s*[\d.]+px solid/);
    expect(decl).toMatch(/padding-left:/);
    // THE BUDGET, again: inline direction only. Not one of these may appear.
    expect(decl).not.toMatch(/padding-top|padding-bottom|margin-top|margin-bottom|border-top|border-bottom|line-height|font-size/);
  });

  test('it does not shrink the label to pay for the accent', () => {
    // `.lbl` is the CHIP FLOOR (14px source, 16.33px emitted). The group heading may not go under
    // it, and neither may the leaf label — colour is the budget here, never size.
    expect(sizes(rule(CSS, '.lbl'))[0]).toBeCloseTo(16.33, 1);
    expect(sizes(rule(CSS, '.lbl.g'))).toEqual([]);
  });

  const GROUPS = ['KEY WORDS', 'KEY POINTS', 'WARM-UP'];
  test.each(GROUPS)('%s heads a group, so it carries the group variant', (label) => {
    const re = new RegExp(`<div class="lbl g"[^>]*>${label.replace('-', '.?')}`, 'i');
    expect(HTML).toMatch(re);
  });

  const LEAVES = ['WATCH OUT', 'ON THE BOARD', 'EXIT TICKET'];
  test.each(LEAVES)('%s names one leaf, so it stays a plain label', (label) => {
    const re = new RegExp(`<div class="lbl">(&#9888; )?${label}`, 'i');
    expect(HTML).toMatch(re);
  });

  test('the group headings in the support-page card groups carry it too', () => {
    // groupAtoms() paints COMMON MISTAKES … and DIFFERENTIATION when the flow does not host them.
    const doc = baseDoc();
    const out = body(render(doc, { lang: 'en' }));
    const groups = [...out.matchAll(/<div class="lbl g"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    expect(groups.length).toBeGreaterThanOrEqual(3);
  });

  test('no label paints itself with a hand-written inline colour any more', () => {
    // The three `style="color:…"` hacks are what the group variant replaces. A fourth one added
    // later is the drift this catches.
    expect(HTML).not.toMatch(/class="lbl[^"]*"\s+style="color:/);
  });

  test('the Urdu page puts the accent on the start edge, not the left edge', () => {
    const ur = sheet(render(baseDoc(), { lang: 'ur' }));
    const decl = rule(ur, '.lbl.g');
    expect(decl).toMatch(/border-right:\s*[\d.]+px solid/);
    expect(decl).not.toMatch(/border-left:/);
  });
});

describe('the two worked examples read as a pair with different roles', () => {
  test('the I-do box wears the colour of its own tag', () => {
    const box = rule(CSS, '.exq');
    const tag = rule(CSS, '.exq .tag');
    expect(tag).toMatch(/background:\s*var\(--amber\)/);
    expect(box).toMatch(/background:/);          // it used to have none at all
    expect(box).not.toMatch(/border:\s*1px solid var\(--line\)/);
  });

  test('the we-do box keeps its own green, so the two are still told apart', () => {
    const we = rule(CSS, '.exq.we');
    expect(we).toMatch(/border-color:\s*#BFE3CD/i);
    expect(we).toMatch(/background:\s*#F6FCF8/i);
  });

  test('THE BUDGET: the fill costs no height — the box keeps its border width and padding', () => {
    const box = rule(CSS, '.exq');
    expect(box).toMatch(/border:\s*1px solid/);
    expect(box).toContain('padding:6px 11px');
  });
});

describe('the pass changes no content', () => {
  test('the gate fixture still lints clean', () => {
    expect(lint(baseDoc()).fails).toEqual([]);
  });

  test('the body floor is untouched — nothing was shrunk to pay for colour', () => {
    expect(sizes(rule(CSS, 'p'))[0]).toBeCloseTo(21, 1);
  });
});
