// lib — what every web-lane driver shares (bd-hnhlgn.5/.8): signing in, reading where a page SETTLES, the app
// switches, the mock WhatsApp, and `visit` — one page checked for health. Drivers live in features/<name>.cjs.
'use strict';

const PASSWORD = 'Demo2026';
// The demo school network (bot/scripts/e2e/portal-demo-seed.js): every account's password is PASSWORD.
const DEMO = { teacher: '03000000911', principal: '03000000902', coach: '03000000901', noPwTeacher: '03000000919' };
// The two app switches that decide which portal a person gets (dashboard/lib/feature-flags.js).
const MODES = {
  classic: { portal_teacher_v2: false, portal_coach_v2: false },
  v2: { portal_teacher_v2: true, portal_coach_v2: true },
  teacherV2: { portal_teacher_v2: true, portal_coach_v2: false },
  coachV2: { portal_teacher_v2: false, portal_coach_v2: true },
};

function expect(cond, msg) { if (!cond) throw new Error(msg); }

async function open(page, ctx) {
  await page.goto(ctx.baseUrl + '/portal/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#phoneNumber', { state: 'visible', timeout: 20000 });
}

async function signIn(page, phone, password) {
  // bd-x7aprz.3: the login opens on the WhatsApp code; the password sign-in is one tap away.
  const toPassword = page.getByRole('button', { name: /use password instead/i });
  if (await toPassword.count()) await toPassword.click();
  await page.fill('#phoneNumber', phone);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
}

// Where she ENDS UP. Pages redirect onward (login → /portal/dashboard → /portal/leader → /portal/teacher), so the
// first URL is not the answer: wait until the path has not changed for SETTLE_MS, then compare. Reading the first
// stop passed headless by winning a race and failed the moment the browser was slowed down (--headed).
const SETTLE_MS = 1500;
async function settledPath(page, notOn) {
  const deadline = Date.now() + 20000;
  let last = new URL(page.url()).pathname, since = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = new URL(page.url()).pathname;
    if (now !== last) { last = now; since = Date.now(); continue; }
    if (now !== notOn && Date.now() - since >= SETTLE_MS) break;
  }
  return last;
}
// a sign-in token in the path never reaches a log or results.json
const redact = (p) => p.replace(/\/go\/.+/, '/go/<token>');
async function landsOn(page, path) {
  const last = await settledPath(page, '/portal/login');
  expect(last.startsWith(path), 'expected to settle on ' + path + ', settled on ' + redact(last));
  return last;
}

// App switches live in app_settings and are read per request; a scenario sets the ones it depends on, on THIS
// run's own database, so it never rides on whatever the seed copied.
async function setSetting(ctx, key, json) {
  await ctx.sql("insert into app_settings (key, value) values ('" + key + "', '" + json + "'::jsonb) "
    + "on conflict (key) do update set value = excluded.value, updated_at = now()");
}
async function setFlags(ctx, flags) {
  for (const [key, on] of Object.entries(flags)) await setSetting(ctx, key, on ? 'true' : 'false');
}

// Sign `role` in under `mode` and wait until she has landed (anywhere but the login page).
async function asRole(page, ctx, role, mode) {
  if (mode) await setFlags(ctx, MODES[mode]);
  await open(page, ctx);
  await signIn(page, DEMO[role], PASSWORD);
  const home = await settledPath(page, '/portal/login');
  expect(home !== '/portal/login', role + ' could not sign in (still on /portal/login)');
  return home;
}

// Watch a page for the two failures a screenshot misses: an uncaught error in the app, and a 5xx from the API.
function watch(page) {
  if (page.__watch) return page.__watch;
  const w = { errors: [], fivexx: [] };
  page.on('pageerror', (e) => w.errors.push(String(e.message).split('\n')[0].slice(0, 160)));
  page.on('response', (r) => { if (r.status() >= 500) w.fivexx.push(r.status() + ' ' + new URL(r.url()).pathname); });
  page.__watch = w;
  return w;
}

