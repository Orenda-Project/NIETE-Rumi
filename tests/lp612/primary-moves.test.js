/**
 * bd-f6opy -- ONE HUE PER GRADUAL-RELEASE MOVE, AND THE SHARED BAND SPLITS.
 *
 * OPERATOR: *"what about all the moves being of different colours?"* -- and, choosing between
 * the options costed for her: *"I DO amber, WE DO teal, YOU DO green. All three get the same
 * shape: solid pill inside its own tinted box. Split the shared 'We Do / You Do' green band
 * into two bands so each move is its own landmark."*
 *
 * WHAT WAS MEASURED, AND WHY THE PREMISE OF HER QUESTION WAS THE OPPOSITE OF THE TRUTH. The
 * three moves were not three colours; they were navy, green and green:
 *
 *   I DO   solid amber pill in an amber `.exq` box, under the navy `.s-d` development band.
 *   WE DO  solid green pill in a green `.exq.we` box, under the GREEN `.s-a` activity band.
 *   YOU DO a PALE-GREEN OUTLINE pill and NO BOX AT ALL -- `.pr` declares neither a border nor
 *          a background -- under THE SAME green `.s-a` band, which spans pages 8-12.
 *
 * So the release read navy -> green -> green, the one move a teacher most needs to find was
 * the only one with no surface of its own, and the band gave her no way to tell the half of
 * the section where the class practises together from the half where the children are alone.
 *
 * WHAT THIS SUITE DEFENDS:
 *
 *   1. THREE MOVES, THREE HUES, ONE SHAPE. Each pill is a solid fill of its move's colour, and
 *      the three fills are pairwise >=15 dE -- the same law readability-blocks.test.js holds
 *      over the section bands, run over the moves. The maths is shared, not copied.
 *   2. YOU DO HAS A SURFACE. `.pri .pr.pc` declares a border AND a background, so the move the
 *      teacher hunts for is a box like the other two.
 *   3. ...AND IT IS *ONE* BOX. A YOU DO list is already split one item per atom (24 of them in
 *      the longest corpus lesson), so a naive frame would draw 24 boxes. It reuses the
 *      `.pc-a`/`.pc-m`/`.pc-z` seam idiom `.exq` already uses (SYNC 3.18): the pieces open the
 *      edge they share and butt at sp-0, so N pieces paint what one card painted.
 *   4. THE BAND SPLITS IN TWO. Activity prints a WE DO band and a YOU DO band, each carrying
 *      its own move's minutes off its own block, and the second is registered under its own
 *      continuation key so a page resuming inside YOU DO does not say "We Do, continued".
 *   5. NO WORD IS DELETED. The section title was the concatenation "We Do / You Do"; splitting
 *      it prints BOTH halves, each over the half of the section it names. Every question,
 *      answer and pill text prints exactly as before.
 *   6. G6-12 IS UNTOUCHED BY CONSTRUCTION. `.s-we` is a brand-new class no other block emits;
 *      every repaint of a shared surface sits under `.pri`, which goes on <html> for grade 1-5
 *      alone. The grade 9 fixture is the control and must render as it always has.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));
const { rule, fillOf, resolved, deltaE, contrast } = require('./__helpers__/colour');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The same fixture re-provenanced to grade 4 -- the one thing `isPrimary` reads. */
function doc() {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
}

