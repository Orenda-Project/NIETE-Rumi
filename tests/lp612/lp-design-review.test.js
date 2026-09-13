/**
 * THE OPERATOR'S PDF DESIGN REVIEW — `grade_6_geography_c04_p63_en.pdf`, 2026-09-12.
 *
 * Eleven items, filed as bd-a8veu.1 through .11. This suite carries the ones that are a
 * property of the document the renderer BUILDS, and pins each to the emitted artefact rather
 * than to the source that emitted it.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. This repo's Jest run has no browser (`tests/__mocks__`),
 * so a rendered box cannot be measured here — but `buildHtml()` is not a pure helper either:
 * it EVALUATES the stylesheet, including the `${start}`/`${end}` interpolation that decides
 * whether the Urdu overlay mirrors. Every test below drives the real `buildHtml` and reads the
 * sheet it just wrote, exactly as `phone-page.test.js` does. The measurement half — the actual
 * pixels — is recorded on each bead, taken off a real render at 520x2000 with Chrome.
 *
 * ── item 5 · "Introduction boxes have left too much blank space on the right,
 *              the formatting is not sitting in the whole box itself" ──────────────
 *
 * The operator read this as a box problem. It is not: every block measures the full 478px
 * content column. It is a ROW problem, and it is one mechanism wearing three class names.
 *
 * Every question row — warm-up (`.wu .it`), practice (`.pr .it`), homework (`.hw .it`) — was
 * a flex line holding three children: the number `.n` (`flex:0 0 auto`), the question `.q`
 * (`flex:0 1 auto`, so grow 0), and a chip: `.kind`, `.tier` or `.tag`, all `flex:0 0 auto`.
 * A chip that cannot shrink reserves its full max-content width as a hard column for the
 * whole height of the row; the question gets whatever is left and wraps into a narrow ribbon,
 * and the space UNDER the chip stays blank. Measured on the fixture at 520px:
 *
 *   warm-up 3   chip "SPACED REVIEW · P.22, ADDING MATRICES"  372.8px of a 478px row (78%)
 *               -> `.q` squeezed to 70.1px -> the row is 261.4px tall
 *   homework    chip `[SLO, K/U/A]` 173.4px -> rows fill 55-59% of their own width
 *
 * and `.q`'s max-content is 725-1685px in every one of them: the text is not short, it is
 * boxed in. There is no free space for `flex-grow` to distribute (14.3 + 248.3 + 173.4 + two
 * 9px gaps = 454 = the 476px client width less its padding), which is why giving `.q` a grow
 * factor does nothing.
 *
 * The fix is to stop laying the row as a line. `.it` becomes `display:flow-root` and the chip
 * floats to the END edge, so the question flows the full measure and reclaims the column under
 * the chip. Measured over all 11 rows of the fixture: 1865.6px -> 1326.5px, a saving of
 * 539.1px — 28.9% of the vertical space these rows occupy, and over a quarter of a 1917px
 * content box. So this is also a page-count lever (bd-a8veu.1). Two other candidates were
 * measured and lost: flex-wrap + `flex:1 1 60%` saved 337.9px and made `.exit` rows worse;
 * hoisting the chip to the front of the row first saved 546.3px — 7px better across 11 rows,
 * which does not pay for changing three emitters.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const buildAll = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) });
const buildFrom = (d, lang = 'en') => buildAll(d, lang).html;
const built = (lang = 'en') => buildFrom(doc(), lang);

/** the one rule the emitted sheet declares for `sel`, as it was written */
function rule(html, sel) {
  const m = html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  if (!m) throw new Error(`the emitted stylesheet has no rule for \`${sel}\``);
  return m[0];
}

/** the emitted BODY — everything after the stylesheet, so a class name in a CSS
 *  selector can never be mistaken for a class name on an element */
const body = (html) => html.slice(html.indexOf('</style>'));

/** where `needle` first appears in the body, asserted to appear at all */
function at(html, needle, what) {
  const i = body(html).indexOf(needle);
  if (i < 0) throw new Error(`the emitted document has no ${what} (looked for \`${needle}\`)`);
  return i;
}

/** the three question rows, and the chip each one carries */
const ROWS = [
  { row: '.wu .it', num: '.wu .n', chip: '.wu .kind' },
  { row: '.pr .it', num: '.pr .n', chip: '.pr .tier' },
  { row: '.hw .it', num: '.hw .n', chip: '.hw .tag' },
];

