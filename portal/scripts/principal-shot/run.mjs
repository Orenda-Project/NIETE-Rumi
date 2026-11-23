#!/usr/bin/env node
/**
 * bd-33wxxi.11 (queue #236) — screenshot the principal's Home and phone bar at phone size, as every principal gets it
 * now (no switch), with no school, and with the observe switch (portal_principal_app) on.
 *
 *   cd portal && node scripts/principal-shot/run.mjs --out <dir> [--w 390] [--h 844]
 *
 * Starts a local vite dev server on harness.html (the real pages/Home.tsx and TeacherNavigation; PortalLayout and the
 * sign-in are stubbed), answers every API read with the fixtures below, and writes one PNG per scenario (the first
 * screen, and a full-page one). It prints the tiles and bar items it saw for each. No network. Modelled on
 * scripts/coach-shot/run.mjs. English only: in Urdu this harness page draws the band shifted right (the page, not the
 * app), so Urdu is checked by its words in the tests (harness.tsx still takes ?lang=ur).
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
const W = Number(arg('w', '390'));
const H = Number(arg('h', '844'));

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
  name: 'principal-shot-cjs',
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

const LOOK = { teacherV2: true, teacherHomeCard: true, teacherHomeLook: true };
const CARD = {
  success: true,
  school: { emis: '101', name: 'IMSG (I-V) I-10/1', teachers: 13, lastVisitDaysAgo: null },
  period: { key: 'week' },
  overview: {
    teachers: 13, active: { now: 9, prev: 7 },
    lp: { total: 38, makers: 8, perTeacherDay: 0.6, prev: { total: 30, perTeacherDay: 0.5 } },
    training: { modules: 11, makers: 4, prev: { modules: 9 } },
    papers: { total: 5, makers: 3, prev: { total: 4 } },
  },
  tiles: [], teachers: [], scores: { dc: { count: 6, makers: 4 }, coach: { count: 2, makers: 2 } },
};
const HOME = { success: true, now: new Date().toISOString(), order: null, orderOn: false, card: null, scores: { coach: null, observation: null }, quizHome: null };

const SCENARIOS = [
  { name: 'principal-no-switch-en', lang: 'en', features: { ...LOOK, principalApp: true, principalObserve: false }, card: CARD },
  { name: 'principal-no-school-en', lang: 'en', features: { ...LOOK, principalApp: true, principalObserve: false }, card: { success: true, school: null } },
  { name: 'principal-observe-switch-en', lang: 'en', features: { ...LOOK, principalApp: true, principalObserve: true }, card: CARD },
];
const DEV = /^\/(src|node_modules|@vite|@react-refresh|@id|@fs|scripts|bot)\//;

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [cjsToEsm, react()],
  resolve: {
    alias: [
      { find: /^\.\.\/components\/PortalLayout$/, replacement: path.join(here, 'LayoutWithBar.tsx') },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: false } },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  mkdirSync(OUT, { recursive: true });
  for (const s of SCENARIOS) {
    const fixture = { '/config': { success: true, features: s.features }, '/me/home': HOME, '/principal/school/card': s.card };
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === origin && (DEV.test(u.pathname) || u.pathname.startsWith('/@') || u.pathname.startsWith('/scripts/'))) return route.continue();
      if (u.origin !== origin && !/\/api\//.test(u.pathname)) return route.abort();
      const key = Object.keys(fixture).find((k) => u.pathname.endsWith(k));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(key ? fixture[key] : { success: true, items: [] }) });
    });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await page.goto(`${origin}/scripts/principal-shot/harness.html?lang=${s.lang}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    try {
      await page.getByTestId('feature-tiles').waitFor({ timeout: Number(process.env.SHOT_WAIT_MS || 180000) });
      await page.getByTestId('home-my-school').waitFor({ timeout: 60000 });
    } catch (e) {
      console.log(JSON.stringify({ name: s.name, errs, body: (await page.evaluate(() => document.body.innerText)).slice(0, 400) }, null, 1));
      throw e;
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `${s.name}-${W}.png`) });
    await page.screenshot({ path: path.join(OUT, `${s.name}-${W}-full.png`), fullPage: true });
    const seen = await page.evaluate(() => ({
      tiles: Array.from(document.querySelectorAll('[data-testid="feature-tiles"] a, [data-testid="feature-tiles"] button')).map((a) => a.textContent.trim()),
      bar: Array.from(document.querySelectorAll('[data-testid="teacher-nav"] a')).map((a) => a.textContent.trim()),
      school: (document.querySelector('[data-testid="home-my-school"]') || {}).innerText?.slice(0, 120),
    }));
    console.log(JSON.stringify({ name: s.name, ...seen, errs }));
    await page.close();
  }
} catch (e) {
  console.error('principal-shot failed:', e && e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