const built = (d) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: 'en' });
const sheet = (d) => {
  const h = built(d).html;
  return h.slice(0, h.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
};
const body = (d) => built(d).html.split('</style>').pop();
const hasClass = (h, c) => new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?"`).test(h);
const attrOf = (h, c) => {
  const m = h.match(new RegExp(`class="((?:[^"]*\\s)?${c}(?:\\s[^"]*)?)"`));
  return m ? m[1] : null;
};
/** Every section band on the page, in print order, as [fill class, printed name]. */
const bands = (h) => [...h.matchAll(/class="bar (s-[a-z-]+)[^"]*"[^>]*>.*?class="nm">([^<]*)</gs)]
  .map((m) => [m[1], m[2].trim()]);

const L = LABELS.en;
const CSS = sheet(doc());
const YOU_KEY = 'activity:you';

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------- 1. the G6-12 control */

describe('a G6-12 plan prints the moves exactly as it did', () => {
  const h = () => body(baseDoc());

  test('activity still prints one band, and it is the green one', () => {
    const act = bands(h()).filter(([cls]) => cls === 's-a' || cls === 's-we');
    expect(act.map(([cls]) => cls)).toEqual(['s-a']);
  });

  test('no WE DO band and no YOU DO continuation key exist at all', () => {
    expect(hasClass(h(), 's-we')).toBe(false);
    expect(built(baseDoc()).probeKeys).not.toContain(YOU_KEY);
  });

  test('the YOU DO practice keeps its unframed pill and takes no card seams', () => {
    expect(attrOf(h(), 'pr')).not.toMatch(/\bpc\b/);
    // The base rule still says what it always said -- and a grade 9 page can reach no other,
    // because every repaint above is gated on a `.pri` this document never wears on <html>.
    expect(rule(CSS, '.pr .tag')).toMatch(/background:\s*var\(--s-do\)/);
    expect(/<html[^>]*\bclass="[^"]*\bpri\b/.test(built(baseDoc()).html)).toBe(false);
  });
});

/* ------------------------------------------------------ 2. three moves, three hues */

describe('each gradual-release move is its own colour', () => {
  /** The pill of each move, by the selector that paints it for a primary plan. */
  //                 selector that paints it for primary   fill            the ink it prints in
  const PILLS = [
    ['I DO', '.exq .tag', 'var(--amber)', '.pri .exq .tag'],
    ['WE DO', '.pri .exq.we .tag', 'var(--band-we)', '.pri .exq.we .tag'],
    ['YOU DO', '.pri .pr .tag', 'var(--leaf)', '.pri .pr .tag'],
  ];
  /** The ink a pill prints its name in, chased to a literal. */
  const inkOf = (sel) => resolved(CSS, (rule(CSS, sel).match(/color:\s*([^;]+);/) || [])[1]);

  test.each(PILLS)('the %s pill is a solid fill of %s', (move, sel, token) => {
    expect(fillOf(CSS, sel)).toBe(token);
  });

  test('the three fills are far enough apart to be told apart', () => {
    // The floor is readability-blocks.test.js's own: 15 dE. Three pills a teacher reads as one
    // colour is the defect whatever the sheet spells them, so the law is the LOOK, not the token.
    const MIN_DELTA_E = 15;
    const fills = PILLS.map(([move, sel]) => {
      const hex = resolved(CSS, fillOf(CSS, sel));
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      return [move, hex];
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

  test('every pill carries its own name at 4.5:1', () => {
    // 14px bold tracked caps is NORMAL text by WCAG (large starts at 18.66px bold), so 4.5 is
    // the floor, not 3. The law is the pair -- fill against the ink printed ON it -- because
    // "white on every pill" is exactly what failed: amber carries white at 2.11:1.
    const weak = PILLS
      .map(([move, sel, , inkSel]) => [move, contrast(resolved(CSS, fillOf(CSS, sel)), inkOf(inkSel))])
      .filter(([, ratio]) => ratio < 4.5)
      .map(([move, ratio]) => `${move} ${ratio.toFixed(2)}:1`);
    expect(weak).toEqual([]);
  });

  test('no I DO or WE DO box still prints a line in YOU DO green', () => {
    // The result line was leaf green in every card, which read as "this is the answer" back when
    // green meant nothing else. It now means YOU DO, so a green sentence in the amber or blue
    // card names the wrong move -- the same confusion as the shared band, moved into the box.
    // Each card's result takes its card's own ink; YOU DO's answers stay green, where green IS
    // the move. The base rule is untouched, so a G6-12 card reads exactly as it did.
    expect(rule(CSS, '.exq .res')).toMatch(/color:\s*var\(--leaf\)/);
    expect(rule(CSS, '.pri .exq .res')).toMatch(/color:\s*var\(--s-note-ink\)/);
    expect(rule(CSS, '.pri .exq.we .res')).toMatch(/color:\s*var\(--band-we\)/);
  });

  test('...and every one of those inks is declared, not inherited from somewhere off-page', () => {
    // A pill whose ink is inherited is a pill whose contrast no test can hold: the rule that
    // sets the fill must set the ink beside it, so the pair moves together for ever after.
    for (const [, , , inkSel] of PILLS) expect(inkOf(inkSel)).toMatch(/^#[0-9a-f]{3,6}$/i);
  });

  test('the WE DO box is repainted to its own family, and only the paint moves', () => {
    const we = rule(CSS, '.pri .exq.we');
    expect(we).toMatch(/background:\s*var\(--s-teach\)/);
    expect(we).toMatch(/border-color:\s*var\(--s-teach-line\)/);
    // Fill and hairline only: a padding or a border WIDTH here would move every page below it.
    expect(we).not.toMatch(/padding|border-width|border:\s/);
  });
});

/* ------------------------------------------------------- 3. YOU DO gets a surface */

describe('the YOU DO move is a box, and it is one box', () => {
  const h = () => body(doc());

  test('it declares the frame it never had', () => {
    // On the BLOCK, not on the seam classes: a list of one or two items never splits, and it
    // must be a box too. The seam classes below only ever open an edge of this frame.
    const box = rule(CSS, '.pri .blk.pr');
    expect(box).toMatch(/border:\s*1px solid var\(--s-do-line\)/);
    expect(box).toMatch(/background:\s*var\(--s-do\)/);
    expect(rule(CSS, '.pri .pr.pc')).toMatch(/border-radius:\s*0/);
  });

  test('the pieces open the edges they share, so N of them paint one card', () => {
    expect(rule(CSS, '.pri .pr.pc-a')).toMatch(/border-bottom:\s*0/);
    expect(rule(CSS, '.pri .pr.pc-m')).toMatch(/border-top:\s*0/);
    expect(rule(CSS, '.pri .pr.pc-m')).toMatch(/border-bottom:\s*0/);
    expect(rule(CSS, '.pri .pr.pc-z')).toMatch(/border-top:\s*0/);
  });

  test('a break landing on a seam says the card goes on', () => {
    expect(rule(CSS, '.pri .pad > .pr.pc:not(.pc-z):nth-last-child(2)')).toMatch(/2px dashed/);
    expect(rule(CSS, '.pri .pad > .bar + .pr.pc:not(.pc-a)')).toMatch(/2px dashed/);
  });

  test('the atoms carry the seam classes, and they butt with no gap between them', () => {
    const pieces = [...h().matchAll(/class="blk pr (pc pc-[amz])[^"]*"/g)].map((m) => m[1]);
    expect(pieces[0]).toBe('pc pc-a');
    expect(pieces[pieces.length - 1]).toBe('pc pc-z');
    // Only the first piece keeps a rhythm margin; the rest must touch, or the "one card" shows
    // the page through its seams.
    const rhythm = [...h().matchAll(/class="blk pr pc pc-[amz] (sp-\d)"/g)].map((m) => m[1]);
    expect(rhythm.slice(1).every((s) => s === 'sp-0')).toBe(true);
  });
});

/* ----------------------------------------------------------- 4. the band splits */

describe('activity prints one band per move', () => {
  const h = () => body(doc());

  test('there are two bands, WE DO first in its own hue and YOU DO second in the green', () => {
    const act = bands(h()).filter(([cls]) => cls === 's-a' || cls === 's-we');
    expect(act).toEqual([['s-we', L.weDo], ['s-a', L.youDo]]);
  });

  test('each band carries its own move\'s minutes, read off that move\'s own block', () => {
    // 5 and 7 are the fixture's `wedo.minutes` and `youdo.minutes`. The section's own 12 is
    // their sum and is now printed nowhere, because no band spans both halves any more.
    const mins = [...h().matchAll(/class="bar (s-we|s-a)[^"]*"[^>]*>.*?class="mins">([^<]*)</gs)]
      .map((m) => m[2].trim());
    expect(mins).toEqual([`5 ${L.min}`, `7 ${L.min}`]);
  });

  test('the YOU DO band opens above the YOU DO pill, not above the WE DO example', () => {
    const t = h();
    const we = t.indexOf('We do &mdash; together on the board') >= 0
      ? t.indexOf('We do &mdash; together on the board') : t.indexOf('together on the board');
    const band = t.indexOf(`class="bar s-a`);
    const pill = t.indexOf(L.independent);
    expect(we).toBeGreaterThan(-1);
    expect(band).toBeGreaterThan(we);
    expect(pill).toBeGreaterThan(band);
  });

  test('YOU DO has its own continuation key, so a resumed page names the right move', () => {
    expect(built(doc()).probeKeys).toContain(YOU_KEY);
    expect(built(doc()).secTitles[YOU_KEY]).toBe(L.youDo);
  });

  test('the split costs no vertical pixel beyond the one band it adds', () => {
    // readability-blocks.test.js pins `.bar` to padding:4px 11px. `.s-we` may only add a fill.
    expect(rule(CSS, '.s-we').replace(/\s/g, '')).toBe('background:var(--band-we);');
  });
});

/* ---------------------------------------------------------- 5. no word moves */

describe('the pass changes no content', () => {
  test('both halves of the old section title still print, one per band', () => {
    const names = bands(body(doc())).map(([, nm]) => nm);
    expect(names).toContain(L.weDo);
    expect(names).toContain(L.youDo);
  });

  test('every practice question and answer still prints', () => {
    const t = body(doc());
    for (const it of doc().sections.find((s) => s.id === 'activity')
      .blocks.find((b) => b.type === 'practice').items) {
      expect(t).toContain(it.ref);
    }
  });

  test('the pill texts are the ones the blocks already carried', () => {
    const t = body(doc());
    expect(t).toContain('We do \u2014 together on the board');
    expect(t).toContain(L.independent);
  });
});
