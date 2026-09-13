/**
 * bd-a8veu.1 — THE PAGE COUNT DEFECT HAS TO SAY HOW MUCH, AND FROM WHERE.
 *
 * Operator, 2026-09-11, first line of the PDF design review: *"its 10 pages long"*.
 *
 * The renderer already refuses an over-cap part. What it says when it refuses is this:
 *
 *     PAGE COUNT: teach needs 5 pages; the cap is 4. Cut it, or move content to the other part.
 *
 * That sentence is the only thing the author model is told about length, and it is stated in a
 * unit the author cannot measure. It has no pixels, no block counts, and no section — so the
 * model is left to guess both HOW MUCH to remove and WHERE from, on a document whose page count
 * it cannot compute. `lp612-author.service.js` already carries the other half of the advice in
 * its revision prompt ("pages are spent on CARD COUNT … REMOVE WHOLE ITEMS"), and the comment
 * directly above it names exactly this gap: *"'Make it shorter' and 'support needs 6 pages; the
 * cap is 4' are different instructions, and only the second one tells the model how much to cut
 * and from WHICH part of the document."* Part is teach-or-support. Section is where the content
 * actually is.
 *
 * Everything needed to say it is already measured and already in scope at the report site — the
 * packer ran on real atom heights, and every atom carries the section it belongs to. It was
 * simply being thrown away: `repaginate.packed` was written at the pack site and read by nobody.
 *
 * WHAT THIS SUITE DOES NOT CLAIM. It does not claim the LP gets shorter. `budgetCard()`'s own
 * comment records that the one previous brief-side volume experiment on this pipeline *"measured
 * no reduction at all"*, and FINDING.md's sweep found no usable card-count ceiling anywhere in
 * the corpus. This is a defect message that stops lying about what it knows; the size of the
 * effect on real lessons is a separate, measured question.
 *
 * THE BROWSER IS MOCKED at the `playwright-core` boundary, the same pattern render.test.js uses,
 * and for the same honest reason: nothing here proves a pixel. The REAL packer runs on the REAL
 * fixture's atom metadata, and the expectations are re-derived from `packAtoms` — never from the
 * helper under test — so a bug in the helper cannot agree with itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

// The measure pass (pass 1) and the in-page probe (pass 2), both under the test's control.
let mockMeasured = null;
let mockProbe = null;
let mockPdfPages = 2;

jest.mock('playwright-core', () => {
  const stubPage = () => ({
    goto: jest.fn().mockResolvedValue(null),
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (src) => {
      const s = String(src);
      if (s.includes('document.fonts.ready')) return true;
      if (s.includes("classList.add('measuring')")) return mockMeasured;
      if (s.includes('minBodyFontPx')) return mockProbe;
      return undefined;
    }),
    pdf: jest.fn(async () => Buffer.from(`%PDF-1.4\n${'/Type /Page \n'.repeat(mockPdfPages)}`)),
    $$: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  });
  return {
    chromium: {
      launch: jest.fn(async () => ({
        newPage: jest.fn(async () => stubPage()),
        close: jest.fn().mockResolvedValue(undefined),
      })),
    },
  };
}, { virtual: true });

const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');
const R = require('../../bot/vendor/lp-v9/render_lp.js');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const CLEAN_DOC = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// ── the layout this suite renders, built from the real document ──────────────────────────────
//
// The measure stub reports a footer and a continuation strip of ZERO so the packer's box is
// exactly `pageContentHeight` and the arithmetic below has nothing hidden in it. Every teach
// atom is given the same height; the point of the fixture here is its SECTION SHAPE (which
// atoms belong to `introduction`, `development`, `activity`, …) and its glue, both of which are
// the real thing.
const BUILT = buildHtml(CLEAN_DOC, { lang: 'en', docDir: path.dirname(FIXTURE), probeCont: true });
const CAPACITY = BUILT.pageContentHeight;
const ATOM_H = 240;

const teachAtoms = BUILT.atoms.teach.map((meta) => Object.assign({ h: ATOM_H, mt: 0 }, meta));
const supportAtoms = [Object.assign({ h: 100, mt: 0 }, BUILT.atoms.support[0])];

const PACKED = R.packAtoms(teachAtoms, CAPACITY, { strip: 0, contBar: {} }, { slack: R.OVERFLOW_ABSORB_MAX_PX });
const TEACH_PAGES = PACKED.pages.length;
const CAP = R.MAX_PAGES.teach;

/** The packer's own cost model, restated here so the expectations do not borrow the new code. */
const costOf = (j) => teachAtoms[j].h + (j === 0 ? 0 : teachAtoms[j].mt || 0);

