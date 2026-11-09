#!/usr/bin/env node
/**
 * bd-oitowp — screenshot the teacher v2 chapter page at phone size, with "Make my own" on or off.
 *
 *   cd portal && node scripts/chapter-shot/run.mjs --out <dir> [--flag on|off] [--lang en|ur] [--w 360] [--h 640] [--name x]
 *
 * Starts a local vite dev server on harness.html (the real LessonsPage, no app shell), answers every API read with
 * the fixture below (a grade 7 ICT chapter: six lesson plans, a worksheet, a revision), and writes <name>.png (the
 * first screen, what she sees without scrolling) and <name>-full.png. It also prints where the Make my own entry sits:
 * its top and bottom in CSS px, and whether it is wholly inside the first screen. No network, no sign-in.
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
const FLAG = arg('flag', 'on') === 'on';
const LANG = arg('lang', 'en');
const W = Number(arg('w', '360'));
const H = Number(arg('h', '640'));
const SLOW = process.argv.includes('--slow'); // hold the lesson list back and shoot mid-load
const BAND = arg('band', '612'); // bd-snkn32.4: 'k5' shoots a grade 3 Math chapter (the grades 1–5 lane)
const NAME = arg('name', `chapter-${BAND}-${FLAG ? 'on' : 'off'}-${LANG}-${W}`);

function findChromium() {
  const base = path.join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const alt = path.join(homedir(), '.cache', 'ms-playwright');
  for (const b of [base, alt]) {
    if (!existsSync(b)) continue;
    for (const d of readdirSync(b).sort().reverse()) {
      for (const rel of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome', 'chrome-linux/chrome',
      ]) {
        const p = path.join(b, d, rel);
        if (/^chromium/.test(d) && existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

/** The app's few `.cjs` helpers (src/lib) are interop-converted by the production build only; do it for the dev server. */
const cjsToEsm = {
  name: 'chapter-shot-cjs',
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

const lessons = [
  ['ict7.c03.p030', 'What is a computer network?', 'p.30–32'],
  ['ict7.c03.p033', 'Types of networks: LAN and WAN', 'p.33–35'],
  ['ict7.c03.p036', 'Network devices', 'p.36–38'],
  ['ict7.c03.p039', 'The internet and the web', 'p.39–41'],
  ['ict7.c03.p042', 'Using email safely', 'p.42–44'],
  ['ict7.c03.p045', 'Sharing files on a network', 'p.45–47'],
].map(([segment_id, title, pages_label], i) => ({ segment_id, title, pages_label, sent: i === 0 }));
const FIXTURE = {
  '/config': { success: true, features: { lpMakeOwn: FLAG, teacherApp: true } },
  '/curriculum/grades': { grades: [{ grade: 4, subject_count: 1 }] },
  '/lp612/grades': { grades: [{ grade: 7 }] },
  '/lp612/subjects': { subjects: [{ subject: 'ICT', lesson_count: 6 }] },
  '/lp612/chapters': { chapters: [{ chapter_key: 'c03', chapter_number: 3, chapter_title: 'Computer Networks', lesson_count: 6 }] },
  '/lp612/lessons': { lessons: [
    ...lessons,
    { segment_id: 'ict7.c03.ws', kind: 'worksheet', title: 'Worksheet', sent: false },
    { segment_id: 'ict7.c03.rev', kind: 'revision', title: 'Revision', sent: false },
  ] },
};
// bd-snkn32.4 — a grade 3 ICT Math chapter on the grades 1–5 lane: eight days, a worksheet, a revision.
const K5_DAYS = ['Place value up to 9999', 'Reading 4-digit numbers', 'Writing numbers in words', 'Comparing numbers',
  'Ordering numbers', 'Rounding to the nearest 10', 'Rounding to the nearest 100', 'Number patterns'];
const K5 = {
  '/config': FIXTURE['/config'],
  '/curriculum/grades': { grades: [{ grade: 3, subject_count: 1 }] },
  '/lp612/grades': { grades: [{ grade: 7 }] },
  '/curriculum/subjects': { subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 10 }] },
  '/curriculum/chapters': { chapters: [{ chapter_number: 1, chapter_title: 'Number Ninjas: Mastering the Thousands', lesson_count: 10 }] },
  '/curriculum/lps': { lessons: [
    ...K5_DAYS.map((topic, i) => ({ lesson_id: `grade_3_math_ch1_seg${i + 1}`, lp_type: 'content', day_label: `Day ${i + 1}`, topic, downloaded: i === 0 })),
    { lesson_id: 'grade_3_math_ch1_seg990', lp_type: 'assessment', day_label: 'Worksheet', topic: 'Worksheet' },
    { lesson_id: 'grade_3_math_ch1_seg995', lp_type: 'revision', day_label: 'Revision', topic: 'Revision' },
  ] },
};
if (BAND === 'k5') { for (const k of Object.keys(FIXTURE)) delete FIXTURE[k]; Object.assign(FIXTURE, K5); }
const DEV = /^\/(src|node_modules|@vite|@react-refresh|@id|@fs|scripts|bot)\//;

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [cjsToEsm, react()],
  resolve: {
    alias: [
      { find: /^\.\.\/components\/PortalLayout$/, replacement: path.join(root, 'scripts/urdu-fit/PortalLayoutStub.tsx') },
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
  const asked = [];
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin && (DEV.test(u.pathname) || u.pathname.startsWith('/@') || u.pathname.startsWith('/scripts/'))) return route.continue();
    if (u.origin !== origin && !/\/api\//.test(u.pathname)) return route.abort();
    const key = Object.keys(FIXTURE).find((k) => u.pathname.endsWith(k));
    if (SLOW && u.pathname.endsWith('/lp612/lessons')) await new Promise((r) => setTimeout(r, 6000));
    asked.push(`${u.pathname}${key ? '' : ' (stub {})'}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(key ? FIXTURE[key] : { success: true }) });
  });
  const at = BAND === 'k5' ? '/portal/teacher/lessons/lessons?grade=3&subject=math&chapter=1'
    : '/portal/teacher/lessons/lessons?grade=7&subject=ICT&chapter=c03';
  const HEAD = BAND === 'k5' ? 'Number Ninjas: Mastering the Thousands' : 'Computer Networks';
  const FIRST = BAND === 'k5' ? K5_DAYS[0] : 'What is a computer network?';
  await page.goto(`${origin}/scripts/chapter-shot/harness.html?lang=${LANG}&at=${encodeURIComponent(at)}`);
  if (SLOW) {
    await page.waitForTimeout(2500);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `${NAME}-loading.png`) });
    console.log(JSON.stringify({ loading: true, ownWhileLoading: await page.locator('[data-testid="own-entry"]').count() }));
  }
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  try {
    await page.getByText(HEAD).first().waitFor({ timeout: 30000 });
  } catch (e) {
    console.log(JSON.stringify({ errs, asked, body: (await page.evaluate(() => document.body.innerText)).slice(0, 400) }, null, 1));
    throw e;
  }
  await page.waitForTimeout(1200); // the lazy Make my own chunk and fonts settle
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${NAME}.png`) });
  await page.screenshot({ path: path.join(OUT, `${NAME}-full.png`), fullPage: true });
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="own-entry"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const first = document.querySelector('a[href*="/lessons/"], button');
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  });
  const firstLesson = await page.evaluate((FIRST) => {
    const t = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === FIRST);
    return t ? Math.round(t.getBoundingClientRect().top) : null;
  }, FIRST);
  console.log(JSON.stringify({ name: NAME, viewport: `${W}x${H}`, flag: FLAG, lang: LANG, ownEntry: box,
    ownAboveFold: box ? box.bottom <= H : null, firstLessonTop: firstLesson, asked: [...new Set(asked)] }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
