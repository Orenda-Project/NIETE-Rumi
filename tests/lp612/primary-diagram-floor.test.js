/**
 * bd-u9vji -- A PRIMARY DIAGRAM IS DRAWN PHONE-FIRST, SO ITS LABELS ARE READABLE ON A PHONE.
 *
 * OPERATOR: *"diagrams get phone-specific fix, labels should be phone-first"*.
 *
 * WHAT WAS ACTUALLY WRONG, and it is not what the bead first guessed. The bead says the fix is
 * to inject `spec.width`. Injecting width ALONE changes nothing, because the figure is already
 * height-clamped: `figureSlot` returns `maxHeightPx = box.minHeightPx` and the renderer rides it
 * out as `--fig-h` on the SVG, so a diagram is never drawn at full column width -- it is scaled
 * DOWN until its smallest label lands exactly on `DIAGRAM_MIN_PX`. Measured on the G4 English
 * Ch.9 Day 6 render: phone figure 1 came out 185px tall from a 640x273.9 viewBox, i.e. 432px
 * wide, i.e. a 12.5-unit label rendered at 12.5 x 432/640 = 8.45px -- dead on the phone floor of
 * 8.43px. The A4 twin landed on 13.5px. The floor IS the lever, and the canvas is the other half
 * of it: raise the floor alone and every primary diagram turns into FIGURE TOO SMALL.
 *
 * THE FIX, in two halves that only work together:
 *   1. A primary-only floor of 15.5px -- `niete-brand.js` TYPE_FLOOR.label, the same number the
 *      chips already honour. A label is type; it gets the type floor.
 *   2. A canvas narrowed to `floor(minFont * PHONE_FULL_COL / 15.5)`, computed from the SVG's
 *      OWN `data-min-font` rather than a hardcoded 12.5, so the shim is type-agnostic.
 *
 * PHONE-FIRST IS THE WHOLE POINT, and it falls out of the arithmetic. Anchoring on the phone
 * column (455px) makes `col/vbW` a constant, so the figure renders at the SAME pixel height in
 * BOTH formats -- A4 shows exactly what the phone will deliver. Anchoring on A4's own 729px
 * column instead would put labels at 24.8px and make the tallest measured diagram want 1400px of
 * height on a 1109px page: an atom never splits, so that is a failed render, not a bigger label.
 *
 * WHY THE SHIM IS A STRICT NO-OP WHEREVER IT CANNOT WIN. A diagram type that ignores
 * `spec.width` returns the same viewBox, so nothing changes and the existing FIGURE TOO SMALL
 * message still fires. A diagram too tall to fit a page at the primary floor keeps its ORIGINAL
 * svg and its ORIGINAL floor -- today's behaviour exactly -- rather than trading a small label
 * for a dead render. Every one of those three outcomes is recorded through `ctx.figureRepair`,
 * because a repair that leaves no trace is a regression mask.
 *
 * Red-first on the base branch: every assertion in groups 2-5 fails there.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');

/**
 * The diagram engine, replaced by a canvas that behaves like the real one in the two ways
 * this suite measures: `data-min-font` is an ABSOLUTE token (SIZE.tiny does not change when
 * the canvas narrows -- that is why narrowing raises the rendered label at all), and a spec
 * carrying `__area` reflows, getting taller as it gets narrower, the way a real panels/flow
 * builder does. Everything else falls through to a fixed-height drawing.
 */
jest.mock('../../bot/vendor/lp-v9/diagrams', () => {
  const calls = [];
  return {
    IS_STUB: false,
    __calls: calls,
    renderDiagram: (spec) => {
      calls.push(JSON.parse(JSON.stringify(spec)));
      const minFont = spec.__minFont || 12.5;
      // A type that does NOT honour `spec.width` -- the shim must detect that by measuring.
      const honours = spec.type !== 'ignores_width';
      const vbW = (honours && spec.width) || spec.__vbW || 640;
      const vbH = spec.__area ? Math.round(spec.__area / vbW) : (spec.__vbH || 273.9);
      return `<svg viewBox="0 0 ${vbW} ${vbH}" data-min-font="${minFont}" width="100%">`
        + `<text font-size="${minFont}">label</text></svg>`;
    },
  };
});