describe('bd-a8veu.5 — a question row gives its question the whole measure', () => {
  test('no question row is laid out as a flex LINE', () => {
    // A flex line is what makes the chip a column. Whatever replaces it must contain the
    // float, so the row also has to establish a block formatting context.
    const html = built('en');
    for (const { row } of ROWS) {
      const r = rule(html, row);
      expect(r).not.toMatch(/display:\s*flex/);
      expect(r).toMatch(/display:\s*flow-root/);
    }
  });

  test('no chip is an unshrinkable flex item beside the question', () => {
    const html = built('en');
    for (const { chip } of ROWS) {
      const r = rule(html, chip);
      // `flex:0 0 auto` is the defect in one declaration: grow 0, SHRINK 0, basis max-content.
      expect(r).not.toMatch(/flex:\s*0\s+0\s+auto/);
      // and `margin-left:auto` only pushes a flex item; outside a flex line it does nothing,
      // so a fix that leaves it behind has left the row half-converted.
      expect(r).not.toMatch(/margin-\w+:\s*auto/);
    }
  });

  test('the chip floats to the END edge, so the question wraps back under it', () => {
    const html = built('en');
    for (const { chip } of ROWS) {
      expect(rule(html, chip)).toMatch(/float:\s*right/);
    }
  });

  test('the Urdu build mirrors the float — the chip is never stranded on the wrong edge', () => {
    // This is the half a source-text assertion cannot reach: `float:${end}` and a literal
    // `float:right` are the same characters in the EN sheet and different documents in Urdu.
    const ur = built('ur');
    for (const { chip } of ROWS) {
      const r = rule(ur, chip);
      expect(r).toMatch(/float:\s*left/);
      expect(r).not.toMatch(/float:\s*right/);
    }
    // the number mirrors with it, or it lands on top of the chip
    for (const { num } of ROWS) {
      expect(rule(ur, num)).toMatch(/float:\s*right/);
    }
  });

  test('the number still leads the row, and keeps the gap the flex line used to draw', () => {
    const html = built('en');
    for (const { num } of ROWS) {
      const r = rule(html, num);
      expect(r).toMatch(/float:\s*left/);
      // `gap` dies with the flex line; without a replacement the number touches the question.
      expect(r).toMatch(/margin-right:\s*[\d.]+px/);
    }
  });
});

/**
 * ── item 6 · "Key words should come on the 1st page, so teachers have their materials
 *              listed, videos, and key words. So the 1st page quickly tells the teacher
 *              where they are at, what they are teacing, the SLO, the resources, videos
 *              and key words of this lesson" ────────────────────────────────────────
 *
 * Page 1 already opens with WHERE (the hero: grade, subject, chapter, pages, minutes),
 * WHAT NEXT (the sequence strip) and the SLO (the outcome box). The three things the
 * operator names as missing are the three that were scattered:
 *
 *   the video      one bordered row under the outcome box  — already on page 1
 *   the materials  14px muted ITALIC, folded into the pacing sentence at the very END
 *                  of the teach part (`.mats .cont`), four pages away
 *   the key words  a block INSIDE the Introduction section, mid-page
 *
 * All three are resources — things the teacher has to have in her hand before the bell —
 * so they become one box directly under the outcome. This is a MOVE, exactly as the video
 * itself was moved out of Development (see `resourcesLine`): each renders in exactly ONE
 * place, and a second copy of the same content is a defect that costs a page.
 *
 * The key words move in the RENDERER only. `lint_lp.js`'s VOCAB_PAGE reads the DOCUMENT —
 * it requires a `keywords` block among the introduction's blocks and a page number on it —
 * so the lp_doc shape, the author brief, and every `ur_overlay` pointer are untouched.
 *
 * `L.continues` ("Support pages follow — planning material for you, not read aloud in
 * class") stays at the end of the teach part, because that is the only place it is true.
 */
