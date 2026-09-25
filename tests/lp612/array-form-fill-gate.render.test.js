/**
 * bd-8sfwj — THE TWO-PASS FILL GATE, DRIVEN THROUGH `renderDoc`.
 *
 * The unit half of this bead, and the operator rulings and the 335-document census that justify
 * the mechanism, live in `array-form-fill-gate.test.js` beside this file. This half proves the
 * DECISION end to end: the gate renders the joined form, renders the array form, compares the two
 * `pagesByPart` readings and keeps the array only when it cost nothing. The page counts come from
 * a stubbed probe, so what is under test is the decision, never the layout that feeds it.
 *
 * Split from that file only to stay under the 300-line limit; the two are one suite.
 */


const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

// Successive probe results, one per browser pass: [joined measurement, array measurement, real].
let mockProbeQueue = [];
let mockMeasured = null;
let mockLaunches = 0;
// When set, the probe is computed FROM THE HTML THAT WAS LOADED rather than from the queue, so a
// test can prove the gate measured the variant it says it measured — not merely that it rendered
// twice. Without this, swapping the two variants is invisible to a queue-driven mock.
let mockProbeFor = null;
let mockLoadedPath = null;

jest.mock('playwright-core', () => {
  const stubPage = () => ({
    goto: jest.fn(async (url) => { mockLoadedPath = String(url).replace(/^file:\/\//, '').replace(/\?t=\d+$/, ''); return null; }),
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (src) => {
      const s = String(src);
      if (s.includes('document.fonts.ready')) return true;
      if (s.includes("classList.add('measuring')")) return mockMeasured;
      if (s.includes('minBodyFontPx')) {
        if (mockProbeFor) return mockProbeFor(require('fs').readFileSync(mockLoadedPath, 'utf8'));
        return mockProbeQueue.shift();
      }
      return undefined;
    }),
    pdf: jest.fn(async () => Buffer.from('%PDF-1.4\n/Type /Page \n')),
    $$: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  });
  return {
    chromium: {
      launch: jest.fn(async () => {
        mockLaunches += 1;
        return {
          newPage: jest.fn(async () => stubPage()),
          close: jest.fn().mockResolvedValue(undefined),
        };
      }),
    },
  };
}, { virtual: true });

// bd-8sfwj: a LITERAL relative require, deliberately NOT the `path.join(VENDOR, …)` form the 57
// sibling lp612 suites use. That computed form is unresolvable to a static require-graph, so every
// one of those suites is an offender row inside the already-red `tests/setup/unresolved-requires`
// guard — and a new row in an already-red guard is still a regression. This resolves statically.
const R = require('../../bot/vendor/lp-v9/render_lp.js');
const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const CLEAN = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const clone = (d) => JSON.parse(JSON.stringify(d));
const askBlock = (d) => {
  for (const sec of d.sections || []) for (const b of sec.blocks || []) if (b.type === 'ask') return b;
  throw new Error('fixture has no ask block');
};
const fadedBlock = (d) => {
  for (const sec of d.sections || []) for (const b of sec.blocks || []) if (b.type === 'faded_example') return b;
  throw new Error('fixture has no faded_example block');
};

// ── the slot walker, the join, and the comparison ────────────────────────────────────────────


// ── the gate in the renderer ─────────────────────────────────────────────────────────────────

const BUILT = buildHtml(CLEAN, { lang: 'en', docDir: path.dirname(FIXTURE), probeCont: true });
const ATOM_H = 240;
const teachAtoms = BUILT.atoms.teach.map((m) => Object.assign({ h: ATOM_H, mt: 0 }, m));
const supportAtoms = BUILT.atoms.support.map((m) => Object.assign({ h: 100, mt: 0 }, m));

const probeWith = (byPart) => ({
  pageCount: Object.values(byPart).reduce((a, b) => a + b, 0),
  pagesByPart: byPart,
  minBodyFontPx: R.BODY_FLOOR_PX,
  minBodySample: '.pad p :: body',
  minAnyFontPx: R.BODY_FLOOR_PX,
  minChipFontPx: R.CHIP_FLOOR_PX,
  minChipSample: '.kw :: chip',
  pages: Array.from({ length: Object.values(byPart).reduce((a, b) => a + b, 0) }, (_, i) => ({
    id: `p-${i + 1}`, part: 'teach', contentHeight: 900, boxHeight: 1000, lastPaintedPx: 950,
    contentBottomPx: 900, footTopPx: 1000, innerBottomPx: 1000, lastElement: 'sec',
    overflowPx: 0, overflowingSections: [], clipped_x: [],
  })),
});

let outDir;
let docPath;
beforeEach(() => {
  jest.clearAllMocks();
  mockLaunches = 0;
  mockProbeFor = null;
  mockMeasured = {
    parts: { teach: teachAtoms.map((a) => ({ h: a.h, mt: a.mt })), support: supportAtoms.map((a) => ({ h: a.h, mt: a.mt })) },
    probe: {},
  };
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfwj-gate-'));
  docPath = path.join(outDir, 'lesson.lp.json');
});
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

const render = async (doc, probes) => {
  mockProbeQueue = probes.slice();
  fs.writeFileSync(docPath, JSON.stringify(doc));
  const out = await R.renderDoc({ doc: docPath, out: outDir, stem: 'lesson', lang: 'en', pdf: false, quiet: true });
  return { out, html: fs.readFileSync(path.join(outDir, 'lesson.html'), 'utf8') };
};

describe('the gate, driven through renderDoc', () => {
  /* THE ACCEPTANCE CRITERION, in one test. 0 of the 335 corpus documents author an array, so
     every one of them must take the byte-identical old path and pay nothing for the gate. */
  test('a document with no array anywhere costs exactly one browser pass', async () => {
    const { out } = await render(CLEAN, [probeWith({ teach: 6, support: 1 })]);
    expect(mockLaunches).toBe(1);
    expect(out.report.array_form).toBeUndefined();
  });

  test('when the array form costs a page, the lesson keeps the dense block', async () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    // pass 1 joined = 6 teach, pass 2 array = 7 teach, pass 3 the real render of the winner
    const { out, html } = await render(d, [
      probeWith({ teach: 6, support: 1 }),
      probeWith({ teach: 7, support: 1 }),
      probeWith({ teach: 6, support: 1 }),
    ]);
    expect(mockLaunches).toBe(3);
    expect(out.report.array_form).toEqual({ gated: true, joined: { teach: 6, support: 1 }, array: { teach: 7, support: 1 } });
    expect(html).toContain('Which shop is cheaper? How do you know?');
  });

  test('when the array form is free, the lesson gets the readable rows', async () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    const { out, html } = await render(d, [
      probeWith({ teach: 6, support: 1 }),
      probeWith({ teach: 6, support: 1 }),
      probeWith({ teach: 6, support: 1 }),
    ]);
    expect(mockLaunches).toBe(3);
    expect(out.report.array_form).toEqual({ gated: false, joined: { teach: 6, support: 1 }, array: { teach: 6, support: 1 } });
    expect(html).toContain('<li>Which shop is cheaper?</li>');
    expect(html).not.toContain('Which shop is cheaper? How do you know?');
  });

  /* THE GATE CHOOSES A FORM, NEVER A SUBSET — the "dont cut anything" ruling, asserted on the
     bytes. Both outcomes must carry every word the author wrote. */
  test('neither outcome loses a word', async () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    const kept = await render(d, [probeWith({ teach: 6 }), probeWith({ teach: 6 }), probeWith({ teach: 6 })]);
    const dense = await render(d, [probeWith({ teach: 6 }), probeWith({ teach: 7 }), probeWith({ teach: 6 })]);
    for (const h of [kept.html, dense.html]) {
      expect(h).toContain('Which shop is cheaper?');
      expect(h).toContain('How do you know?');
    }
  });

  /* THE LABELS MUST NAME THE FORM THAT WAS MEASURED. Here the probe is derived from the HTML the
     browser actually loaded, so measuring the two variants in the wrong order is visible. */
  test('the joined and array numbers each come from their own form', async () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    mockProbeFor = (html) =>
      probeWith(html.includes('<li>Which shop is cheaper?</li>') ? { teach: 7 } : { teach: 6 });
    mockProbeQueue = [];
    fs.writeFileSync(docPath, JSON.stringify(d));
    const out = await R.renderDoc({ doc: docPath, out: outDir, stem: 'lesson', lang: 'en', pdf: false, quiet: true });
    expect(out.report.array_form).toEqual({ gated: true, joined: { teach: 6 }, array: { teach: 7 } });
  });

  /* A probe that carries no per-part count is NOT a measurement of zero. The lesson keeps the
     dense block, because "nothing gets longer" cannot be asserted from nothing. */
  test('a probe with no pagesByPart is no measurement at all', async () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    const blind = Object.assign(probeWith({ teach: 6 }), { pagesByPart: undefined });
    const { out, html } = await render(d, [blind, blind, probeWith({ teach: 6 })]);
    expect(out.report.array_form).toEqual({ gated: true, joined: null, array: null });
    expect(html).toContain('Which shop is cheaper? How do you know?');
  });

  /* faded_example.prompt is out of scope, so a document whose ONLY array is that field must not
     buy two extra browser passes to decide a question with one answer. */
  test('a faded_example.prompt array alone does not open the gate', async () => {
    const d = clone(CLEAN);
    fadedBlock(d).prompt = ['Read the clue aloud.', 'Write your two guesses.'];
    await render(d, [probeWith({ teach: 6, support: 1 })]);
    expect(mockLaunches).toBe(1);
  });
});
