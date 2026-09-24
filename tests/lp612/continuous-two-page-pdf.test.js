/**
 * bd-f01ob (v6) — THE FILE IS TWO PAGES: one for teaching, one for teacher support.
 *
 * Operator, 2026-09-24: *"keep it 2 pages, 1 page teaching, next page teacher suppport, dont mix
 * it up"* — then *"approved"* on the v6 mockup, whose PDF is exactly that: page 1 a single tall
 * phone-width page holding the whole lesson, page 2 the support. Before this, the renderer
 * printed each part across fixed phone-sized pages, so the same Grade 9 fixture came out at 6
 * (en) and 8 (ur), and a biology chapter at 8 — *"but the biology chapter is still 8 pages
 * long"*.
 *
 * WHAT DOES NOT CHANGE. Pass 1 still packs each part into phone pages, and THAT count is still
 * the length gate: `PAGE COUNT` / `PAGE TARGET` and the author ladder's revision rounds read it,
 * unchanged. Only the printed file is joined — each part rebuilt with no breaks (one footer, no
 * "…continued" strips) and printed on a named @page sized to its measured height.
 *
 * THE BROWSER IS MOCKED at the `playwright-core` boundary, the pattern overflow-absorb.test.js
 * uses. The real-Chromium check is the CLI render recorded on the bead.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { BODY_FLOOR_PX: mockBodyPx, CHIP_FLOOR_PX: mockChipPx } = require(path.join(V, "render_lp.js"));

let mockPdfCalls;
let mockSizes;
let mockSources;

jest.mock('playwright-core', () => {
  const stubPage = () => ({
    goto: jest.fn().mockResolvedValue(null),
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (src) => {
      const s = String(src);
      mockSources.push(s);
      if (s.includes('document.fonts.ready')) return true;
      // Pass 1: twelve atoms per part, each half a page tall — the packer MUST break them.
      if (s.includes("classList.add('measuring')")) {
        const atoms = (n) => Array.from({ length: n }, () => ({ h: 900, mt: 0 }));
        return { parts: { teach: atoms(40), support: atoms(40) }, probe: {} };
      }
      if (s.includes('minBodyFontPx')) {
        const pg = (id) => ({ id, contentBottomPx: 900, footTopPx: 950, overflowPx: 0, overflowingSections: [] });
        return {
          pageCount: 6, pagesByPart: { teach: 4, support: 2 },
          minBodyFontPx: mockBodyPx, minChipFontPx: mockChipPx,
          pages: ['t1', 't2', 't3', 't4', 's1', 's2'].map(pg),
        };
      }
      if (s.includes('lp612-continuous')) return mockSizes;
      return undefined;
    }),
    pdf: jest.fn(async (opts) => {
      mockPdfCalls.push(opts);
      return Buffer.from(`%PDF-1.4\n${'/Type /Page \n'.repeat(2)}`);
    }),
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

const { renderDoc } = require(path.join(V, 'render_lp.js'));
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

let outDir;
beforeEach(() => {
  mockPdfCalls = [];
  mockSources = [];
  mockSizes = [{ part: 'teach', h: 5200 }, { part: 'support', h: 1900 }];
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-continuous-'));
});
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

const render = () => renderDoc({ doc: FIXTURE, out: outDir, stem: 'g9', lang: 'en', pdf: true, quiet: true });

describe('the printed file is two pages — teaching, then support', () => {
  test('the HTML that is printed holds exactly one page per part, one footer each, no continuation strip', async () => {
    const out = await render();
    const html = fs.readFileSync(out.htmlPath, 'utf8');
    const body = html.slice(html.lastIndexOf('</style>'));
    expect(body.match(/<div class="page"/g)).toHaveLength(2);
    expect(body).toMatch(/<div class="page" id="t1" data-part="teach">/);
    expect(body).toMatch(/<div class="page" id="s1" data-part="support">/);
    expect(body.match(/<div class="foot">/g)).toHaveLength(2);
    expect(body).not.toContain('class="contstrip"');
  });

  test('each part prints on its own page, sized to its content — the CSS page size is honoured', async () => {
    await render();
    const last = mockPdfCalls[mockPdfCalls.length - 1];
    expect(last.preferCSSPageSize).toBe(true);
    const js = mockSources.find((s) => s.includes('lp612-continuous'));
    expect(js).toBeDefined();
  });

  test('a 2-page file is not reported as a truncated 6-page layout', async () => {
    const out = await render();
    expect(out.pdfPages).toBe(2);
    expect(out.problems.filter((p) => /TRUNCATION|the PDF has/.test(p))).toEqual([]);
  });

  test('the length gate still reads the phone-page count: teach 4 is still over the target of 3', async () => {
    const out = await render();
    expect(out.pagesByPart).toEqual({ teach: 4, support: 2 });
    expect(out.warnings.some((w) => w.startsWith('PAGE TARGET: teach runs to 4 pages'))).toBe(true);
  });

  test('if the joined page cannot be measured, the file falls back to the phone pages, never a blank size', async () => {
    mockSizes = undefined;
    const out = await render();
    const last = mockPdfCalls[mockPdfCalls.length - 1];
    expect(last.preferCSSPageSize).toBeFalsy();
    // the phone-paged layout is restored, so the file on disk is the one the probe measured
    const body = fs.readFileSync(out.htmlPath, 'utf8');
    expect(body.slice(body.lastIndexOf('</style>')).match(/<div class="page"/g).length).toBeGreaterThan(2);
  });
});
