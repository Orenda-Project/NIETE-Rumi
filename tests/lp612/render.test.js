/**
 * lp612-render.service — lp_doc -> self-contained HTML -> A4 PDF.
 *
 * The renderer is the vendored `bot/vendor/lp-v9/render_lp.js`, driven through its programmatic
 * `renderDoc()` entry (a vendor divergence — see SYNC.md §3.3). This service's own job is
 * narrow and that is what is tested here: put the document somewhere the renderer can read it,
 * hand back the two artefact paths and the page count, and turn the renderer's `problems` list
 * into ONE named failure.
 *
 * WHY `problems` MUST BE A FAILURE AND NOT A WARNING: every entry in it is a defect a teacher
 * would meet on paper — content clipped off the bottom of a page, body type under the phone
 * floor, a part over the page cap, or a PDF with fewer pages than the layout built. The last of
 * those is the expensive one: the teacher's plan simply ends, and nothing upstream can see it.
 *
 * THE BROWSER IS MOCKED, and mocked at the boundary — `playwright-core`, virtually, the same
 * pattern tests/reports/html-to-pdf.test.js uses. Nothing here launches Chromium, downloads a
 * browser, or asserts anything about pixels. What that means honestly: these tests prove the
 * SERVICE's contract and its error mapping. They do NOT prove the renderer lays out a real
 * lesson correctly, and they cannot prove it runs on a Railway container.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// One measured page per part, nothing overflowing, type at the floors. Individual tests
// override this to drive the renderer's own gates.
let mockProbe = null;
let mockPdfPages = 2;
const mockLaunchCalls = [];

function makeProbe(over) {
  const page = (id, extra = {}) => ({
    id,
    contentHeight: 900,
    boxHeight: 1000,
    lastPaintedPx: 950,
    contentBottomPx: 900,
    footTopPx: 1000,
    innerBottomPx: 1000,
    lastElement: 'sec',
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
      // pass 1 — the measure pass. No atoms: the packer then produces no breaks, which is a
      // legitimate single-page-per-part layout and keeps this stub out of the packer's business.
      if (s.includes("classList.add('measuring')")) return { parts: { teach: [], support: [] }, probe: {} };
      // pass 2 — the in-page probe, which is what every renderer gate reads.
      if (s.includes('minBodyFontPx')) return mockProbe;
      return undefined;
    }),
    // `/Type /Page` occurrences are how render_lp counts the real file. Match the layout so
    // the TRUNCATION gate stays quiet unless a test deliberately provokes it.
    pdf: jest.fn(async () => Buffer.from(`%PDF-1.4\n${'/Type /Page \n'.repeat(mockPdfPages)}`)),
    $$: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  });
  return {
    chromium: {
      launch: jest.fn(async (opts) => {
        mockLaunchCalls.push(opts);
        return {
          newPage: jest.fn(async () => stubPage()),
          close: jest.fn().mockResolvedValue(undefined),
        };
      }),
    },
  };
}, { virtual: true });

const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');
const { chromeChannel, MAX_PAGES, WARN_PAGES } = require('../../bot/vendor/lp-v9/render_lp.js');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

let outDir;

beforeEach(() => {
  jest.clearAllMocks();
  mockLaunchCalls.length = 0;
  mockProbe = makeProbe();
  mockPdfPages = 2;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-render-'));
  delete process.env.LP612_CHROME_CHANNEL;
});

afterEach(() => {
  delete process.env.LP612_CHROME_CHANNEL;
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('renderLessonPlan — the happy path', () => {
  it('returns the two artefact paths, the page count and an empty warning list', async () => {
    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'g9-bio-01', outDir });

    expect(out.htmlPath).toBe(path.join(outDir, 'g9-bio-01.html'));
    expect(out.pdfPath).toBe(path.join(outDir, 'g9-bio-01.pdf'));
    expect(out.pageCount).toBe(2);
    expect(out.warnings).toEqual([]);
  });

  it('actually writes both artefacts', async () => {
    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'g9-bio-01', outDir });
    expect(fs.existsSync(out.htmlPath)).toBe(true);
    expect(fs.existsSync(out.pdfPath)).toBe(true);
    expect(fs.readFileSync(out.htmlPath, 'utf8')).toContain('<html');
  });

  it('creates the output directory when it does not exist', async () => {
    const nested = path.join(outDir, 'a', 'b');
    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir: nested });
    expect(fs.existsSync(out.pdfPath)).toBe(true);
  });

  it('takes the lp_doc as an OBJECT — the caller never has to have written a file', async () => {
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    doc.lesson_id = 'IN_MEMORY_ONLY';
    const out = await renderLessonPlan({ lpDoc: doc, lang: 'en', stem: 'mem', outDir });
    expect(out.pageCount).toBe(2);
  });

  it('embeds the vendored fonts rather than depending on a fonts directory at run time', async () => {
    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'g9', outDir });
    const html = fs.readFileSync(out.htmlPath, 'utf8');
    expect(html).toContain('@font-face');
    expect(html).toContain('base64');
  });
});

describe('renderLessonPlan — failures are ONE named error', () => {
  it('throws RENDER_FAILED when content is clipped off a page', async () => {
    mockProbe = makeProbe({
      pages: [
        { id: 'teach-1', contentBottomPx: 1100, footTopPx: 1000, overflowPx: 42, overflowingSections: [{ sec: 'activity', overBy: 42 }], lastElement: 'div', contentHeight: 1, boxHeight: 1, lastPaintedPx: 1, innerBottomPx: 1 },
        { id: 'support-1', contentBottomPx: 900, footTopPx: 1000, overflowPx: 0, overflowingSections: [], lastElement: 'div', contentHeight: 1, boxHeight: 1, lastPaintedPx: 1, innerBottomPx: 1 },
      ],
    });

    const err = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir }).catch((e) => e);
    expect(err.code).toBe('RENDER_FAILED');
    expect(err.message).toMatch(/OVERFLOW/);
    expect(err.problems.some((p) => p.includes('activity'))).toBe(true);
  });

  it('throws RENDER_FAILED when body type falls under the phone floor', async () => {
    mockProbe = makeProbe({ minBodyFontPx: 12.5 });
    const err = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir }).catch((e) => e);
    expect(err.code).toBe('RENDER_FAILED');
    expect(err.message).toMatch(/TYPE FLOOR/);
  });

  it('throws RENDER_FAILED when a part runs past its hard page cap', async () => {
    const overCap = MAX_PAGES.teach + 1;
    mockPdfPages = overCap + 1;
    mockProbe = makeProbe({ pagesByPart: { teach: overCap, support: 1 } });
    const err = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir }).catch((e) => e);
    expect(err.code).toBe('RENDER_FAILED');
    expect(err.message).toMatch(/PAGE COUNT/);
  });

  it('throws RENDER_FAILED on TRUNCATION — a PDF shorter than the layout the packer built', async () => {
    mockPdfPages = 1; // the layout builds 2
    const err = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir }).catch((e) => e);
    expect(err.code).toBe('RENDER_FAILED');
    expect(err.message).toMatch(/TRUNCATION/);
  });

  it('throws RENDER_FAILED, not a raw schema error, when the document does not validate', async () => {
    const err = await renderLessonPlan({ lpDoc: { lesson_id: 'x' }, lang: 'en', stem: 's', outDir }).catch((e) => e);
    expect(err.code).toBe('RENDER_FAILED');
    expect(err.message).toMatch(/schema/i);
  });

  it('carries the renderer findings on the error so the caller can log what was wrong', async () => {
    mockPdfPages = 1;
    const err = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir }).catch((e) => e);
    expect(Array.isArray(err.problems)).toBe(true);
    expect(err.problems.length).toBeGreaterThan(0);
  });
});

describe('renderLessonPlan — warnings are not failures', () => {
  it('returns a soft-target overrun as a warning and still hands back the artefacts', async () => {
    const soft = WARN_PAGES.teach + 1; // over the soft target, under the hard cap
    expect(soft).toBeLessThanOrEqual(MAX_PAGES.teach);
    mockPdfPages = soft + 1;
    mockProbe = makeProbe({
      pagesByPart: { teach: soft, support: 1 },
      pages: Array.from({ length: soft + 1 }, (_, i) => ({
        id: `p-${i}`, contentBottomPx: 900, footTopPx: 1000, overflowPx: 0, overflowingSections: [],
        lastElement: 'd', contentHeight: 1, boxHeight: 1, lastPaintedPx: 1, innerBottomPx: 1,
      })),
    });

    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir });
    expect(out.warnings.some((w) => /soft target/.test(w))).toBe(true);
    expect(fs.existsSync(out.pdfPath)).toBe(true);
  });
});

describe('the Linux/Railway chromium channel (vendor divergence)', () => {
  const withPlatform = (value, fn) => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value, configurable: true });
    try { return fn(); } finally { Object.defineProperty(process, 'platform', original); }
  };

  it('asks for no channel off macOS, so playwright uses its own bundled chromium', () => {
    withPlatform('linux', () => expect(chromeChannel()).toBeUndefined());
  });

  it('keeps the upstream behaviour on macOS, where a dev box has Google Chrome', () => {
    withPlatform('darwin', () => expect(chromeChannel()).toBe('chrome'));
  });

  it('honours an explicit LP612_CHROME_CHANNEL on any platform', () => {
    process.env.LP612_CHROME_CHANNEL = 'msedge';
    withPlatform('linux', () => expect(chromeChannel()).toBe('msedge'));
  });

  it('treats LP612_CHROME_CHANNEL=bundled as "no channel", not as a channel named bundled', () => {
    process.env.LP612_CHROME_CHANNEL = 'bundled';
    withPlatform('darwin', () => expect(chromeChannel()).toBeUndefined());
  });

  it('never passes channel:undefined into launch() — playwright reads the KEY, not the value', async () => {
    await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 's', outDir });
    expect(mockLaunchCalls).toHaveLength(1);
    if ('channel' in mockLaunchCalls[0]) expect(mockLaunchCalls[0].channel).toBeTruthy();
  });
});

// ── the video pick reaches the page ─────────────────────────────────────────

/**
 * The pick travels beside the document, not inside it.
 *
 * `lp_doc` is `additionalProperties: false` at every level, so there is nowhere in the schema to
 * put a url — and that is the point: the printed link must not be something the authoring model
 * can rewrite or invent. It arrives as a render option and is emitted as coaching-corner
 * furniture.
 *
 * These assertions read the HTML the service ACTUALLY WROTE, so they execute the whole chain
 * (service -> renderDoc -> buildHtml -> the coaching corner). A test that only asserted the
 * option was forwarded would stay green if the renderer dropped it on the repack pass.
 */
