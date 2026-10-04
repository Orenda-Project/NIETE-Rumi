/**
 * Child test v2 print pack (L29, bd-s1oo0.46.5) — the REAL browser render.
 *
 * The root suite maps playwright-core to a stub, so the renderer runs in a child node process with
 * the bot's own node_modules against the real Chromium. It proves what the HTML tests cannot: every
 * file has the A4 pages it should, nothing overflows its page after the fit pass, and the setup
 * picture is the size the bot sends (≤ 1080 px wide, aspect ≤ 1.24).
 *
 * Needs Playwright's Chromium. Opt in with CHILD_TEST_RENDER_REAL=1, as L2's real-render test does.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const REAL = process.env.CHILD_TEST_RENDER_REAL === '1';
const d = REAL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../../..');

function run() {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'real-render-v2.driver.js')], {
    cwd: ROOT,
    env: { ...process.env, NODE_PATH: path.join(ROOT, 'bot/node_modules'), NODE_OPTIONS: '' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 280000,
  });
  return JSON.parse(out.toString().split('\n').filter((l) => l.startsWith('{"result"')).pop()).result;
}

d('print pack v2 — real render (Chromium)', () => {
  let r;
  beforeAll(() => { r = run(); }, 290000);

  it('each grade and set: six A4 sides, nothing overflowing', () => {
    expect(r.cards).toHaveLength(4);
    for (const c of r.cards) {
      expect(c.pages).toBe(6);
      expect(c.a4).toBe(true);
      expect(c.overflow).toEqual([]);
    }
  });

  it('PRINT_ME: cover + blank + coach sheet + 2 coach cards with blank backs + 12 card sides = 20 A4 pages, per set', () => {
    for (const p of r.printMe) {
      expect(p.pages).toBe(20);
      expect(p.a4).toBe(true);
      expect(p.overflow).toEqual([]);
    }
  });

  it('coach card (L33): one A4 side per grade and set, nothing overflowing, type never below the 13 pt body', () => {
    expect(r.coachCards).toHaveLength(4);
    for (const c of r.coachCards) {
      expect(c.pages).toBe(1);
      expect(c.a4).toBe(true);
      expect(c.overflow).toEqual([]);
      expect(c.scale).toBeGreaterThanOrEqual(1);
    }
  });

  it('coach page: one sheet, two sides, fits', () => {
    expect(r.coach.pages).toBe(2);
    expect(r.coach.overflow).toEqual([]);
  });

  it('setup picture: a PNG at most 1080 px wide, aspect at most 1.24', () => {
    for (const lang of ['en', 'ur']) {
      const p = r.pictures[lang];
      expect(p.isPng).toBe(true);
      expect(p.width).toBeLessThanOrEqual(1080);
      expect(p.height / p.width).toBeLessThanOrEqual(1.24);
    }
  });
});

d('print pack v2 script — coach card files (L33)', () => {
  const fs = require('fs');
  const os = require('os');
  let out;
  let layout;
  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-v2-'));
    execFileSync(process.execPath, [path.join(ROOT, 'bot/scripts/child-test/build-print-pack-v2.js'), '--out', out], {
      cwd: ROOT,
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'bot/node_modules'), NODE_OPTIONS: '' },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 280000,
    });
    layout = JSON.parse(fs.readFileSync(path.join(out, 'layout.json'), 'utf8'));
  }, 290000);
  afterAll(() => { if (out) fs.rmSync(out, { recursive: true, force: true }); });

  it('writes a one-page coach card per grade and set, Set B named for next term, none overflowing', () => {
    for (const name of ['coach-card_G3_SetA', 'coach-card_G5_SetA', 'coach-card_G3_SetB_NEXT-TERM', 'coach-card_G5_SetB_NEXT-TERM']) {
      const file = `${name}.pdf`;
      expect(fs.existsSync(path.join(out, file))).toBe(true);
      expect(layout.files[file].pages).toBe(1);
      expect(layout.files[file].overflow).toEqual([]);
    }
    expect(layout.files['PRINT_ME.pdf'].pages).toBe(20);
  });
});
