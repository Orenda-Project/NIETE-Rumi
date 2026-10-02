/**
 * Child-test stimulus (L2, bd-s1oo0.2) — the REAL browser render.
 *
 * The root suite maps playwright-core to a stub, so this test runs the renderer in a child node
 * process with the bot's own node_modules, against the real Chromium. It proves what the unit
 * tests cannot: the in-page chunking keeps every story token in order across the chunks, each
 * chunk is a legible size and shape for a chat bubble, and the PDFs have the pages they should.
 *
 * Needs Playwright's Chromium (installed by bot/ postinstall). Opt in with CHILD_TEST_RENDER_REAL=1
 * so a CI job without a browser does not report a pass it never earned; the lane runs it locally
 * and records the counts in its REPORT.md.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const REAL = process.env.CHILD_TEST_RENDER_REAL === '1';
const d = REAL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../../..');
const PUNCT = /^[.,!?;:"'۔،؟]+|[.,!?;:"'۔،؟]+$/g;

function run() {
  const script = path.join(__dirname, 'real-render.driver.js');
  const out = execFileSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, NODE_PATH: path.join(ROOT, 'bot/node_modules'), NODE_OPTIONS: '' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 240000,
  });
  return JSON.parse(out.toString().split('\n').filter((l) => l.startsWith('{"result"')).pop()).result;
}

d('real render (Chromium)', () => {
  let r;
  beforeAll(() => { r = run(); }, 250000);

  it('story chunks round-trip every token, in order, for every grade and language', () => {
    for (const k of Object.keys(r.inline)) {
      const { tokens, cards } = r.inline[k];
      const words = cards.filter((c) => c.part === 'story').flatMap((c) => c.text.split(/\s+/))
        .map((w) => w.replace(PUNCT, '')).filter(Boolean);
      expect({ k, words: words.map((w) => w.toLowerCase()) }).toEqual({ k, words: tokens.map((t) => t.toLowerCase()) });
    }
  });

  it('each card is a bubble-friendly shape (no taller than 1.25 x its width) at 1080 px wide', () => {
    for (const k of Object.keys(r.inline)) for (const c of r.inline[k].cards) {
      expect(c.widthPx).toBe(1080);
      expect(c.heightPx / c.widthPx).toBeLessThanOrEqual(1.25);
      expect(c.isPng).toBe(true);
    }
  });

  it('a story chunk is a few lines, not the whole story', () => {
    for (const k of Object.keys(r.inline)) for (const c of r.inline[k].cards.filter((x) => x.part === 'story')) {
      expect(c.lines).toBeGreaterThanOrEqual(2);
      expect(c.lines).toBeLessThanOrEqual(5);
    }
  });

  it('printable card: 5 A4 pages; coach sheet: at least 1', () => {
    for (const p of r.printable) {
      expect(p.pages).toBe(5);
      expect(p.a4).toBe(true);
      expect(p.overflow).toEqual([]);
    }
    for (const p of r.coach) expect(p.pages).toBeGreaterThanOrEqual(1);
  });
});