describe("bd-a8veu.6 — page 1 is the teacher's at-a-glance card", () => {
  // `atom()` rewrites the outer element's class attribute to add its spacing class, so the card
  // ships as `class="rescard sp-2"`. Match the opening of the attribute, not a closed one.
  const CARD = 'class="rescard';

  test('the resources card is on page 1, above the first section', () => {
    const html = built('en');
    const card = at(html, CARD, 'resources card');
    const intro = at(html, 'data-sec="introduction"', 'introduction bar');
    expect(card).toBeLessThan(intro);
  });

  test('the key words are in that card, not buried inside the Introduction', () => {
    const html = built('en');
    expect(at(html, 'class="kwrow"', 'key-words row'))
      .toBeLessThan(at(html, 'data-sec="introduction"', 'introduction bar'));
    // ONE copy. A hoist that leaves the block rendering in place too is not a move.
    expect(body(html).match(/class="kwrow"/g)).toHaveLength(1);
  });

  test('the materials are on page 1, not in the tail sentence four pages later', () => {
    const html = built('en');
    const intro = at(html, 'data-sec="introduction"', 'introduction bar');
    // the fixture's own materials, so this cannot pass on a label alone
    expect(at(html, 'Squared paper', 'materials list')).toBeLessThan(intro);
    // and the tail keeps the one sentence that is only true at the end
    const tail = body(html).slice(at(html, 'class="mats', 'tail sentence'));
    expect(tail).toMatch(/Support pages follow/);
    expect(tail).not.toMatch(/Squared paper/);
  });

  test('the video still renders exactly once, and inside the card', () => {
    const html = built('en');
    expect(body(html).match(/class="vres"/g)).toHaveLength(1);
    const card = at(html, CARD, 'resources card');
    expect(at(html, 'class="vres"', 'video row')).toBeGreaterThan(card);
    expect(at(html, 'class="vres"', 'video row'))
      .toBeLessThan(at(html, 'data-sec="introduction"', 'introduction bar'));
  });

  test('a lesson with no video still gets its card, with materials and key words', () => {
    // the card is not the video row wearing a new name: it must hold on its own. Most lessons
    // carry a video (the fixture does), so strip it to reach the branch that does not.
    const d = doc();
    delete d.sections.find((s) => s.id === 'development').video;
    const html = buildFrom(d);
    expect(body(html)).not.toMatch(/class="vres"/);
    const card = at(html, CARD, 'resources card');
    expect(at(html, 'class="kwrow"', 'key-words row')).toBeGreaterThan(card);
    expect(at(html, 'Squared paper', 'materials list')).toBeGreaterThan(card);
    expect(at(html, 'Squared paper', 'materials list'))
      .toBeLessThan(at(html, 'data-sec="introduction"', 'introduction bar'));
  });
});

/**
 * ── item 7 · "2nd page should be the introduction: warm up and opening, watch out,
 *              on the board should have the diagram needed there as well" ─────────
 *
 * Measured on the fixture at 520x2000, after item 6 shipped, the Introduction was cut in
 * half and its picture was four sheets away:
 *
 *   page 1  hero 204 · seq 146 · outcome 448 · resources 294 | intro bar 36 · warm-up 335 · hook 241
 *   page 2  watch 136 · board note 101        <- the Introduction's orphaned tail
 *           development bar 36 · the whole D section
 *   page 5  REFERENCE A · board diagram 220 + draw-order card 262
 *
 * The second half of the operator's sentence is the load-bearing one. `page2.board_final`
 * is the FINAL STATE OF THE BOARD plus the order to build it — the brief calls it "the single
 * most requested artefact a teacher asked for" — and it was printed as reference matter, on a
 * sheet the teacher is told not to read in class. A board plan is useless after the board is
 * built. It belongs under the Introduction's own `ON THE BOARD` note, which is where the
 * teacher first picks up the chalk: she sees what she is building toward before she starts
 * laying it out.
 *
 * So the pair MOVES — figure and draw-order card together, out of reference A and into the
 * Introduction. It is a move, not a copy: reference A is emitted by `S()`, which paints
 * nothing for a section whose bodies are all empty, so the support index closes up and B
 * becomes A by itself (render-law 15). No string, no schema key and no `ur_overlay` pointer
 * changes — `page2.board_final` is still where the document keeps it, exactly as the key
 * words stayed in `introduction.blocks` when they were hoisted for item 6.
 *
 * The arithmetic of item 1 is why the packing is not touched here: page-1 furniture is
 * 1092px and the Introduction with the board plan folded in is 1331px, so 2423px against a
 * 1917px box — the Introduction can never START on page 1. Whether the teach part spends a
 * fifth page on it is measured on a real render and recorded on the bead, not guessed here.
 */