/**
 * A BLOCK is an atom the AUTHOR could delete. A section bar (`first`) is furniture the author
 * never writes as an item, so it is not one — but its height still counts, because emptying a
 * section takes its bar with it. The same rule holds for the overflow and for each section, so
 * the two numbers in the message are commensurable.
 */
const deletable = (a) => !a.first;

/** The atoms that sit on the pages past the cap — the content that has to come out. */
const FIRST_OVER = PACKED.pages[CAP] ? PACKED.pages[CAP].start : teachAtoms.length;
const OVER = (() => {
  let px = 0;
  let blocks = 0;
  for (let j = FIRST_OVER; j < teachAtoms.length; j++) {
    px += costOf(j);
    if (deletable(teachAtoms[j])) blocks += 1;
  }
  return { px, blocks };
})();
const TOTAL_BLOCKS = teachAtoms.filter(deletable).length;

/** teach by section, tallest first — the list the author is told to cut from. */
const BY_SEC = (() => {
  const m = new Map();
  teachAtoms.forEach((a, j) => {
    if (!a.sec) return;
    const e = m.get(a.sec) || { sec: a.sec, blocks: 0, px: 0 };
    if (deletable(a)) e.blocks += 1;
    e.px += costOf(j);
    m.set(a.sec, e);
  });
  return [...m.values()].sort((a, b) => b.px - a.px);
})();

const makeProbe = () => ({
  pageCount: TEACH_PAGES + 1,
  pagesByPart: { teach: TEACH_PAGES, support: 1 },
  minBodyFontPx: R.BODY_FLOOR_PX,
  minBodySample: '.pad p :: body',
  minAnyFontPx: R.BODY_FLOOR_PX,
  minChipFontPx: R.CHIP_FLOOR_PX,
  minChipSample: '.kw :: chip',
  pages: Array.from({ length: TEACH_PAGES + 1 }, (_, i) => ({
    id: `p-${i + 1}`,
    contentHeight: 900,
    boxHeight: 1000,
    lastPaintedPx: 950,
    contentBottomPx: 900,
    footTopPx: 1000,
    innerBottomPx: 1000,
    lastElement: 'sec',
    overflowPx: 0,
    overflowingSections: [],
  })),
});

let outDir;
beforeEach(() => {
  jest.clearAllMocks();
  mockMeasured = { parts: { teach: teachAtoms.map((a) => ({ h: a.h, mt: a.mt })), support: supportAtoms.map((a) => ({ h: a.h, mt: a.mt })) }, probe: {} };
  mockProbe = makeProbe();
  mockPdfPages = TEACH_PAGES + 1;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-advice-'));
});
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

const pageCountProblem = async () => {
  const err = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir }).catch((e) => e);
  expect(Array.isArray(err.problems)).toBe(true);
  const msg = err.problems.find((p) => /^PAGE COUNT: teach/.test(p));
  expect(typeof msg).toBe('string');
  return msg;
};

