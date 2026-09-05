/**
 * A LESSON IS NOT LOST TO NINE PIXELS — bd-c3le6.
 *
 * Three whole lessons were authored, rendered, written to disk and then DISCARDED in the
 * 2026-09-05 batch, after 3-7 minutes and up to five revision rounds each:
 *
 *   d15  grade_6_english.c05.p102-103   OVERFLOW on t6:  3px   last painted element: foot
 *   d10  grade_10_mathematics.c07       OVERFLOW on t6:  9px   last painted element: foot
 *   d03  grade_7_zari_taleem.c01        OVERFLOW on s4: 11px   last painted element: foot
 *
 * `overflowingSections` is EMPTY on all three: no element carrying `data-sec` — no lesson
 * content — is past the page's inner bottom edge. The only thing over the line is the FOOTER,
 * the page chrome that prints "page 6 of 14". Nothing was clipped and nothing was going to be.
 *
 * TWO measured causes, found by rendering the three failing documents rather than by reasoning:
 *
 *  (a) `body.measuring .mats{ margin-top:0 }` (lib/template.js) was written on the belief that
 *      `.mats` carries `margin-top:auto` the way `.foot` does. **It never has** — its only
 *      margin-top is the `sp-4` spacing class, 16px. Zeroing it in the measuring pass makes the
 *      packer charge 16px LESS for the materials strip than the live layout costs, so a page
 *      that ends on `.mats` prints 16px taller than the packer believed. On d10's t6 the
 *      per-element diff is exactly +16 on that one atom and 0 on the other fifteen.
 *
 *  (b) The footer's height is measured ONCE, off the `__probe` page, and charged to every page.
 *      On d03 the real footer is 65px on some pages and 89px on others — the packer's capacity
 *      is 24px too generous on the taller ones. Measuring it per page is circular: the footer's
 *      height depends on which page it is, which is what the packer is deciding.
 *
 * So (a) is fixed at source, and (b) is ABSORBED: a page whose overflow is furniture-sized has
 * that many pixels taken out of the page's own bottom whitespace, deterministically, and the
 * lesson ships. Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now
 * because of the length issue."*
 *
 * WHERE THE 12 COMES FROM. It is not a tolerance picked to cover the failures; it is the amount
 * of pure whitespace that exists between the last content pixel and the paper edge, and it is
 * the same number in both languages:
 *
 *     .pad { padding: 10px 21px 4px }   ->   4px below the footer
 *     .foot{ padding-top: var(--sp-2) } ->   8px above the footer
 *                                        =  12px, reclaimable without moving one pixel of
 *                                           content and without shrinking any type.
 *
 * (`.foot`'s own padding-bottom — 1px LTR, 7px RTL — is deliberately NOT reclaimed: Nastaliq
 * descenders need it.) The largest overflow ever measured in this programme is d03's 11px, so
 * the furniture-derived ceiling also happens to clear every case on record — but if a page ever
 * overflows by 13px, it still fails, because absorbing it would mean eating content.
 *
 * AND CLIPPING STILL FAILS, AT ANY SIZE. If any `[data-sec]` element is past the line —
 * `overflowingSections` non-empty — that is real content being cut off, and no number of pixels
 * makes it absorbable. That guard is what keeps this from being "OVERFLOW is now a warning".
 *
 * Red-first: on this branch's base `absorbPlan` does not exist, the report carries no
 * `overflow_absorbed`, and a 9px furniture overflow throws away the whole document.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let mockProbe;
let mockPdfPages;
let mockAbsorbCalls;

/** The probe shape render_lp reads, with one page over by `px`. */
function makeProbe(over = {}) {
  const page = (id, extra = {}) => ({
    id,
    contentHeight: 900,
    boxHeight: 1000,
    lastPaintedPx: 1000,
    contentBottomPx: 900,
    footTopPx: 950,
    innerBottomPx: 1000,
    lastElement: 'foot',
    overflowPx: 0,
    overflowingSections: [],
    ...extra,
  });
  return {
    pageCount: 2,
    pagesByPart: { teach: 1, support: 1 },
    minBodyFontPx: 18,
    minBodySample: '.pad p :: body',
    minAnyFontPx: 18,
    minChipFontPx: 14,
    minChipSample: '.kw :: chip',
    pages: [page('teach-1'), page('support-1')],
    ...over,
  };
}