describe('renderLessonPlan carries the segment video onto the page', () => {
  const PICK = {
    url: 'https://www.youtube.com/watch?v=pWLEUhu-60A',
    video_id: 'pWLEUhu-60A',
    title: 'Definition of Chemistry',
  };

  it('prints the short url when the segment has a pick', async () => {
    const out = await renderLessonPlan({
      lpDoc: CLEAN_DOC, lang: 'en', stem: 'vid-en', outDir, video: PICK,
    });
    expect(fs.readFileSync(out.htmlPath, 'utf8')).toContain('youtu.be/pWLEUhu-60A');
  });

  it('prints nothing at all when the segment has no pick', async () => {
    const out = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'vid-none', outDir });
    expect(fs.readFileSync(out.htmlPath, 'utf8')).not.toContain('youtu.be');
  });

  it('survives the repack pass — the line is on the FINAL html, not just the measure pass', async () => {
    // buildHtml is called twice: once to measure, once to rebuild at the chosen page breaks.
    // Passing the pick to only the first prints it on a page nobody ever sees.
    const out = await renderLessonPlan({
      lpDoc: CLEAN_DOC, lang: 'ur', stem: 'vid-ur', outDir, video: PICK,
    });
    const html = fs.readFileSync(out.htmlPath, 'utf8');
    expect(html).toContain('youtu.be/pWLEUhu-60A');
    // and LTR-isolated, so the RTL paragraph cannot reorder it into an untypable url
    expect(html).toContain('⁦youtu.be/pWLEUhu-60A⁩');
  });
});