describe('the setup is a fair test of an over-cap teach part', () => {
  test('the real packer really does run teach past its hard cap', () => {
    expect(TEACH_PAGES).toBeGreaterThan(CAP);
    expect(OVER.blocks).toBeGreaterThan(0);
    expect(OVER.px).toBeGreaterThan(0);
    expect(TOTAL_BLOCKS).toBeGreaterThan(OVER.blocks);
  });

  test('and the fixture really does carry several named teach sections', () => {
    expect(BY_SEC.length).toBeGreaterThan(2);
    expect(BY_SEC.map((s) => s.sec)).toContain('development');
  });
});

describe('PAGE COUNT says how much has to come out', () => {
  test('it still names the part, the count and the cap', async () => {
    const msg = await pageCountProblem();
    expect(msg).toContain(`teach needs ${TEACH_PAGES} pages`);
    expect(msg).toContain(`the cap is ${CAP}`);
  });

  test('it states the OVERFLOW IN PIXELS — the size of the cut, not just that one is needed', async () => {
    const msg = await pageCountProblem();
    expect(msg).toContain(`${OVER.px}px`);
  });

  test('it states the overflow in BLOCKS, the unit the author can actually delete', async () => {
    const msg = await pageCountProblem();
    expect(msg).toMatch(new RegExp(`\\b${OVER.blocks}\\b[^.]*block`));
  });

  test('and it gives the overflow a denominator — how much of the part that is', async () => {
    const msg = await pageCountProblem();
    expect(msg).toContain(`${TOTAL_BLOCKS}`);
  });

  test('and it says outright that trimming prose inside a block removes no page', async () => {
    const msg = await pageCountProblem();
    expect(msg).toMatch(/shorten\w*[^.]*removes no page/i);
  });
});

describe('PAGE COUNT says WHERE it has to come from', () => {
  test('it names the tallest teach section', async () => {
    const msg = await pageCountProblem();
    expect(msg).toContain(BY_SEC[0].sec);
  });

  test('it carries that section\'s own block count and height', async () => {
    const msg = await pageCountProblem();
    expect(msg).toContain(`${BY_SEC[0].blocks} blocks/${BY_SEC[0].px}px`);
  });

  test('the sections are listed tallest first, so the cheapest cut is named first', async () => {
    const msg = await pageCountProblem();
    const listed = BY_SEC.filter((s) => msg.includes(`${s.sec} `)).map((s) => msg.indexOf(`${s.sec} `));
    expect(listed.length).toBeGreaterThan(1);
    expect(listed).toEqual([...listed].sort((a, b) => a - b));
  });

  test('the page-1 masthead is NOT offered as a section to cut', async () => {
    // The hero, the sequence strip, the outcome box and the resources card carry no `sec`.
    // They are the teacher's at-a-glance card (bd-a8veu.6) and are not the author's to delete,
    // so they must not appear in a list headed "cut from the tallest of these".
    const msg = await pageCountProblem();
    expect(msg).not.toMatch(/\bnull\b|\bundefined\b/);
  });
});

describe('the advice is dropped, not guessed, when the packer has no numbers to give', () => {
  test('a render whose probe disagrees with the packed layout falls back to the plain message', async () => {
    // The Chrome-CLI fallback has no measure pass at all, and a probe that counts different
    // pages from the packer means something else is already wrong. Either way the renderer must
    // not print arithmetic it cannot stand behind.
    mockProbe = Object.assign(makeProbe(), { pagesByPart: { teach: TEACH_PAGES + 1, support: 1 } });
    mockPdfPages = TEACH_PAGES + 2;
    const msg = await pageCountProblem();
    expect(msg).toContain(`teach needs ${TEACH_PAGES + 1} pages`);
    expect(msg).not.toMatch(/px/);
  });
});

describe('every indexed section can be named in a defect message', () => {
  test('buildHtml hands back the title of every section it indexes', () => {
    expect(BUILT.secTitles).toBeTruthy();
    const secs = new Set([...BUILT.atoms.teach, ...BUILT.atoms.support].map((a) => a.sec).filter(Boolean));
    expect(secs.size).toBeGreaterThan(5);
    for (const s of secs) expect(typeof BUILT.secTitles[s]).toBe('string');
  });
});