describe('bd-a8veu.7 — the board plan is in the Introduction, not in Reference', () => {
  const INTRO = 'data-sec="introduction"';
  const DEV = 'data-sec="development"';
  /** the draw-order card: `.ord` is emitted nowhere else in the document */
  const ORD = 'class="ord"';
  /** a support-page section bar prints its name in `.nm`; the moved block uses a `.lbl` */
  const REF_BOARD_BAR = 'class="nm">The board at the end of the lesson<';

  /** the body between the Introduction bar and the Development bar */
  const introRun = (html) => body(html).slice(at(html, INTRO, 'introduction bar'), at(html, DEV, 'development bar'));

  test('the draw-order card is inside the Introduction', () => {
    const html = built('en');
    const run = introRun(html);
    expect(run).toContain(ORD);
    // the fixture's own first board step, so this cannot pass on a class name alone
    expect(run).toContain('Write the two matrices side by side');
  });

  test('the board diagram travels with it, and the figure leads the order', () => {
    const html = built('en');
    const run = introRun(html);
    const fig = run.indexOf('<figure class="dg"');
    expect(fig).toBeGreaterThan(-1);
    expect(fig).toBeLessThan(run.indexOf(ORD));
    // and it lands under the Introduction's own ON THE BOARD note, not above it
    expect(run.indexOf('class="blk board"')).toBeLessThan(fig);
  });

  test('it is a MOVE — Reference carries no board section, and the letters close up', () => {
    const html = built('en');
    expect(body(html)).not.toContain(REF_BOARD_BAR);
    // one draw-order card in the whole document. A copy left behind costs the page it saved.
    expect(body(html).match(/class="ord"/g)).toHaveLength(1);
    // `S` assigns letters in emission order, so the next section becomes A by itself
    expect(body(html)).toMatch(/data-sec="p2-A"[\s\S]{0,160}class="nm">Model answers</);
  });

  test('the diagram can never be the last atom on a page — the order follows it', () => {
    // This is the half the emitted text cannot show: `glue` lives in the atom metadata the
    // packer reads, not in the HTML. A figure that ends a sheet leaves the teacher looking at
    // a finished board with the order to draw it overleaf.
    const { atoms } = buildAll(doc(), 'en');
    const run = atoms.teach.filter((a) => a.sec === 'introduction');
    expect(run.length).toBeGreaterThan(2);
    expect(run[run.length - 2].glue).toBe(true);
    expect(run[run.length - 1].glue).toBeFalsy();
  });

  test('the Urdu build moves it too', () => {
    const ur = built('ur');
    expect(introRun(ur)).toContain(ORD);
    expect(body(ur)).not.toContain('class="nm">سبق کے اختتام پر تختۂ سیاہ<');
  });

  test('a lesson whose board plan has no diagram still moves the order out of Reference', () => {
    // `board_final.diagram` is required by the brief but optional in the schema, and that
    // branch used to be the only thing keeping reference A alive on its own.
    const d = doc();
    delete d.page2.board_final.diagram;
    const html = buildFrom(d);
    expect(introRun(html)).toContain(ORD);
    expect(body(html)).not.toContain(REF_BOARD_BAR);
  });
});

/**
 * ── item 2 · "the section with the last current, next and checkpoint has blank space
 *             after arrows, its design is off putting, and wasting lines and space" ──
 *
 * Measured on the operator's own PDF (`$SP/real.txt`, lines 9-16), the strip printed SIX
 * line boxes for four phrases:
 *
 *   Last: Forests of the world — types and characteristics
 *   →
 *   Forests of Pakistan — the four forest types and where they grow (p.63–64)
 *   →
 *   Next: Why forests matter / conservation of forests
 *   · Checkpoint: Ch. 4 chapter review
 *
 * Both arrows landed alone on a line with the rest of that line blank. That is exactly what
 * the operator is describing, and it has ONE cause with TWO halves, both in `.seq`:
 *
 *   `display:flex; flex-wrap:wrap` makes every direct child an ATOMIC flex item. A phrase
 *   that does not fit in what is left of the current line moves to the next line whole, and
 *   the remainder of the line it left is blank — there is no text-level wrapping across the
 *   boundary. At the 520px phone measure (PAGE_FORMATS.phone) every one of these phrases is
 *   long enough to trigger it, so the strip wastes a fragment of a line per phrase.
 *
 *   The `<span class="arrow">` is one of those direct children. Being an atomic item of its
 *   own, it can be pushed onto a line by itself — and because the phrase after it is also
 *   too long to join it, it STAYS by itself. That is the visible "blank space after arrows".
 *
 * The fix is to stop laying the strip as a line of boxes and let it flow as text: `.seq`
 * becomes ordinary block flow, and each arrow moves INSIDE the phrase it terminates, so it
 * is glued to that phrase's last word and can never be stranded. Prose flow also packs the
 * phrases continuously, which is where the wasted lines go.
 *
 * No browser here (see the header), so what is asserted is the MECHANISM — the container is
 * not a flex context, and no arrow is an item in its own right. The line count itself is
 * recorded on bd-a8veu.2 from a real 520x2000 Chrome render.
 */