const ENGINE = require('../../bot/vendor/lp-v9/diagrams');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat } = T;
const { requiredBox } = require(path.join(VENDOR, 'diagrams', 'lib', 'svg.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The three measured shapes from the G4 English Ch.9 Day 6 render, as specs. */
const FLOW = { type: 'flow', caption: 'APOSTROPHE ALLEY' };                  // 640 x 273.9
const TALL = { type: 'panels', caption: 'THREE WORKED EXAMPLES',
               __vbW: 664, __area: 664 * 703.55 };                           // 664 x 703.55

/** Seat one diagram as the first block of the first section, full width.
 *
 *  The fixture ALREADY carries a `geometry` diagram of its own, and every assertion below is about
 *  ONE figure -- its width, its floor, the single repair it recorded. So the fixture's diagram is
 *  lifted out here rather than filtered around at each assertion: a test that has to say "the second
 *  figure" is a test that will read the wrong one the day the fixture gains a third.
 */
function withDiagram(doc, spec) {
  for (const s of doc.sections || []) {
    s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  }
  const s = doc.sections[0];
  s.blocks = [{ type: 'diagram', id: 'dia-test', spec }, ...(s.blocks || [])];
  return doc;
}

function primaryDoc(spec) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return withDiagram(d, spec);
}

const buildAll = (doc, opts = {}) =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });
const build = (doc, opts) => buildAll(doc, opts).html;

/** The `--fig-h` the renderer put on the one `<figure class="dg">` in this html. */
/** The document with the BOARD PLAN's figure cut out of it.
 *
 *  Both emission sites print `<figure class="dg">`, and since bd-6s5u7 hoisted the board onto
 *  page 1 (SYNC 3.25) the board's figure is the FIRST one in the document -- so "first match"
 *  silently began reading the wrong figure, and this suite's `ignores_width` test reported 340
 *  for a figure it had just declined to touch. Cut the board out rather than counting past it:
 *  "the second figure" is a helper that reads the wrong one the day a third appears. */
const withoutBoardFigure = (html) => {
  const i = html.indexOf('The board at the end of the lesson');
  if (i < 0) return html;
  const end = html.indexOf('</figure>', i);
  return html.slice(0, i) + (end < 0 ? '' : html.slice(end + '</figure>'.length));
};

const figH = (html) => {
  const m = withoutBoardFigure(html).match(/<figure[^>]*class="[^"]*\bdg\b[^"]*"[^>]*style="([^"]*)"/);
  if (!m) return null;
  const h = m[1].match(/--fig-h:([\d.]+)px/);
  return h ? Number(h[1]) : null;
};
/** The viewBox width the engine's LAST call actually drew on. */
/** The `--fig-h` on the BOARD PLAN's figure, which is a second diagram surface with its own
 *  emission site (`boardPlanAtoms`) rather than the `diagram` block renderer. Anchored on the
 *  label the renderer prints above it, because both figures carry the same `dg` class. */
const boardFigH = (html) => {
  const i = html.indexOf('The board at the end of the lesson');
  if (i < 0) return null;
  const m = html.slice(i).match(/<figure[^>]*class="[^"]*\bdg\b[^"]*"[^>]*style="([^"]*)"/);
  if (!m) return null;
  const h = m[1].match(/--fig-h:([\d.]+)px/);
  return h ? Number(h[1]) : null;
};

