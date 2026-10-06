/* EVERYTHING THE ENGINE EMITS RENDERS — the render matrix (scripts/qa/render-matrix).
 *
 * The quiz engine writes its items at run time, so a hand-picked screenshot proves nothing about
 * tomorrow's quiz. The generator builds every item SHAPE the engine can emit (every figure kind in
 * the diagram engine's own manifest, every web item type, 2–4 options, long stems and options,
 * maths, glyph and picture tiles, a pictogram that does not exist, a figure that cannot be drawn,
 * a hidden picture, an empty why — English and Urdu) through the REAL bot code (questionPayload) and
 * the REAL page shell, and the runner opens each page in headless Chromium as a phone (WhatsApp
 * in-app browser, 360x740) and checks the question screen and the feedback screen: no sideways
 * scroll, nothing past the edge, no clipped or overlapping text, no empty option, maths typeset,
 * Urdu in the Nastaliq face, the figure drawn or its documented fallback.
 *
 * Needs python3 with playwright and a Chromium; without them the matrix is SKIPPED, loudly.
 * Synthetic data only. */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'scripts', 'qa', 'render-matrix');

function browserReady() {
  const r = spawnSync('python3', ['-c', 'from playwright.sync_api import sync_playwright\nwith sync_playwright() as p:\n  b=p.chromium.launch(); b.close()'], { encoding: 'utf8', timeout: 60000 });
  return r.status === 0 ? null : String(r.stderr || r.error || 'no python3').split('\n').filter(Boolean).slice(-1)[0];
}

jest.setTimeout(300000);

describe('render matrix: every item shape the engine can emit renders at 360x740 (EN + UR)', () => {
  const why = browserReady();
  const run = why ? it.skip : it;
  if (why) {
    // eslint-disable-next-line no-console
    console.warn(`render matrix SKIPPED: no headless browser (${why}). Run: pip install playwright && python3 -m playwright install chromium`);
  }

  run('no item shape fails a layout check', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-render-matrix-'));
    execFileSync('node', [path.join(DIR, 'build_matrix.js'), out], { stdio: 'pipe', env: { ...process.env, LOG_LEVEL: 'silent' } });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    // the generator really covers the engine: both languages, every web type, the figure kinds
    const kinds = new Set(manifest.map((m) => m.kind));
    ['single', 'multi', 'picture', 'listen', 'tf', 'order', 'match', 'label'].forEach((k) => expect(kinds.has(k)).toBe(true));
    expect(new Set(manifest.map((m) => m.lang))).toEqual(new Set(['en', 'ur']));
    expect(manifest.filter((m) => m.figure_type).length).toBeGreaterThan(40);

    execFileSync('python3', [path.join(DIR, 'run_matrix.py'), out, '--no-shots', '--fast'], { stdio: 'pipe', timeout: 280000 });
    const results = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(manifest.length);
    const failing = results
      .filter((r) => r.question.length || r.feedback.length || (r.feedback_wrong || []).length || r.fatal || r.errors.length)
      .map((r) => `${r.id}: Q=${r.question.join(',')} FBW=${(r.feedback_wrong || []).join(',')} FB=${r.feedback.join(',')}${r.fatal ? ` FATAL=${r.fatal}` : ''}${r.errors.length ? ` JS=${r.errors[0]}` : ''}`);
    expect(failing).toEqual([]);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
