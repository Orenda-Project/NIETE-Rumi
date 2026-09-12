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

/**
 * The seven sections, and the strong colour each one's BADGE already carried.
 *
 * These are TOKEN SPELLINGS, not hexes, since bd-a8veu.23 collapsed the sheet onto the surface
 * ladder: a band names a role and the role owns the value. The values themselves did not move —
 * the test below re-reads each token out of `:root` and pins it to the hex it has always been, so
 * this pair of tests still proves "a band is a solid block of the strong colour", which is the
 * invariant, while leaving the sheet free to say it once instead of seven times.
 */
const SECTIONS = [
  ['.s-o', 'var(--s-note-ink)'], // objectives — the amber the band's own text already used
  ['.s-w', 'var(--band-w)'],     // warm-up — was the same amber as objectives, byte for byte
  ['.s-i', 'var(--band-i)'],     // introduction — was a navy 8.8 dE from development's
  ['.s-d', 'var(--navy)'],       // development
  ['.s-a', 'var(--leaf)'],       // activity
  ['.s-c', 'var(--band-c)'],     // conclusion — the one band fill with no pale role behind it
  ['.s-h', 'var(--mut)'],        // homework
];

/** What each band token must still resolve to in `:root`. */
const BAND_VALUES = {
  '--s-note-ink': '#8A5F04',
  '--navy2': '#13315C',
  '--navy': '#0B2545',
  '--leaf': '#1F7A4D',
  '--band-c': '#584A93',
  '--band-w': '#9E3B52',
  '--band-i': '#0F6A73',
  '--mut': '#5b6472',
};

/** The `background:` a band rule declares, token spelling and all. */
function fillOf(css, cls) {
  const m = (rule(css, cls) || '').match(/background:\s*([^;]+);/);
  expect(m).not.toBeNull();
  return m[1].trim();
}

/** A value chased through `:root` until it is a literal — `var(--s-note-ink)` -> `#8A5F04`. */
function resolved(css, value) {
  const root = css.match(/:root\{([\s\S]*?)\}/)[1];
  let v = String(value).trim();
  for (let i = 0; i < 8 && v.startsWith('var('); i += 1) {
    const token = v.slice(4, v.indexOf(')')).trim();
    const m = root.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    expect(m).not.toBeNull();
    v = m[1].trim();
  }
  return v;
}

/** CIE L*a*b*, so two fills can be compared by how far apart they LOOK, not by how they are spelled. */
function lab(hex) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255));
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/** WCAG 2.x contrast of a hex fill against the #fff the band's name and minutes are printed in. */
function contrastWithWhite(hex) {
  const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => ch(parseInt(hex.slice(i, i + 2), 16) / 255));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05);
}

/** The pale tints the bands used to be filled with. None may survive as a band fill. */
const OLD_TINTS = ['#E1EAF6', '#EAF0F8', '#FBF1DF', '#ECE8F6', '#EFF1F4', 'var(--amber-soft)', 'var(--leaf-soft)'];

describe('the section band is a block of colour, not a wash', () => {
  test.each(SECTIONS)('%s is filled with the strong colour its badge already wore', (cls, colour) => {
    const decl = rule(CSS, cls);
    expect(decl).toBeTruthy();
    expect(decl).toMatch(new RegExp(`background:\\s*${colour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`, 'i'));
  });

  test('the band tokens still carry the strong values they replaced', () => {
    const root = CSS.match(/:root\{([\s\S]*?)\}/)[1];
    for (const [token, hex] of Object.entries(BAND_VALUES)) {
      expect(root).toMatch(new RegExp(`${token}\\s*:\\s*${hex}\\s*;`, 'i'));
    }
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

  test('SEVEN MOVES, SEVEN COLOURS — no two bands read as one', () => {
    /**
     * Operator: *"what about the moves being different coloured in the LP?"*
     *
     * They were not. Seven moves carried six values, and two of the collisions were the two
     * halves of the same page: Objectives and Warm-up were BOTH `--s-note-ink` `#8A5F04`, byte
     * for byte, and Introduction `#13315C` sat one step off Development `#0B2545` — close enough
     * that at band size, under a white badge, they read as one navy. So four of the seven bands
     * were two browns and two navies, and the landmark a teacher flips pages for stopped being a
     * landmark.
     *
     * The assertion is on the RESOLVED value, not on the token spelling — `--s-note-ink` twice is
     * a duplicate however it is written — and it is a DISTANCE, not an inequality, because the
     * second collision was never two equal strings. Two hexes that differ are still one colour to
     * a teacher; CIE L*a*b* is the cheapest thing that says so. The floor is 15: the old navies
     * measure 8.8 apart and the old ambers 0.0, while the tightest pair the seven now hold is 21.
     */
    const MIN_DELTA_E = 15;
    const fills = SECTIONS.map(([cls]) => {
      const hex = resolved(CSS, fillOf(CSS, cls));
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      return [cls, hex];
    });
    const tooClose = [];
    for (let i = 0; i < fills.length; i += 1) {
      for (let j = i + 1; j < fills.length; j += 1) {
        const d = deltaE(fills[i][1], fills[j][1]);
        if (d < MIN_DELTA_E) tooClose.push(`${fills[i][0]} ${fills[i][1]} vs ${fills[j][0]} ${fills[j][1]} = ${d.toFixed(1)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  test('every band still carries its white name and minutes at 4.5:1', () => {
    // `.bar .nm,.bar .mins{color:#fff}` is one rule for all seven, so a fill that fails contrast
    // does not look wrong — it prints the move name in white on a colour too pale to hold it.
    const weak = SECTIONS.map(([cls]) => [cls, contrastWithWhite(resolved(CSS, fillOf(CSS, cls)))])
      .filter(([, ratio]) => ratio < 4.5)
      .map(([cls, ratio]) => `${cls} ${ratio.toFixed(2)}:1`);
    expect(weak).toEqual([]);
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

  // WE DO is the box the class works through together, so under the ladder it is the `do` role,
  // and the role is what this asserts: the I-do box is amber-tagged on note, the we-do box is
  // green on do. The green got one step deeper (#F6FCF8 -> the shared --s-do) when the sheet
  // collapsed nineteen pale tints onto five; what matters here is that the two are still a pair
  // a teacher can tell apart at a glance, not which of two near-identical greens it is.
  test('the we-do box keeps its own green, so the two are still told apart', () => {
    const we = rule(CSS, '.exq.we');
    expect(we).toMatch(/border-color:\s*var\(--s-do-line\)/);
    expect(we).toMatch(/background:\s*var\(--s-do\)/);
    expect(rule(CSS, '.exq')).not.toMatch(/background:\s*var\(--s-do\)/);
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