const vbOf = (h) => {
  const m = h.match(/<svg viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return m ? { vbW: Number(m[1]), vbH: Number(m[2]) } : null;
};
/** The canvas the BLOCK diagram was drawn on -- the board's is cut out first, same reason. */
const drawnVbW = (html) => vbOf(withoutBoardFigure(html));
/** The canvas the BOARD PLAN's figure was drawn on, anchored on its own label. */
const boardVbW = (html) => {
  const i = html.indexOf('The board at the end of the lesson');
  return i < 0 ? null : vbOf(html.slice(i));
};

const specCalls = (type) => ENGINE.__calls.filter((c) => c.type === type);

/** The repairs for the diagram THIS test injected. The fixture also prints a board plan, which is
 *  a figure in its own right and records its own repair -- see the last describe. Filtering by the
 *  spec type keeps each test talking about one figure, and keeps a test from silently reading the
 *  wrong one the day the fixture grows a third. */
const repairsFor = (out, type) => out.figureRepairs.filter((r) => r.specType === type);

beforeEach(() => { ENGINE.__calls.length = 0; });
afterEach(() => setPageFormat('phone'));

/* --------------------------------------------------------------- 1. the G6-12 control */

describe('a G6-12 plan is untouched by construction', () => {
  test('the engine is called ONCE, with the author spec and no injected width', () => {
    build(withDiagram(baseDoc(), FLOW));
    const calls = specCalls('flow');
    expect(calls).toHaveLength(1);
    expect(calls[0].width).toBeUndefined();
  });

  test('the phone figure still clamps to the 8.43px floor -- 185px, as measured on prod', () => {
    // 8.43 * 640/12.5 = 431.6px wide; 431.6 * 273.9/640 = 184.7 -> 185.
    expect(figH(build(withDiagram(baseDoc(), FLOW)))).toBe(185);
  });

  test('and the A4 twin still clamps to its own 13.5px floor -- 296px', () => {
    expect(figH(build(withDiagram(baseDoc(), FLOW), { format: 'a4' }))).toBe(296);
  });

  test('no repair is recorded for a document the shim never touches', () => {
    expect(buildAll(withDiagram(baseDoc(), FLOW)).figureRepairs).toEqual([]);
  });
});

/* ------------------------------------------------------- 2. the primary floor is the brand's */

describe('the primary floor is the brand label floor, not a new number', () => {
  test('15.5px -- the same TYPE_FLOOR.label the chips already honour', () => {
    expect(T.PRIMARY_DIAGRAM_MIN_PX).toBe(15.5);
    let TYPE_FLOOR;
    try {
      ({ TYPE_FLOOR } = require('../../bot/shared/templates/niete-brand'));
    } catch (_) {
      console.warn('SKIPPED: niete-brand.js is not on this branch, so the join cannot be checked');
      return;
    }
    expect(T.PRIMARY_DIAGRAM_MIN_PX).toBe(TYPE_FLOOR.label);
  });

  test('the canvas is anchored on the PHONE column, 455px', () => {
    // 520 - 21*2 = 478 inner, minus FIG_CHROME 23.
    expect(T.PHONE_FULL_COL).toBe(455);
  });
});

/* ------------------------------------------------------------ 3. the narrowing, phone-first */

describe('a primary diagram is re-drawn on a phone-first canvas', () => {
  test('the engine is called a second time, with the computed width', () => {
    build(primaryDoc(FLOW));
    const calls = specCalls('flow');
    expect(calls).toHaveLength(2);
    expect(calls[0].width).toBeUndefined();          // the author spec goes in untouched
    expect(calls[1].width).toBe(366);                // floor(12.5 * 455 / 15.5)
  });

  test('the width is computed from the SVG own data-min-font, not a hardcoded 12.5', () => {
    build(primaryDoc({ ...FLOW, __minFont: 14.5 }));
    const calls = specCalls('flow');
    expect(calls[1].width).toBe(425);                // floor(14.5 * 455 / 15.5)
  });

  test('the smallest label clears 15.5px in the phone column', () => {
    const html = build(primaryDoc(FLOW));
    const { vbW } = drawnVbW(html);
    const px = requiredBox(html.match(/<svg[^>]*>/)[0] + '</svg>',
      { minPx: 15.5, colPx: T.PHONE_FULL_COL }).renderedPx;
    expect(vbW).toBe(366);
    expect(px).toBeGreaterThanOrEqual(15.5);
  });

  test('the figure is the SAME height on both surfaces -- A4 shows what the phone delivers', () => {
    const phone = figH(build(primaryDoc(FLOW)));
    const a4 = figH(build(primaryDoc(FLOW), { format: 'a4' }));
    expect(phone).toBe(340);                         // ceil(15.5 * 273.9 / 12.5)
    expect(a4).toBe(phone);
  });

  test('the phone figure is 84% taller than it was -- 185px becomes 340px', () => {
    expect(figH(build(primaryDoc(FLOW)))).toBeGreaterThan(figH(build(withDiagram(baseDoc(), FLOW))));
  });

  test('no figure problem is raised on either surface', () => {
    expect(buildAll(primaryDoc(FLOW)).figureProblems).toEqual([]);
    expect(buildAll(primaryDoc(FLOW), { format: 'a4' }).figureProblems).toEqual([]);
  });

  test('the narrowing is RECORDED, floor and canvas both', () => {
    const r = repairsFor(buildAll(primaryDoc(FLOW)), 'flow');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: 'FIGURE_NARROWED', specType: 'flow',
      widthPx: 366, floorPx: 15.5 });
  });
});

