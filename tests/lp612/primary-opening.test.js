/**
 * bd-usirc -- THE OPENING IS ONE BOX: SETTLE, THEN PROVOKE.
 *
 * OPERATOR, in her page map for the G1-5 profile: *"kie.ai has a Warm Up and Opening boxes,
 * thgere should be 1 opening box that first has a warm up that helps kids settle and prepare
 * for activating prior knowledge / then the actual hook to engage students with a provocation
 * to help link prior knowledge to the new concept being introduced"*.
 *
 * Today the Introduction prints two boxes with a full rhythm gap between them -- `.blk.wu`
 * under its own label, then `.blk.hook` under its own -- and in the corpus render page 1 ends
 * on the warm-up while page 2 opens on the hook, which is the same defect the split says out
 * loud. They are ONE move in a classroom: settle and recall, then provoke.
 *
 * WHAT THIS SUITE DEFENDS:
 *
 *   1. ONE FRAME, TWO BANDS. The warm-up opens it, the hook closes it, and the seam between
 *      them is not a gap -- the hook atom carries no rhythm margin at all, so the two bands
 *      touch and read as one surface.
 *   2. THE HOOK IS STILL THE LOUDEST THING ON THE PAGE (design law M3). It keeps `.hook` and
 *      its navy ground; joining the frame changes where its corners are, not what it is.
 *   3. THE BOX CLOSES WHATEVER IS IN IT. A plan with no hook, or no warm-up, still prints one
 *      closed box -- the single movement carries both ends. An open-ended frame is a defect
 *      the corpus can produce, because `warmUp` and `hookStory` are independently optional.
 *   4. NO WORD MOVES. Every item, every label, the question and the look-for all print exactly
 *      as they did; this is presentational joining, not an edit.
 *   5. G6-12 IS UNTOUCHED BY CONSTRUCTION -- the frame is gated on `isPrimary(doc)`, so the
 *      grade 9 fixture is the control and must render as it always has.
 *
 * ATOMS, NOT ONE ATOM: an atom never splits, and warm-up + hook together are ~920px, which on
 * A4's 1063px box would be an atom that can only ever start a page. They stay two atoms that
 * draw one box -- the `groupAtoms` precedent, where a label rides with card 1.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat } = T;
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The same fixture re-provenanced to grade 4 -- the one thing `isPrimary` reads. */
function doc() {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
}

const built = (d, opts = {}) =>
  buildHtml(d, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });
const build = (d, opts = {}) => built(d, opts).html;
/** Every atom of the teach part that asks the packer not to break after it. */
const softAtoms = (d) => (built(d).atoms.teach || []).filter((a) => a.soft);
const sheet = (html) => html.split('<style>')[1].split('</style>')[0]
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\(data:[^)]*\)/g, 'url()');
const body = (html) => html.split('</style>').pop();
/** `decorate` appends the rhythm class to the atom root, so match the NAME, not the attribute. */
const hasClass = (h, c) => new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?"`).test(h);
/** The class attribute of the element that carries `c` -- the whole of it, rhythm class included. */
const attrOf = (h, c) => {
  const m = h.match(new RegExp(`class="((?:[^"]*\\s)?${c}(?:\\s[^"]*)?)"`));
  return m ? m[1] : null;
};

const L = LABELS.en;
const introOf = (d) => d.sections.find((s) => s.id === 'introduction');
const dropHook = (d) => {
  const s = introOf(d);
  s.blocks = s.blocks.filter((b) => !(b.type === 'ask' && b.hook));
  return d;
};
const dropWarmup = (d) => { delete introOf(d).warmup; return d; };

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------------ 1. the G6-12 control */

describe('a G6-12 plan opens exactly as it did', () => {
  const h = () => body(build(baseDoc()));

  test('there is no opening frame at all', () => {
    expect(hasClass(h(), 'opn')).toBe(false);
    expect(hasClass(h(), 'ofirst')).toBe(false);
    expect(hasClass(h(), 'olast')).toBe(false);
  });

  test('the warm-up and the hook are still two boxes with rhythm between them', () => {
    expect(hasClass(h(), 'wu')).toBe(true);
    expect(hasClass(h(), 'hook')).toBe(true);
    expect(attrOf(h(), 'hook')).toMatch(/\bsp-[1-5]\b/);
  });
});

/* ------------------------------------------------------------------ 2. one box, two bands */

