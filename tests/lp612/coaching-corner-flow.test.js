/**
 * bd-yjmxh -- THE COACHING CORNER TOOK A SHEET OF ITS OWN.
 *
 * OPERATOR, three times over -- Maths first, then *"same feedback for coaching corner"* for
 * English, then *"Urdu is good in terms of feedback fixing, coaching corner to be fixed here
 * too"*. Her words: *"pls put the coaching corner in the previous page"*, and, when asked what
 * the rule should be: *"coaching corner can come in the same page if there is space, no need
 * for new page"*.
 *
 * WHAT WAS ACTUALLY WRONG. The corner is four short lines -- something to look for, a question
 * she asks herself, and the three-step offer. It was emitted as the LAST section of the SUPPORT
 * part, and `paginate` gives the support part a `.page` of its own by construction. So a lesson
 * whose last teach page was 7% full still turned a page to read four lines. Nothing about the
 * corner is reference matter: it is addressed to the teacher about the lesson she has just
 * taught, which is the end of the teach flow and not the start of the index.
 *
 * SO IT IS HOSTED IN THE FLOW, by the mechanism bd-a8veu.10 already built for exactly this --
 * `flowHosts` looks up a section to host a group that used to stand alone in Reference, the
 * group renders there through `after(s)`, and `page2` stops painting it. What it does NOT do is
 * decide the page: the corner is appended as ordinary atoms at the end of the teach part and
 * the exact packer places them. If there is room on the last page they land on it; if there
 * genuinely is not, the packer opens a page, which is the same answer it gives every other
 * atom. No page number is written down anywhere, and no second measuring mechanism exists --
 * the pass-1 probe charges the furniture it always charged.
 *
 * CONTENT MAY MOVE; IT MAY NEVER VANISH (flowHosts' own rule). A document with no teach section
 * to host it -- there is no such document in the corpus, but the renderer may not assume that --
 * keeps the corner in Reference, printed exactly as it was.
 *
 * AND THE LETTERS CLOSE UP. `S` assigns the support letter in emission order (render-law 15),
 * so removing the last section removes the last letter and nothing above it shifts.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The same fixture re-provenanced to grade 4 -- the one thing `isPrimary` reads. */
function doc(extra) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English', ...(extra || {}) };
  return d;
}

const built = (d, lang) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: lang || 'en' });
/** The rendered `.page` boxes of one part, in print order. Split on the boxes' own opening
    tag rather than matched as a pair: `.page` nests, so a lazy close matches the wrong one. */
const pagesOf = (html, part) => html
  .split('<div class="page"')
  .slice(1)
  .filter((seg) => seg.startsWith(` id="`) && new RegExp(`data-part="${part}"`).test(seg.slice(0, 60)));
/** `decorate` merges the rhythm class onto the atom root, so the card prints as
    `class="coach sp-1"` -- match the class, never the whole opening tag. */
const CARD = /class="coach[ "]/;
const corners = (html) => (html.match(/class="coach[ "]/g) || []).length;

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------- 1. it leaves the reference sheet */

describe('the coaching corner is part of the lesson, not of the index', () => {
  test('it is printed in the teach flow, where the teacher has just finished teaching', () => {
    const { html } = built(doc());
    expect(pagesOf(html, 'teach').join('')).toMatch(CARD);
  });

  test('...and not on the reference sheet any more', () => {
    const { html } = built(doc());
    expect(pagesOf(html, 'support').join('')).not.toMatch(CARD);
  });

  test('it is printed exactly once -- moved, not copied', () => {
    expect(corners(built(doc()).html)).toBe(1);
    expect(corners(built(doc(), 'ur').html)).toBe(1);
  });

  test('every word of it survives the move, in both languages', () => {
    for (const lang of ['en', 'ur']) {
      const L = LABELS[lang === 'ur' ? 'ur' : 'en'];
      const { html } = built(doc(), lang);
      expect(html).toContain(L.p2Coach);
      expect(html).toContain(L.coachAsk);
      expect(html).toContain(L.coachOffer);
      expect(html).toContain(L.coachSend);
      expect(html).toContain(L.coachBack);
    }
  });
});

/* ------------------------------------------ 2. the packer decides the page, not a number */

describe('where it lands is the packer\'s answer, not a hardcoded one', () => {
  test('it is appended as ordinary teach atoms, so a break may fall before it', () => {
    const { atoms } = built(doc());
    expect(atoms.teach.every((a) => typeof a.glue === 'boolean' || a.glue === undefined)).toBe(true);
    // It rides the flow, so it is NOT the support part's business any more.
    expect(built(doc()).secTitles).not.toHaveProperty('p2-B', LABELS.en.p2Coach);
  });

  test('it closes the teaching, above the line that hands over to the support sheet', () => {
    const teach = pagesOf(built(doc()).html, 'teach').join('');
    expect(teach.search(CARD)).toBeGreaterThan(-1);
    expect(teach.search(CARD)).toBeLessThan(teach.indexOf(LABELS.en.continues));
  });

  test('it registers no continuation key, so the probe measures exactly what it did', () => {
    // A continuation bar is charged per INDEXED section. The corner is a plain atom in the
    // flow, not a section, so the probe page has exactly the bars it had before -- and none of
    // them is the corner's, in either language.
    for (const lang of ['en', 'ur']) {
      const { probeKeys, secTitles } = built(doc(), lang);
      const L = LABELS[lang === 'ur' ? 'ur' : 'en'];
      expect(probeKeys.map((k) => secTitles[k])).not.toContain(L.p2Coach);
      expect(probeKeys).toEqual(Object.keys(secTitles));
    }
  });

  test('the support letters close up -- nothing above the corner shifts', () => {
    const titles = built(doc()).secTitles;
    const p2 = Object.entries(titles).filter(([k]) => k.startsWith('p2-'));
    expect(p2.map(([, t]) => t)).not.toContain(LABELS.en.p2Coach);
    expect(p2.map(([k]) => k)).toEqual(p2.map((_, i) => `p2-${String.fromCharCode(65 + i)}`));
  });
});

