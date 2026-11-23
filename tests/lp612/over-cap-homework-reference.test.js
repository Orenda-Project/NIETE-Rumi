/**
 * bd-xkkw9.2 — A LESSON STILL OVER THE TEACH CAP AFTER THE TWO-BOX MOVE PRINTS ITS HOMEWORK
 * ONLY IN REFERENCE.
 *
 * Queue #112 (bd-xkkw9.1): after bd-9mc3nz.2 about 3 in 10 G6-12 lessons still came out over the
 * 4-page TEACH cap. Every stored lesson already prints the homework questions in full, with
 * answers, in Reference ("Homework, in full", from `homework_key`), so the teach-flow copy is a
 * duplicate. Re-rendering the 40 lessons still over: 31 fit both caps with the homework printed
 * only in Reference and a one-line pointer left in the flow.
 *
 * Same shape as bd-9mc3nz.2: one more paint, only when TEACH is still over; kept only if it is
 * over by fewer pages in total; a lesson that fits is byte-identical to before.
 *
 * THE BROWSER IS MOCKED at the `playwright-core` boundary (over-cap-flow-groups.test.js pattern).
 * The mock reports TEACH/Reference pages from the HTML it was handed, keyed on whether the two
 * groups and the homework items print in the teaching part.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { BODY_FLOOR_PX: mockBodyPx, CHIP_FLOOR_PX: mockChipPx } = require(path.join(V, 'render_lp.js'));

/** mockPages[groupsInFlow][hwInFlow] = { teach, support } */
let mockPages;

/** What prints before the support masthead? */
const mockTeachHtml = (file) => {
  const html = require('fs').readFileSync(file, 'utf8');
  const body = html.slice(html.lastIndexOf('</style>'));
  const at = body.indexOf('class="p2head');
  return at < 0 ? body : body.slice(0, at);
};
const mockGroupsIn = (file) => /class="mis\b/.test(mockTeachHtml(file));
const mockHwIn = (file) => /class="blk hw\b/.test(mockTeachHtml(file));

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
          const { teach, support } = mockPages[mockGroupsIn(file)][mockHwIn(file)];
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
const { buildHtml } = require(path.join(V, 'lib', 'template.js'));
const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));
const FIX_DIR = path.join(__dirname, '__fixtures__');
const FIXTURE = path.join(FIX_DIR, 'v9_gate_base.lp.json');
const CAPS = pageCapsFor('en');
const T = CAPS.max.teach;

const pages = (gh, g, h, n) => ({
  true: { true: gh, false: g },
  false: { true: h, false: n },
});
const at = (teach, support) => ({ teach, support });

let outDir;
let docFile;
beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-hwref-'));
  docFile = FIXTURE;
});
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

const render = (lang = 'en') => renderDoc({ doc: docFile, out: outDir, stem: 'g9', lang, pdf: false, quiet: true });
const pageCount = (out) => out.problems.filter((p) => p.startsWith('PAGE COUNT'));
const teachHtml = (out) => mockTeachHtml(out.htmlPath);
const supportHtml = (out) => { const h = fs.readFileSync(out.htmlPath, 'utf8'); return h.slice(h.indexOf('class="p2head')); };

describe('fitting lessons are byte-identical to before', () => {
  // The real-lesson proof (old vs new renderer over the stored lessons, byte for byte) is in the
  // bd-xkkw9.2 work folder; here: the option off builds exactly the default page, and a fitting
  // lesson never takes the homework paint.
  for (const lang of ['en', 'ur']) {
    test(`hwRefOnly:false builds exactly the default page (${lang})`, () => {
      const { doc } = applyOverlay(require(FIXTURE), lang);
      const a = buildHtml(doc, { lang, docDir: FIX_DIR }).html;
      const b = buildHtml(doc, { lang, docDir: FIX_DIR, hwRefOnly: false }).html;
      expect(b).toBe(a);
    });
  }

  test('a lesson that fits keeps homework in the flow, no pointer', async () => {
    mockPages = pages(at(T, 2), at(T, 2), at(T, 2), at(T, 2));
    const out = await render();
    expect(mockHwIn(out.htmlPath)).toBe(true);
    expect(teachHtml(out)).not.toMatch(/hwptr/);
    expect(out.homeworkMoved).toBe(false);
    expect(out.report.homework_moved).toBe(false);
  });
});