jest.mock('playwright-core', () => {
  const stubPage = () => ({
    goto: jest.fn().mockResolvedValue(null),
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (src) => {
      const s = String(src);
      if (s.includes('document.fonts.ready')) return true;
      if (s.includes("classList.add('measuring')")) return { parts: { teach: [], support: [] }, probe: {} };
      if (s.includes('minBodyFontPx')) return mockProbe;
      // The absorber runs BETWEEN the two probes. `unabsorbed` is unique to it — `paddingBottom`
      // is NOT: the probe reads the same property to find the page's inner bottom edge.
      if (s.includes('unabsorbed')) {
        const plan = JSON.parse(s.slice(s.lastIndexOf('(['), s.lastIndexOf(')')).slice(1));
        mockAbsorbCalls.push(plan);
        // A real absorb removes the overflow it was asked to remove, so the RE-PROBE that
        // follows must see zero — otherwise this stub would pass a broken absorber.
        mockProbe = {
          ...mockProbe,
          pages: mockProbe.pages.map((p) => (plan.some((x) => x.id === p.id)
            ? { ...p, overflowPx: 0 } : p)),
        };
        return plan.map((x) => ({
          id: x.id, px: x.px, padPx: Math.min(x.px, 4), footPx: Math.max(0, x.px - 4), unabsorbed: 0,
        }));
      }
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

const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../bot/shared/utils/structured-logger'),
  logEvent: (...a) => mockLogEvent(...a),
}));

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { absorbPlan, OVERFLOW_ABSORB_MAX_PX } = require(path.join(V, 'render_lp.js'));
const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');
let outDir;

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe = makeProbe();
  mockPdfPages = 2;
  mockAbsorbCalls = [];
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-absorb-'));
});
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

const overflowing = (px, extra = {}) => makeProbe({
  pages: [
    { ...makeProbe().pages[0] },
    { ...makeProbe().pages[1], id: 't6', overflowPx: px, lastElement: 'foot', overflowingSections: [], ...extra },
  ],
});

// ── the plan: pure, and it is where the policy lives ────────────────────────

describe('absorbPlan — which overflows are furniture and which are clipping', () => {
  it('is capped at the reclaimable page-bottom furniture: .pad 4px + .foot 8px', () => {
    expect(OVERFLOW_ABSORB_MAX_PX).toBe(12);
  });

  it.each([3, 9, 11, 12])('absorbs the %ipx furniture overflows this programme actually measured', (px) => {
    expect(absorbPlan(overflowing(px).pages)).toEqual([{ id: 't6', px }]);
  });

  it('refuses 13px and above — past that, absorbing would eat content', () => {
    expect(absorbPlan(overflowing(13).pages)).toEqual([]);
    expect(absorbPlan(overflowing(40).pages)).toEqual([]);
    expect(absorbPlan(overflowing(300).pages)).toEqual([]);
  });

  it('refuses ANY size when a data-sec element is past the line — that is clipping, not slack', () => {
    const clipped = overflowing(3, { overflowingSections: [{ sec: 'development', overBy: 3 }] });
    expect(absorbPlan(clipped.pages)).toEqual([]);
  });

  it('leaves clean pages alone, and ignores the 1px the renderer already tolerates', () => {
    expect(absorbPlan(makeProbe().pages)).toEqual([]);
    expect(absorbPlan(overflowing(1).pages)).toEqual([]);
  });

  it('plans every offending page independently', () => {
    const p = makeProbe({
      pages: [
        { ...makeProbe().pages[0], id: 't2', overflowPx: 4 },
        { ...makeProbe().pages[1], id: 't6', overflowPx: 9 },
      ],
    });
    expect(absorbPlan(p.pages)).toEqual([{ id: 't2', px: 4 }, { id: 't6', px: 9 }]);
  });

  it('survives a probe with no pages at all', () => {
    expect(absorbPlan([])).toEqual([]);
    expect(absorbPlan(undefined)).toEqual([]);
  });
});

