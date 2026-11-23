#!/usr/bin/env node
/**
 * bd-hronni — screenshot the coach's Upload recording step (CoachAttach) after a file is picked, at phone size.
 *
 *   cd portal && node scripts/attach-shot/run.mjs --out <dir> --file <path> [--as "1000043567"] [--mime ""] [--name x]
 *                                                [--lang en|ur] [--w 390] [--h 844]
 *
 * Starts a local vite dev server on harness.html (the real CoachAttach, no app shell, no sign-in gate), answers every
 * API read with the fixture below (one upcoming visit), puts --file into the page's file input under the name --as with
 * the type --mime (what an Android picker hands over: often a name with no ending and no type), and writes <name>.png.
 * It prints the accept list, what the page said (an alert, or the file row) and the bar. No network.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const OUT = path.resolve(arg('out', path.join(here, 'out')));
const LANG = arg('lang', 'en');
const W = Number(arg('w', '390'));
const H = Number(arg('h', '844'));
const FILE = arg('file', path.resolve(root, '../tests/fixtures/audio/lesson-hello.opus'));
const AS = arg('as', path.basename(FILE));
const MIME = arg('mime', '');
const NAME = arg('name', `attach-${LANG}-${W}`);

function findChromium() {
  for (const b of [path.join(homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(homedir(), '.cache', 'ms-playwright')]) {
    if (!existsSync(b)) continue;
    for (const d of readdirSync(b).sort().reverse()) {
      for (const rel of ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(b, d, rel);
        if (/^chromium-/.test(d) && existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

/** The app's few `.cjs` helpers (src/lib) are interop-converted by the production build only; do it for the dev server. */
const cjsToEsm = {
  name: 'attach-shot-cjs',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0];
    if (!file.endsWith('.cjs') || !file.startsWith(path.join(root, 'src'))) return null;
    const m = /module\.exports\s*=\s*\{([^}]*)\}/.exec(code);
    const names = m ? m[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean) : [];
    return {
      code: `const module = { exports: {} };\nconst exports = module.exports;\n${code}\nconst __m = module.exports;\nexport default __m;\n${names.map((n) => `const __e_${n} = __m.${n}; export { __e_${n} as ${n} };`).join('\n')}\n`,
      map: null,
    };
  },
};

const FIXTURE = {
  '/config': { success: true, features: { coachV2: true, coachFlowV2: true } },
  '/coach/visit/v1': {
    success: true,
    visit: { id: 'v1', teacherName: 'Ayesha Bibi', teacherExtId: 'ext-ayesha', schoolName: 'IMSG I-10/1', schoolExtId: 'niete:110',
      scheduledFor: '2026-11-23', scheduledSlot: '11:30', status: 'upcoming', overdue: false },
    teacher: { teacherExtId: 'ext-ayesha', name: 'Ayesha Bibi', phone: '92•••••0001', hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
    lastVisit: null,
  },
  '/coach/pending': { success: true, waiting: 0 },
};
const DEV = /^\/(src|node_modules|@vite|@react-refresh|@id|@fs|scripts|bot)\//;

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [cjsToEsm, react()],
  resolve: {
    alias: [
      { find: /^\.\.\/components\/PortalLayout$/, replacement: path.join(root, 'scripts/urdu-fit/PortalLayoutStub.tsx') },
      { find: /^(\.\.?\/)+CoachGate$/, replacement: path.join(here, '../coach-shot/CoachGateStub.tsx') },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: false } },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin && (DEV.test(u.pathname) || u.pathname.startsWith('/@') || u.pathname.startsWith('/scripts/'))) return route.continue();
    if (u.origin !== origin && !/\/api\//.test(u.pathname)) return route.abort();
    const key = Object.keys(FIXTURE).find((k) => u.pathname.endsWith(k));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(key ? FIXTURE[key] : { success: true }) });
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(`${origin}/scripts/attach-shot/harness.html?lang=${LANG}&at=${encodeURIComponent('/portal/coach/visit/v1/attach')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const input = page.getByTestId('audio-input');
  try {
    await input.waitFor({ state: 'attached', timeout: Number(process.env.SHOT_WAIT_MS || 180000) });
  } catch (e) {
    console.log(JSON.stringify({ errs, body: (await page.evaluate(() => document.body.innerText)).slice(0, 400) }, null, 1));
    throw e;
  }
  await page.waitForTimeout(800);
  const accept = await input.getAttribute('accept');
  await input.setInputFiles({ name: AS, mimeType: MIME, buffer: readFileSync(FILE) });
  await page.waitForTimeout(2500);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${NAME}.png`) });
  const said = await page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]');
    const bar = document.querySelector('[role="progressbar"]');
    const row = bar ? bar.parentElement?.innerText : null;
    return { alert: alert ? alert.textContent : null, bar: bar ? bar.getAttribute('aria-valuenow') : null, row };
  });
  console.log(JSON.stringify({ name: NAME, picked: AS, type: MIME, accept, ...said, errs }));
} catch (e) {
  console.error('attach-shot failed:', e && e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