describe('still over TEACH after the two-box move: homework prints only in Reference', () => {
  test('over by one after the box move, fits with homework moved: no PAGE COUNT, pointer in the flow', async () => {
    // groups in flow: T+2 · groups moved: T+1 · groups and homework moved: T
    mockPages = pages(at(T + 2, 2), at(T + 1, 2), at(T + 1, 2), at(T, 3));
    const out = await render();
    expect(out.pagesByPart).toEqual({ teach: T, support: 3 });
    expect(pageCount(out)).toEqual([]);
    expect(out.flowGroupsMoved).toBe(true);
    expect(out.homeworkMoved).toBe(true);
    expect(out.report.homework_moved).toBe(true);
    // homework items are gone from the teaching part; the pointer stands in their place
    expect(mockHwIn(out.htmlPath)).toBe(false);
    expect(teachHtml(out)).toMatch(/class="blk hwptr\b/);
    expect(teachHtml(out)).toContain('Homework, in full');
    // the whole section leaves the flow: no homework bar, no homework notes
    expect(teachHtml(out)).not.toMatch(/class="[^"]*\bs-h\b/);
    expect(teachHtml(out)).not.toContain('Answers are checked at the start of the next period');
    // moved, never dropped: every homework question is printed in Reference with its answer,
    // and the section's own notes print there too
    const sup = supportHtml(out);
    expect(sup).toContain('Homework, in full');
    expect(sup).toContain('Which product is defined?');
    expect(sup).toContain('Answers are checked at the start of the next period');
  });

  test('box move alone refused, both moves together fit: the third paint makes both', async () => {
    // groups moved alone: no fewer pages over, refused · groups AND homework moved: fits both caps
    mockPages = pages(at(T + 1, 2), at(T + 1, 2), at(T + 1, 2), at(T, 3));
    const out = await render();
    expect(out.homeworkMoved).toBe(true);
    expect(out.flowGroupsMoved).toBe(true);
    expect(out.pagesByPart).toEqual({ teach: T, support: 3 });
    expect(pageCount(out)).toEqual([]);
    expect(mockGroupsIn(out.htmlPath)).toBe(false);
    expect(mockHwIn(out.htmlPath)).toBe(false);
  });

  // bd-xkkw9.4 — a tie on pages over goes to the layout with the shorter TEACH part. Same PDF
  // length, nothing dropped; the teacher holds four teaching pages and Reference runs one long.
  // (Before: the previous layout was kept, and 5 of the 11 lessons still over stayed at 5 TEACH.)
  test('Reference would spill over its own cap by as much as TEACH gains: the shorter TEACH is kept', async () => {
    mockPages = pages(at(T + 2, 2), at(T + 1, 2), at(T + 1, 2), at(T, CAPS.max.support + 1));
    const out = await render();
    expect(out.homeworkMoved).toBe(true);
    expect(out.flowGroupsMoved).toBe(true);
    expect(out.pagesByPart).toEqual({ teach: T, support: CAPS.max.support + 1 });
    expect(pageCount(out)).toHaveLength(1);
    expect(pageCount(out)[0]).toMatch(/^PAGE COUNT: support /);
    expect(mockHwIn(out.htmlPath)).toBe(false);
  });

  test('Reference would spill further than TEACH gains: the previous layout is kept and is what is on disk', async () => {
    mockPages = pages(at(T + 2, 2), at(T + 1, 2), at(T + 1, 2), at(T, CAPS.max.support + 2));
    const out = await render();
    expect(out.homeworkMoved).toBe(false);
    expect(out.flowGroupsMoved).toBe(true);
    expect(out.pagesByPart).toEqual({ teach: T + 1, support: 2 });
    expect(mockHwIn(out.htmlPath)).toBe(true);
  });

  test('a tie that does not shorten TEACH changes nothing: the previous layout is kept', async () => {
    mockPages = pages(at(T + 2, 2), at(T + 1, 2), at(T + 1, 2), at(T + 1, 2));
    const out = await render();
    expect(out.homeworkMoved).toBe(false);
    expect(out.pagesByPart).toEqual({ teach: T + 1, support: 2 });
    expect(mockHwIn(out.htmlPath)).toBe(true);
  });

  test('a homework item with no answer in Reference is never moved out of the flow', async () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    raw.page2.homework_key = raw.page2.homework_key.slice(1);
    docFile = path.join(outDir, 'partialkey.lp.json');
    fs.writeFileSync(docFile, JSON.stringify(raw));
    mockPages = pages(at(T + 2, 2), at(T + 1, 2), at(T + 1, 2), at(T, 3));
    const out = await render();
    expect(out.homeworkMoved).toBe(false);
    expect(mockHwIn(out.htmlPath)).toBe(true);
  });

  test('the Urdu pointer is printed in Urdu and names the Urdu Reference heading', () => {
    const { doc } = applyOverlay(require(FIXTURE), 'ur');
    const html = buildHtml(doc, { lang: 'ur', docDir: FIX_DIR, hwRefOnly: true }).html;
    const body = html.slice(html.lastIndexOf('</style>'));
    const teach = body.slice(0, body.indexOf('class="p2head'));
    expect(teach).not.toMatch(/class="blk hw\b/);
    expect(teach).toContain('گھر کے کام کے مکمل جوابات');
    expect(teach).not.toContain('Homework, in full');
  });
});