// ── the wiring: the changed line runs, and the lesson survives ──────────────

describe('a furniture-sized overflow no longer discards the lesson', () => {
  it("d10's exact 9px on t6 renders instead of throwing", async () => {
    mockProbe = overflowing(9);
    const out = await renderLessonPlan({
      lpDoc: CLEAN_DOC, lang: 'en', stem: 'd10', outDir, correlationId: 'c1',
    });
    expect(out.pdfPath).toBeTruthy();
    expect(mockAbsorbCalls).toEqual([[{ id: 't6', px: 9 }]]);
  });

  it('reports WHAT it absorbed, so the row and Axiom can both see it', async () => {
    mockProbe = overflowing(11);
    const out = await renderLessonPlan({
      lpDoc: CLEAN_DOC, lang: 'ur', stem: 'd03', outDir, correlationId: 'c2',
    });
    expect(out.overflowAbsorbed).toEqual([
      expect.objectContaining({ id: 't6', px: 11 }),
    ]);
  });

  it('emits lp612.render.overflow_absorbed — a silent fallback is a regression mask', async () => {
    mockProbe = overflowing(9);
    await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'd10', outDir, correlationId: 'c3' });
    const call = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.render.overflow_absorbed');
    expect(call).toBeTruthy();
    expect(call[1]).toEqual(expect.objectContaining({ correlationId: 'c3', maxPx: 12 }));
    expect(call[1].pages).toEqual([expect.objectContaining({ id: 't6', px: 9 })]);
  });

  it('says nothing and changes nothing on a clean render', async () => {
    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'ok', outDir, correlationId: 'c4' });
    expect(mockAbsorbCalls).toEqual([]);
    expect(out.overflowAbsorbed).toEqual([]);
    expect(mockLogEvent.mock.calls.some((c) => c[0] === 'lp612.render.overflow_absorbed')).toBe(false);
  });

  it('a 40px overflow still throws — the gate is narrowed, not removed', async () => {
    mockProbe = overflowing(40);
    await expect(renderLessonPlan({
      lpDoc: CLEAN_DOC, lang: 'en', stem: 'big', outDir, correlationId: 'c5',
    })).rejects.toThrow(/OVERFLOW on t6: content is 40px/);
    expect(mockAbsorbCalls).toEqual([]);
  });

  it('a 3px overflow that CLIPS a section still throws', async () => {
    mockProbe = overflowing(3, { overflowingSections: [{ sec: 'activity', overBy: 3 }] });
    await expect(renderLessonPlan({
      lpDoc: CLEAN_DOC, lang: 'en', stem: 'clip', outDir, correlationId: 'c6',
    })).rejects.toThrow(/OVERFLOW on t6/);
  });
});

// ── the measurement bug that caused most of it ──────────────────────────────

