/**
 * Child test v3 print pack (L38, bd-s1oo0.50.4) — the REAL browser render.
 *
 * The root suite maps playwright-core to a stub, so the renderer runs in a child node process with the
 * bot's own node_modules against the real Chromium. It proves what the HTML tests cannot: every page is
 * A4, nothing overflows after the fit pass, no page had to shrink its type below the design size
 * (scale ≥ 1), the coach cards stay one sheet, and the page counts are what the plan says.
 *
 * Needs Playwright's Chromium. Opt in with CHILD_TEST_RENDER_REAL=1.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REAL = process.env.CHILD_TEST_RENDER_REAL === '1';
const d = REAL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../../..');
const ENV = { ...process.env, NODE_PATH: path.join(ROOT, 'bot/node_modules'), NODE_OPTIONS: '' };

function lastResult(out) {
  return JSON.parse(out.toString().split('\n').filter((l) => l.startsWith('{"result"')).pop()).result;
}

d('print pack v3 — real render (Chromium)', () => {
  let r;
  beforeAll(() => {
    r = lastResult(execFileSync(process.execPath, [path.join(__dirname, 'real-render-v3.driver.js')], {
      cwd: ROOT, env: ENV, maxBuffer: 64 * 1024 * 1024, timeout: 280000,
    }));
  }, 290000);

  const allScales = (x) => Object.values(x.scales);

  it('each booklet: one task per side, padded to whole sheets, A4, nothing overflowing, type never below design size', () => {
    for (const [b, x] of Object.entries(r.booklets)) {
      expect([b, x.pages]).toEqual([b, r.expected[b]]);
      expect(x.a4).toBe(true);
      expect([b, x.overflow]).toEqual([b, []]);
      for (const s of allScales(x)) expect(s).toBeGreaterThanOrEqual(1);
    }
  });

  it('each coach card: one sheet (two A4 sides), nothing overflowing, body type at least 13 pt', () => {
    for (const [c, x] of Object.entries(r.coachCards)) {
      expect([c, x.pages]).toEqual([c, 2]);
      expect(x.a4).toBe(true);
      expect([c, x.overflow]).toEqual([c, []]);
      for (const s of allScales(x)) expect(s).toBeGreaterThanOrEqual(1);
    }
  });

  it('PRINT_ME_v3: cover + blank + 4 coach sheets + the booklets, all A4, nothing overflowing', () => {
    const booklets = Object.values(r.expected).reduce((a, b) => a + b, 0);
    expect(r.printMe.pages).toBe(2 + 8 + booklets);
    expect(r.printMe.a4).toBe(true);
    expect(r.printMe.overflow).toEqual([]);
    for (const s of allScales(r.printMe)) expect(s).toBeGreaterThanOrEqual(1);
  });
});

d('print pack v3 script', () => {
  let out;
  let layout;
  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-v3-'));
    execFileSync(process.execPath, [path.join(ROOT, 'bot/scripts/child-test/build-print-pack-v3.js'), '--out', out, '--bank', path.join(__dirname, 'fixtures/item-bank.v3.fixture.json'), '--no-png'], {
      cwd: ROOT, env: ENV, maxBuffer: 64 * 1024 * 1024, timeout: 280000,
    });
    layout = JSON.parse(fs.readFileSync(path.join(out, 'layout.json'), 'utf8'));
  }, 290000);
  afterAll(() => { if (out) fs.rmSync(out, { recursive: true, force: true }); });

  it('writes PRINT_ME_v3.pdf and the eight per-part PDFs, none overflowing', () => {
    const names = ['PRINT_ME_v3.pdf',
      'booklet_urdu-reading_SetA.pdf', 'booklet_english-reading_SetA.pdf', 'booklet_maths-G3_SetA.pdf', 'booklet_maths-G5_SetA.pdf',
      'coach-card_urdu-reading_SetA.pdf', 'coach-card_english-reading_SetA.pdf', 'coach-card_maths-G3_SetA.pdf', 'coach-card_maths-G5_SetA.pdf'];
    for (const n of names) {
      expect(fs.existsSync(path.join(out, n))).toBe(true);
      expect([n, layout.files[n].overflow]).toEqual([n, []]);
    }
    expect(layout.files['PRINT_ME_v3.pdf'].pages).toBe(34);
    expect(layout.gaps.map((g) => g.task)).toEqual(['ur.nonwords']);
    expect(layout.pages['ur.letters']).toEqual({ booklet: 'ur', page: 1 });
  });
});