describe('bd-a8veu.2 — the sequence strip flows as text and never strands an arrow', () => {
  const AR = { en: '&rarr;', ur: '&larr;' };

  /** the strip as it was emitted, `<div class="seq …">` through its closing tag */
  function strip(html) {
    const b = body(html);
    const i = b.indexOf('class="seq');
    if (i < 0) throw new Error('the emitted document has no sequence strip');
    const open = b.lastIndexOf('<div', i);
    return b.slice(open, b.indexOf('</div>', i) + 6);
  }

  test('the strip is not a flex context — a phrase may wrap, not jump', () => {
    // The container is what makes each child atomic. Leave it flex and the arrows can be
    // nested all day; every PHRASE is still a box that leaves the rest of its line blank.
    const r = rule(built(), '.seq');
    expect(r).not.toMatch(/display:\s*flex/);
    expect(r).not.toMatch(/flex-wrap/);
  });

  /** the attributes of the strip's DIRECT child spans, in paint order */
  function directChildren(s) {
    const inner = s.slice(s.indexOf('>') + 1, s.lastIndexOf('</div>'));
    const out = [];
    let depth = 0;
    for (const m of inner.matchAll(/<(\/?)span\b([^>]*)>/g)) {
      if (m[1]) depth--;
      else out.push(depth++ === 0 ? m[2] : null);
    }
    return out.filter((a) => a !== null);
  }

  test('no arrow is a direct child of the strip', () => {
    // A direct child is a flex item under the old sheet and an independent inline box under
    // the new one. Either way it is separable from the phrase it belongs to, which is the
    // whole defect. Nesting depth is what decides it, so the spans are walked, not matched.
    const s = strip(built());
    expect(directChildren(s).some((a) => /class="arrow"/.test(a))).toBe(false);
    expect(s).toContain('class="arrow"'); // …and the arrows were not simply deleted
  });

  test('each arrow is the LAST thing inside the phrase it terminates', () => {
    // Glued to the end of that phrase's text: when the arrow happens to land at a line edge
    // the next phrase continues on the following line, so no line is left part-empty.
    const s = strip(built());
    const arrows = [...s.matchAll(/<span class="arrow">([^<]*)<\/span>/g)];
    expect(arrows).toHaveLength(2); // previous -> this, this -> next
    for (const m of arrows) {
      expect(m[1]).toBe(AR.en);
      expect(s.slice(m.index + m[0].length, m.index + m[0].length + 7)).toBe('</span>');
    }
  });

  test('the four phrases are still all there, in order, each one labelled', () => {
    // A layout fix may not quietly drop a leg. This is the operator's "last, current, next
    // and checkpoint" read straight off the fixture.
    const s = strip(built());
    const d = doc();
    const order = [d.sequence.previous, d.sequence.this, d.sequence.next, d.sequence.checkpoint];
    let cursor = -1;
    for (const phrase of order) {
      const i = s.indexOf(phrase.replace(/&/g, '&amp;'));
      expect(i).toBeGreaterThan(cursor);
      cursor = i;
    }
    // the labels as `overlay.js` writes them — `seqPrev` is "Last", not "Previous"
    expect(s).toContain('Last:');
    expect(s).toContain('Next:');
    expect(s).toContain('Checkpoint:');
  });

  test('a lesson with no next period prints no trailing arrow', () => {
    // The arrow after the current phrase exists to point AT the next one. With nothing to
    // point at, an arrow hanging off the end of the strip is the stranding defect again.
    const d = doc();
    delete d.sequence.next;
    const s = strip(buildFrom(d));
    expect(s).toContain(d.sequence.this);
    expect([...s.matchAll(/class="arrow"/g)]).toHaveLength(1);
  });

  test('the Urdu strip flows the same way, with the arrow pointing into the text', () => {
    const s = strip(built('ur'));
    const arrows = [...s.matchAll(/<span class="arrow">([^<]*)<\/span>/g)];
    expect(arrows).toHaveLength(2);
    for (const m of arrows) expect(m[1]).toBe(AR.ur);
    expect(directChildren(s).some((a) => /class="arrow"/.test(a))).toBe(false);
    expect(rule(built('ur'), '.seq')).not.toMatch(/display:\s*flex/);
  });
});