const ERROR_SCREEN = /something went wrong|couldn.t load|error loading|unexpected error|page not found/i;

// visit(page, ctx, path, { settle, heading }) — open `path` and require that it is HEALTHY:
//   · it settles on `settle` (default `path`) — a redirect to /portal/login means the session or a guard broke;
//   · no uncaught page error and no 5xx API response while it loaded;
//   · no error screen in the body;
//   · `heading` (a RegExp) matches one of its h1/h2 — the page rendered its own content, not a shell.
async function visit(page, ctx, path, opts) {
  const o = opts || {};
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + path, { waitUntil: 'domcontentloaded' });
  const want = o.settle || path;
  const got = await settledPath(page, '__never__');
  expect(got === want, path + ': expected to settle on ' + want + ', settled on ' + redact(got));
  let headings = [];
  if (o.heading) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      headings = await page.$$eval('h1, h2', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
      if (headings.some((h) => o.heading.test(h))) break;
      await page.waitForTimeout(250);
    }
    expect(headings.some((h) => o.heading.test(h)), path + ': no heading matching ' + o.heading + ' (saw: ' + JSON.stringify(headings.slice(0, 4)) + ')');
  }
  const body = await page.evaluate(() => document.body.innerText);
  expect(!ERROR_SCREEN.test(body), path + ': the page shows an error screen');
  expect(!w.errors.length, path + ': uncaught page error — ' + w.errors[0]);
  expect(!w.fivexx.length, path + ': API returned ' + [...new Set(w.fivexx)].join(', '));
  return { path, settled: got, heading: (headings.find((h) => !o.heading || o.heading.test(h)) || '').split('\n')[0] };
}

// A scenario that signs one role in and visits a list of pages — the shape most page features take.
function pagesScenario(id, title, role, mode, pages) {
  return { id, title, run: async (page, ctx) => {
    if (role) await asRole(page, ctx, role, mode);
    const seen = [];
    for (const p of pages) seen.push(await visit(page, ctx, p.path, p));
    return { role, mode, pages: seen };
  } };
}

// ── the mock WhatsApp (bot/scripts/e2e/mock-graph-api.js): POST /inject a message FROM a phone, GET /outbox the
// bot's replies TO it. The WhatsApp half of a WhatsApp → portal scenario; ctx.mockUrl is this run's mock.
async function mock(ctx, method, p, body) {
  expect(ctx.mockUrl, 'no mock WhatsApp for this run (WEB_MOCK_URL)');
  const r = await fetch(ctx.mockUrl + p, { method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
// Send `text` from `phone` and wait for a reply whose text or button URL matches `re`. The bot caches its app
// switches for 30 s (app-redirect.service.js FLAG_TTL_MS), so a switch just set may not be seen yet: re-send until
// it is, for up to `forMs`. Returns { url, item, tries }.
async function sendUntilLink(ctx, phone, text, re, forMs) {
  const deadline = Date.now() + forMs;
  let tries = 0;
  while (Date.now() < deadline) {
    const { last } = await mock(ctx, 'GET', '/outbox?to=' + phone);
    tries += 1;
    await mock(ctx, 'POST', '/inject', { kind: 'text', from: phone, text });
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      const { items } = await mock(ctx, 'GET', '/outbox?to=' + phone + '&after=' + last);
      for (const it of items || []) {
        const m = (((it.cta && it.cta.url) || '') + ' ' + (it.txt || '')).match(re);
        if (m) return { url: m[0], item: it, tries };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error('no reply matching ' + re + ' to "' + text + '" from ' + phone + ' within ' + forMs + ' ms (' + tries + ' tries)');
}

module.exports = { PASSWORD, DEMO, MODES, expect, open, signIn, settledPath, landsOn, setSetting, setFlags,
  asRole, watch, visit, pagesScenario, mock, sendUntilLink };