/* -------------------------------------------------------- 3. content may never vanish */

describe('a document with nowhere to host it keeps it in Reference', () => {
  test('no teach section means the corner prints exactly where it always did', () => {
    const d = doc();
    d.sections = [];
    const { html } = built(d);
    expect(corners(html)).toBe(1);
    expect(pagesOf(html, 'support').join('')).toMatch(CARD);
  });
});

/* -------------------------------------------------------------- 4. the G6-12 control */

describe('a G6-12 plan is paginated exactly as it always was', () => {
  // The move is PRIMARY ONLY, and that is a fact about the page rather than about the grade.
  // G6-12's support part is a real index -- exam bank, homework key, the mistakes fallback --
  // so the corner is one section among several on a sheet that exists anyway and costs no page
  // turn. It is the primary prune that takes the rest of that sheet away and leaves four lines
  // owning a page. All three of the operator's reports were primary.
  test('the corner stays in Reference, under its lettered bar', () => {
    const { html, secTitles } = built(baseDoc());
    expect(pagesOf(html, 'support').join('')).toMatch(CARD);
    expect(pagesOf(html, 'teach').join('')).not.toMatch(CARD);
    expect(Object.values(secTitles)).toContain(LABELS.en.p2Coach);
  });

  test('...and it names itself only where no bar names it', () => {
    // The flow card carries its own heading; the Reference one may not gain a second name.
    expect(built(baseDoc()).html).not.toMatch(/class="coach[^"]*"><div class="lbl">/);
    expect(built(doc()).html).toMatch(/class="coach[^"]*"><div class="lbl">/);
  });
});

/* --------------------------------------------------------------------------
 * bd-yjmxh, second pass. A DARK CORNER IS NOT WORTH A TEACH PAGE.
 *
 * The render of the real Urdu lesson warns:
 *   `! primary: dropped design-pending page2/coaching_lookfor`
 * `coaching_lookfor` is the corner's ONE required field (schema, page2.required), and on
 * the lessons the operator is looking at it is a `design pending -- not carried` sentinel
 * that `prunePending` strips before this renderer ever sees it. `coaching_reflection` is
 * optional and usually absent alongside it.
 *
 * So on exactly the documents this change was made for, the card can have NO BODY: a
 * heading, and the 1-2-3 offer strip, which is renderer furniture rather than anything
 * this lesson says. Hoisting that shell into the teaching flow would spend real height on
 * a page that has none to spare -- Urdu is at its 12-page cap -- to print a heading over
 * nothing. Worse, it would read as a coaching corner that simply has nothing to say,
 * which is the "invent a proxy for a dark stage" failure.
 *
 * So the hoist is conditional on there being something to hoist. With no body the corner
 * stays exactly where it has always been, on the Reference sheet, unchanged -- the dark
 * stage stays dark and stays where it was, and the page count cannot move.
 * ------------------------------------------------------------------------ */

const DARK = 'design pending — not carried by primary Stage-C enrichment';

/** The fixture with a corner that is entirely design-pending. */
function darkDoc() {
  const d = doc();
  d.page2 = { ...d.page2, coaching_lookfor: DARK };
  delete d.page2.coaching_reflection;
  return d;
}

describe('a corner with nothing in it is not hoisted', () => {
  test('the sentinel really is pruned, so the premise of this block holds', () => {
    const out = built(darkDoc());
    expect(out.html).not.toContain('design pending');
    // The drop is REPORTED, never silent -- that warning is how anyone learns the corner is
    // dark rather than missing. It is also the exact line the render evidence showed.
    expect((out.warnings || []).join(' ')).toContain('dropped design-pending page2/coaching_lookfor');
  });

  test('no teach page gains a card', () => {
    for (const seg of pagesOf(built(darkDoc()).html, 'teach')) expect(seg).not.toMatch(CARD);
  });

  test('it stays on the Reference sheet, under its own lettered bar', () => {
    const support = pagesOf(built(darkDoc()).html, 'support').join('');
    expect(support).toMatch(CARD);
    expect(support).toContain(LABELS.en.p2Coach);
  });

  test('and it is not named twice -- the flow heading is only for the flow', () => {
    expect(built(darkDoc()).html).not.toMatch(/class="coach[^"]*"><div class="lbl">/);
  });

  test('exactly one corner, as always -- suppressed is not deleted', () => {
    expect(corners(built(darkDoc()).html)).toBe(1);
  });

  test('a corner with only the REFLECTION half still flows -- that half is the lesson\'s', () => {
    const d = darkDoc();
    d.page2.coaching_reflection = 'Did every child get a turn at the board?';
    const teach = pagesOf(built(d).html, 'teach').join('');
    expect(teach).toMatch(CARD);
    expect(teach).toContain('Did every child get a turn at the board?');
  });

  test('Urdu behaves the same way, because the cap is Urdu\'s problem', () => {
    for (const seg of pagesOf(built(darkDoc(), 'ur').html, 'teach')) expect(seg).not.toMatch(CARD);
    expect(pagesOf(built(darkDoc(), 'ur').html, 'support').join('')).toMatch(CARD);
  });
});