describe('the measuring pass no longer zeroes a margin that is not auto', () => {
  const css = fs.readFileSync(path.join(V, 'lib', 'template.js'), 'utf8')
    // Strip comments first: good code names its own subject in the comment above it, and a
    // source assertion that lands on the comment tests nothing (language-protocol §7.1).
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('.foot is still released — it really does carry margin-top:auto', () => {
    expect(css).toMatch(/body\.measuring[^{]*\.foot\s*{\s*margin-top:\s*0/);
    expect(css).toMatch(/\.foot\s*{\s*margin-top:\s*auto/);
  });

  it('.mats is NOT released — it has no auto margin to release, only its sp-4 spacing', () => {
    expect(css).not.toMatch(/body\.measuring[^{]*\.mats/);
    expect(css).not.toMatch(/\.mats\s*{[^}]*margin-top:\s*auto/);
  });
});

// ── the packer may SPEND that furniture, but only to save a page ────────────
//
// Fixing the `.mats` measurement bug on its own produced a worse artefact than the bug did.
// d10's teach part went 6 pages -> 7, and page 7 carried the 52px Materials/Pacing strip and
// nothing else: a teacher prints seven pages of paper and one of them is blank. That is the
// operator's own complaint back again ("there's way too much open space", 2026-08-30), and it
// happened because the packer was 11px short of fitting the strip — while 12px of reclaimable
// furniture sat unused at the bottom of that very page.
//
// So the two halves compose. The PACKER may overfill a page by up to the same
// `OVERFLOW_ABSORB_MAX_PX`, and the in-page absorber then makes those pixels real. The
// allowance is ranked BELOW pages and orphans and ABOVE front-loading, which is what keeps it
// from re-paginating the corpus: at an equal page count the packer prefers the packing that
// spends no slack, so a part that already fitted is packed exactly as before. It can only ever
// be used to remove a page.
//
// `slack` defaults to 0 so the packer's own 300-seed regression corpus still describes the
// exact packer; the renderer passes the real number.

const { packAtoms } = require(path.join(V, 'render_lp.js'));

describe('packAtoms may overfill by the absorbable furniture, and only to save a page', () => {
  const A = (h, o = {}) => ({ h, mt: o.mt || 0, glue: !!o.glue, sec: o.sec || null, first: !!o.first });
  const pageCount = (r) => r.breaks.length + 1;

  it('without slack, an atom 11px too big for the page starts a new one', () => {
    const atoms = [A(500), A(500), A(70)];        // 1070 against a 1059 box
    expect(pageCount(packAtoms(atoms, 1059, {}))).toBe(2);
  });

  it('with the slack, the same part fits on one page — the blank page is gone', () => {
    const atoms = [A(500), A(500), A(70)];
    expect(pageCount(packAtoms(atoms, 1059, {}, { slack: OVERFLOW_ABSORB_MAX_PX }))).toBe(1);
  });

  it('the allowance stops exactly at the furniture — 13px over still breaks', () => {
    const atoms = [A(500), A(500), A(72)];        // 1072 against 1059 + 12
    expect(pageCount(packAtoms(atoms, 1059, {}, { slack: OVERFLOW_ABSORB_MAX_PX }))).toBe(2);
  });

  it('a part that already fits is packed IDENTICALLY — slack never buys a fuller page', () => {
    const atoms = [A(600), A(400), A(600), A(400)];
    const plain = packAtoms(atoms, 1059, {});
    const slacky = packAtoms(atoms, 1059, {}, { slack: OVERFLOW_ABSORB_MAX_PX });
    expect(slacky.breaks).toEqual(plain.breaks);
  });

  it('never spends slack when the page count is unchanged either way', () => {
    // Overfilling page 1 to 1065 IS legal here (1059 + 12) — and pointless: the tail fits on
    // one page either way, so both packings are 2 pages. `over` breaks that tie in favour of
    // paying nothing, which is the whole guarantee that the corpus is not re-paginated.
    const atoms = [A(500), A(565), A(400)];
    const r = packAtoms(atoms, 1059, {}, { slack: OVERFLOW_ABSORB_MAX_PX });
    expect(r.breaks).toEqual(packAtoms(atoms, 1059, {}).breaks);
    expect(r.breaks.length + 1).toBe(2);
  });

  it('slack defaults to zero, so the exact packer is unchanged for every existing caller', () => {
    const atoms = [A(500), A(500), A(70)];
    expect(packAtoms(atoms, 1059, {}).breaks).toEqual(packAtoms(atoms, 1059, {}, {}).breaks);
  });
});