/* ------------------------------------------------------------------- 4. where it must not act */

describe('the shim never overrides an author and never widens', () => {
  test("an author's own width is left alone -- one call, their number", () => {
    build(primaryDoc({ ...FLOW, width: 500 }));
    const calls = specCalls('flow');
    expect(calls).toHaveLength(1);
    expect(calls[0].width).toBe(500);
  });

  test('a canvas already narrow enough is not widened to meet the target', () => {
    // 300 units wide at a 12.5 label already renders at 12.5*455/300 = 18.96px.
    build(primaryDoc({ ...FLOW, __vbW: 300 }));
    expect(specCalls('flow')).toHaveLength(1);
  });

  test('a type that ignores spec.width is a no-op, and still reports its own defect', () => {
    // The mock honours `width`; a type that does not returns the same viewBox, which the
    // shim detects by re-measuring rather than by trusting the request.
    const out = buildAll(primaryDoc({ ...FLOW, type: 'ignores_width' }));
    expect(specCalls('ignores_width')).toHaveLength(2);       // it tried exactly once
    expect(figH(out.html)).toBe(185);                          // ...and changed nothing
    expect(repairsFor(out, 'ignores_width')).toEqual([expect.objectContaining({
      code: 'FIGURE_NARROW_DECLINED', reason: 'type-ignores-width' })]);
  });
});

/* ---------------------------------------------------- 5. a figure too tall keeps today's deal */

describe('a diagram too tall to fit a page keeps its original drawing', () => {
  const TALL_DOC = () => primaryDoc(TALL);

  test('the narrowed canvas is backed off until the figure fits an A4 page', () => {
    const html = build(TALL_DOC());
    const h = figH(html);
    expect(h).not.toBeNull();
    expect(h).toBeLessThanOrEqual(T.PRIMARY_FIG_MAX_H);
  });

  test('it is still an improvement, and it says so rather than claiming the full fix', () => {
    const r = repairsFor(buildAll(TALL_DOC()), 'panels');
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe('FIGURE_NARROWED_PARTIAL');
    expect(r[0].targetFloorPx).toBe(15.5);
    expect(r[0].renderedPxAfter).toBeGreaterThan(r[0].renderedPxBefore);
  });

  test('and it never turns a rendering lesson into a failed one', () => {
    expect(buildAll(TALL_DOC()).figureProblems).toEqual([]);
    expect(buildAll(TALL_DOC(), { format: 'a4' }).figureProblems).toEqual([]);
  });
});

// ── the board plan is a diagram too ──────────────────────────────────────────
//
// `page2.board_final.diagram` is drawn by `boardPlanAtoms`, NOT by the `diagram` block renderer,
// so it has its own copy of the sizing rule and would have been left behind at 8.43px by a shim
// that only patched the block. Found by measuring, not by reading: the first pass of this suite
// reported 185px for a figure it had just narrowed to 340, because the regex had picked up the
// second figure on the page. A second emission site is a second place the floor has to hold.
describe('the board plan figure gets the same phone-first canvas', () => {
  const boardDoc = () => {
    const d = baseDoc();
    d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
    for (const s of d.sections || []) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
    return d;
  };

  test('G6-12 keeps the figure it has today', () => {
    const d = baseDoc();
    for (const s of d.sections || []) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
    expect(boardFigH(build(d))).toBe(185);
    expect(buildAll(d).figureRepairs).toEqual([]);
  });

  test('primary redraws it on the narrow canvas, at the same floor as a block diagram', () => {
    const html = build(boardDoc());
    expect(boardFigH(html)).toBe(340);
    expect(boardVbW(html)).toEqual({ vbW: 366, vbH: 273.9 });
  });

  test('and the redraw is recorded against the board spec, not silently', () => {
    const r = buildAll(boardDoc()).figureRepairs.filter((x) => x.specType === 'grid');
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe('FIGURE_NARROWED');
    expect(r[0].floorPx).toBe(15.5);
  });

  test('A4 and phone print the same board figure', () => {
    expect(boardFigH(build(boardDoc(), { format: 'a4' }))).toBe(boardFigH(build(boardDoc())));
  });
});
