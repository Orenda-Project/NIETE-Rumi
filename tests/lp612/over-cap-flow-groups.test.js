/**
 * bd-9mc3nz.2 — A LESSON OVER THE 4-PAGE TEACH CAP GETS ITS TWO REFERENCE GROUPS BACK.
 *
 * Queue #57, fault 1: 132 G6-12 lessons in 7 days were delivered over the page cap, all of them
 * over in TEACH. bd-a8veu.10 had moved "common mistakes" and "differentiation" out of Reference
 * and into the teaching flow, so both now cost TEACH pages. Re-rendering the stored lessons with
 * the two groups back in Reference brought 72 of the 109 over-by-one lessons within both caps.
 *
 * The operator's choice: move them back ONLY when the lesson would otherwise be over the cap.
 * A lesson that fits keeps them in the flow.
 *
 * THE BROWSER IS MOCKED at the `playwright-core` boundary (the continuous-two-page-pdf.test.js
 * pattern). The mock reports TEACH pages from the HTML it was handed: `mockTeachWithGroups`
 * when the misconception cards print in the teaching part, `mockTeachWithout` when they do not.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { BODY_FLOOR_PX: mockBodyPx, CHIP_FLOOR_PX: mockChipPx } = require(path.join(V, 'render_lp.js'));

let mockTeachWithGroups;
let mockTeachWithout;
let mockSupportWithout;

/** Do the misconception cards print before the support masthead? */
const mockGroupsInFlow = (file) => {
  const html = require('fs').readFileSync(file, 'utf8');
  const body = html.slice(html.lastIndexOf('</style>'));
  const at = body.indexOf('class="p2head');
  return /class="mis\b/.test(at < 0 ? body : body.slice(0, at));
};

jest.mock('playwright-core', () => {
  const stubPage = () => {
    let file = null;
    return {
      goto: jest.fn(async (url) => { file = String(url).replace(/^file:\/\//, '').replace(/\?t=.*$/, ''); }),
      emulateMedia: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn(async (src) => {
        const s = String(src);
        if (s.includes('document.fonts.ready')) return true;
        if (s.includes("classList.add('measuring')")) {
          const atoms = (n) => Array.from({ length: n }, () => ({ h: 900, mt: 0 }));
          return { parts: { teach: atoms(40), support: atoms(40) }, probe: {} };
        }
        if (s.includes('minBodyFontPx')) {
          const inFlow = mockGroupsInFlow(file);
          const teach = inFlow ? mockTeachWithGroups : mockTeachWithout;
          const support = inFlow ? 2 : mockSupportWithout;
          const ids = [...Array(teach)].map((_, i) => `t${i + 1}`).concat([...Array(support)].map((_, i) => `s${i + 1}`));
          return {
            pageCount: teach + support, pagesByPart: { teach, support },
            minBodyFontPx: mockBodyPx, minChipFontPx: mockChipPx,
            pages: ids.map((id) => ({ id, contentBottomPx: 900, footTopPx: 950, overflowPx: 0, overflowingSections: [] })),
          };
        }
        return undefined;
      }),
      pdf: jest.fn(async () => Buffer.from(`%PDF-1.4\n${'/Type /Page \n'.repeat(2)}`)),
      $$: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    };
  };
  return {
    chromium: {
      launch: jest.fn(async () => ({
        newPage: jest.fn(async () => stubPage()),
        close: jest.fn().mockResolvedValue(undefined),
      })),
    },
  };
}, { virtual: true });

const { renderDoc, pageCapsFor } = require(path.join(V, 'render_lp.js'));
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const CAPS = pageCapsFor('en');

let outDir;
beforeEach(() => {
  mockSupportWithout = 3;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-overcap-'));
});
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

const render = () => renderDoc({ doc: FIXTURE, out: outDir, stem: 'g9', lang: 'en', pdf: false, quiet: true });
const pageCount = (out) => out.problems.filter((p) => p.startsWith('PAGE COUNT'));
const groupsInFlowOnDisk = (out) => mockGroupsInFlow(out.htmlPath);

describe('over the TEACH cap: mistakes and differentiation go back to Reference', () => {
  test('the fixture puts both groups in the flow to begin with (bd-a8veu.10)', async () => {
    mockTeachWithGroups = CAPS.max.teach;
    mockTeachWithout = CAPS.max.teach - 1;
    const out = await render();
    expect(groupsInFlowOnDisk(out)).toBe(true);
  });

  test('a lesson that fits keeps the groups in the flow', async () => {
    mockTeachWithGroups = CAPS.max.teach;
    mockTeachWithout = CAPS.max.teach - 1;
    const out = await render();
    expect(out.pagesByPart.teach).toBe(CAPS.max.teach);
    expect(groupsInFlowOnDisk(out)).toBe(true);
    expect(out.flowGroupsMoved).toBe(false);
    expect(out.report.flow_groups_moved).toBe(false);
  });

  test('a lesson over by one page that fits without them is rendered with them in Reference, no PAGE COUNT', async () => {
    mockTeachWithGroups = CAPS.max.teach + 1;
    mockTeachWithout = CAPS.max.teach;
    const out = await render();
    expect(out.pagesByPart).toEqual({ teach: CAPS.max.teach, support: 3 });
    expect(pageCount(out)).toEqual([]);
    expect(groupsInFlowOnDisk(out)).toBe(false);
    expect(out.flowGroupsMoved).toBe(true);
    expect(out.report.flow_groups_moved).toBe(true);
    // moved, never dropped: the cards are still in the file, now on the support page
    const html = fs.readFileSync(out.htmlPath, 'utf8');
    expect(html.slice(html.indexOf('class="p2head'))).toMatch(/class="mis\b/);
  });

  test('still over but by fewer pages: the shorter layout is kept, PAGE COUNT still reported', async () => {
    mockTeachWithGroups = CAPS.max.teach + 2;
    mockTeachWithout = CAPS.max.teach + 1;
    const out = await render();
    expect(out.pagesByPart.teach).toBe(CAPS.max.teach + 1);
    expect(out.flowGroupsMoved).toBe(true);
    expect(pageCount(out)).toHaveLength(1);
  });

  test('no better without them (Reference spills over its own cap): the flow layout is kept and is what is on disk', async () => {
    mockTeachWithGroups = CAPS.max.teach + 1;
    mockTeachWithout = CAPS.max.teach;
    mockSupportWithout = CAPS.max.support + 1;
    const out = await render();
    expect(out.pagesByPart).toEqual({ teach: CAPS.max.teach + 1, support: 2 });
    expect(out.flowGroupsMoved).toBe(false);
    expect(groupsInFlowOnDisk(out)).toBe(true);
  });
});