describe('the primary opening is one box', () => {
  const h = () => body(build(doc()));

  test('the warm-up opens the frame and the hook closes it', () => {
    expect(attrOf(h(), 'wu')).toMatch(/\bopn\b/);
    expect(attrOf(h(), 'wu')).toMatch(/\bofirst\b/);
    expect(attrOf(h(), 'hook')).toMatch(/\bopn\b/);
    expect(attrOf(h(), 'hook')).toMatch(/\bolast\b/);
  });

  test('the seam is not a gap -- the hook band carries no rhythm margin', () => {
    expect(attrOf(h(), 'hook')).toMatch(/\bsp-0\b/);
    expect(attrOf(h(), 'hook')).not.toMatch(/\bsp-[1-5]\b/);
  });

  test('the warm-up comes first, because a class settles before it is provoked', () => {
    expect(h().indexOf(L.warmup)).toBeLessThan(h().indexOf(L.ask));
  });

  test('the hook is still the loudest thing in the box', () => {
    expect(attrOf(h(), 'hook')).toMatch(/\bhook\b/);
    expect(h()).toContain('Two shops stock two products');
  });

  test('no word moves: every warm-up item and the look-for still print', () => {
    const before = body(build(baseDoc()));
    const after = h();
    for (const s of ['Work out', 'the order of the matrix', L.warmup, L.ask, L.lookFor]) {
      expect(after).toContain(s.replace(/&/g, '&'));
      expect(before.includes(s) === after.includes(s)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ 3. it always closes */

describe('the box closes around whatever the day actually has', () => {
  test('a plan with no hook still prints one closed box', () => {
    const h = body(build(dropHook(doc())));
    expect(hasClass(h, 'hook')).toBe(false);
    expect(attrOf(h, 'wu')).toMatch(/\bofirst\b/);
    expect(attrOf(h, 'wu')).toMatch(/\bolast\b/);
  });

  test('a plan with no warm-up still prints one closed box', () => {
    const h = body(build(dropWarmup(doc())));
    expect(hasClass(h, 'wu')).toBe(false);
    expect(attrOf(h, 'hook')).toMatch(/\bofirst\b/);
    expect(attrOf(h, 'hook')).toMatch(/\bolast\b/);
  });

  test('a plan with neither draws no frame to close', () => {
    const h = body(build(dropWarmup(dropHook(doc()))));
    expect(hasClass(h, 'opn')).toBe(false);
  });
});

/* ------------------------------------------------------------------ 4. the frame in CSS */

describe('the stylesheet draws one box, not two', () => {
  const css = () => sheet(build(doc()));

  // A SEAM IS NOT A FOURTH RADIUS (SYNC 3.18): the shorthand squares the two corners the band
  // shares with the band below it, exactly as a split worked example already does.
  test('only the ends are rounded, so the seam is square', () => {
    expect(css()).toMatch(/\.pri \.opn\.ofirst\{[^}]*border-radius:var\(--r-2\) var\(--r-2\) 0 0/);
    expect(css()).toMatch(/\.pri \.opn\.olast\{[^}]*border-radius:0 0 var\(--r-2\) var\(--r-2\)/);
  });

  test('a box of ONE band is rounded all the way round, not square on top', () => {
    expect(css()).toMatch(/\.pri \.opn\.ofirst\.olast\{[^}]*border-radius:var\(--r-2\)[;}]/);
  });

  // A page break may fall on the seam: the two bands are two atoms and the packer breaks
  // between atoms. Gluing them measured at +7 pages across the 38-lesson corpus, which buys
  // nothing a closed edge does not. So every band closes its own bottom, and the squared
  // corners -- not an open edge -- are what say "this continues" (SYNC 3.18).
  test('the seam keeps its hairline, so a split prints two closed rectangles', () => {
    expect(css()).not.toMatch(/\.opn[^{}]*\{[^}]*border-bottom:\s*0/);
  });

  test('the frame is gated on .pri, so no G6-12 rule can match it', () => {
    for (const rule of css().match(/[^{}]*\.opn[^{}]*\{/g) || []) {
      expect(rule).toMatch(/\.pri\b/);
    }
  });
});

describe('the seam is a soft break, not a glued one', () => {
  test('the warm-up band asks the packer not to break after it', () => {
    expect(softAtoms(doc()).length).toBe(1);
  });

  test('with no hook there is nothing to stay joined to, so nothing is asked', () => {
    expect(softAtoms(dropHook(doc())).length).toBe(0);
  });

  test('G6-12 asks for nothing: every atom of the control is packed as it always was', () => {
    expect(softAtoms(baseDoc()).length).toBe(0);
  });
});
