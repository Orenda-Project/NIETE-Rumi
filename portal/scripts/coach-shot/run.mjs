#!/usr/bin/env node
/**
 * bd-bfagiy — screenshot the coach's Schedule an observation page (step 1, the school search) at phone size.
 *
 *   cd portal && node scripts/coach-shot/run.mjs --out <dir> [--type "i103"] [--lang en|ur] [--w 390] [--h 844] [--name x]
 *
 * Starts a local vite dev server on harness.html (the real CoachNewVisit, no app shell, no sign-in gate), answers every
 * API read with the fixture below (eight Islamabad schools, the visit flow v6 switch on), types --type into the school
 * search, and writes <name>.png (the first screen). It prints the school names on screen, top to bottom. No network.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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
const TYPE = arg('type', '');
const NAME = arg('name', `schedule-search-${LANG}-${W}`);

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
  name: 'coach-shot-cjs',
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

const school = (emis, name, teachers, daysSinceVisit) => ({
  schoolExtId: `niete:${emis}`, emis, name, teachers, visits: 0, daysSinceVisit, avgHitl: null,
});
const FIXTURE = {
  '/config': { success: true, features: { coachV2: true, coachFlowV2: true } },
  '/coach/people': { success: true, schools: [
    school('613', 'IMCG (VI-XII) I-10/4', 14, null),
    school('1033', 'IMCB G-10/3', 9, 40),
    school('273', 'IMS(I-V) No.2 G-10/2', 7, 21),
    school('721', 'IMCG F-7/2', 18, 12),
    school('620', 'IMSG G-6/2', 6, 9),
    school('844', 'IMSB I-8/4', 11, 6),
    school('612', 'IMSG (I-V) I-10/3', 8, 3),
    school('101', 'IMSG (I-V) I-10/1', 5, 1),
  ], teachers: [] },
  '/coach/schedule': { success: true, from: '', to: '', overdue: [], visits: [] },
  '/coach/reports': { success: true, waiting: [], inProgress: [], all: { total: 0, page: 1, pageSize: 20, items: [] } },
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
      { find: /^(\.\.?\/)+CoachGate$/, replacement: path.join(here, 'CoachGateStub.tsx') },
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
  const asked = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname.slice(0, 90)));
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => errs.push(`failed ${r.url().slice(0, 160)} ${r.failure() && r.failure().errorText}`));
  await page.goto(`${origin}/scripts/coach-shot/harness.html?lang=${LANG}&at=${encodeURIComponent('/portal/coach/new-visit')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const box = page.getByPlaceholder(LANG === 'ur' ? 'اسکول کا نام' : 'School name');
  try {
    await box.waitFor({ timeout: Number(process.env.SHOT_WAIT_MS || 180000) });
  } catch (e) {
    console.log(JSON.stringify({ errs, asked: asked.slice(-25), asks: asked.length, html: (await page.content()).slice(0, 300), body: (await page.evaluate(() => document.body.innerText)).slice(0, 400) }, null, 1));
    throw e;
  }
  await page.waitForTimeout(800);
  if (TYPE) { await box.fill(TYPE); await page.waitForTimeout(400); }
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${NAME}.png`) });
  const names = FIXTURE['/coach/people'].schools.map((s) => s.name);
  const shown = await page.evaluate((all) => {
    const text = document.body.innerText;
    return all.map((n) => [n, text.indexOf(n)]).filter(([, i]) => i > -1).sort((a, b) => a[1] - b[1]).map(([n]) => n);
  }, names);
  console.log(JSON.stringify({ name: NAME, typed: TYPE, shown }));
} catch (e) {
  console.error('coach-shot failed:', e && e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
