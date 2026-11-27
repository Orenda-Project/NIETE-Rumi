// lessons-lib — what the hand-written Lesson Plans flows share (bd-q8wt5e.6.6): app switches set on THIS run's own
// database and put back, the demo people's ids, reading the page, the menu, and the ready-made plan walk
// (grade → subject → chapter → lesson → viewer). Not a feature: web-runner only loads features/<name>.cjs.
'use strict';
const { DEMO, MODES, expect, asRole, watch } = require('../lib.cjs');

const e164 = (p) => '92' + p.slice(1);
const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");

async function userId(ctx, phone) {
  const id = await ctx.sql('select id from users where phone_number = ' + q(e164(phone)));
  expect(id, 'no demo user ' + phone + ' in the run database');
  return id;
}

// Set app_settings keys for the body, then put every one back as it was (a key that had no row is deleted again).
// `undefined` / null as a value deletes the key for the body. Values are JSON (true, ["<id>"], "teachers").
async function withSettings(ctx, settings, body) {
  const prev = {};
  for (const k of Object.keys(settings)) prev[k] = await ctx.sql('select value::text from app_settings where key = ' + q(k));
  try {
    for (const [k, v] of Object.entries(settings)) {
      if (v === undefined || v === null) await ctx.sql('delete from app_settings where key = ' + q(k));
      else await ctx.sql('insert into app_settings (key, value) values (' + q(k) + ', ' + q(JSON.stringify(v)) + '::jsonb) '
        + 'on conflict (key) do update set value = excluded.value, updated_at = now()');
    }
    return await body();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v) await ctx.sql('insert into app_settings (key, value) values (' + q(k) + ', ' + q(v) + '::jsonb) '
        + 'on conflict (key) do update set value = excluded.value, updated_at = now()');
      else await ctx.sql('delete from app_settings where key = ' + q(k));
    }
  }
}

// The two app switches (lib.MODES) as settings, so withSettings puts them back too.
const modeSettings = (mode) => Object.fromEntries(Object.entries(MODES[mode]).map(([k, v]) => [k, v]));

async function bodyText(page) { return page.evaluate(() => document.body.innerText); }
// Wait (up to ms) until the page's text matches re; returns the text either way.
async function waitText(page, re, ms = 15000) {
  const deadline = Date.now() + ms; let t = '';
  while (Date.now() < deadline) { t = await bodyText(page); if (re.test(t)) return t; await page.waitForTimeout(250); }
  return t;
}
async function seeText(page, re, what, ms) {
  const t = await waitText(page, re, ms);
  expect(re.test(t), (what || 'the page') + ': no ' + re + ' (saw: ' + JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 220)) + ')');
  return t;
}
async function noText(page, re, what) {
  const t = await bodyText(page);
  const m = t.match(re);
  expect(!m, (what || 'the page') + ' shows ' + JSON.stringify(m && m[0]) + ', which it must not');
}

// The menu's links in order (the phone's bottom bar and the wide top bar carry the same items; the first copy is kept).
async function menu(page) {
  const items = await page.$$eval('nav a', (as) => as.map((a) => ({ text: a.innerText.trim(), href: a.getAttribute('href'), current: a.getAttribute('aria-current') === 'page' })));
  const seen = new Set(); const out = [];
  for (const i of items) if (i.text && !seen.has(i.text)) { seen.add(i.text); out.push(i); }
  return out;
}
// expect the named items in this order (other items may sit between them)
function inOrder(have, want) {
  let at = -1;
  for (const w of want) { const i = have.indexOf(w, at + 1); if (i < 0) return false; at = i; }
  return true;
}

// Go to `path` and wait until it SETTLES (lib.settledPath's rule, with the query).
async function go(page, ctx, path) {
  await page.goto(ctx.baseUrl + path, { waitUntil: 'domcontentloaded' });
  const { settledPath } = require('../lib.cjs');
  return settledPath(page, '__never__', true);
}
const pathOf = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };

// Health: no uncaught page error and no 5xx while the scenario ran, apart from `allow` (paths whose 5xx is the
// scenario's own subject, e.g. the plan file the demo store does not hold).
function healthy(page, allow = []) {
  const w = watch(page);
  const bad = w.fivexx.filter((f) => !allow.some((a) => f.includes(a)));
  expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
  expect(!bad.length, 'API returned ' + [...new Set(bad)].join(', '));
}

// The ready-made walk from /portal/teacher/lessons/new: open the picker, pick the grade and subject, then the
// chapter (its number) and the lesson (text). Leaves the page on the viewer.
async function pickGradeSubject(page, grade, subject) {
  await page.getByText('Select grade and subject', { exact: true }).first().click();
  await page.getByText('Grade ' + grade, { exact: true }).first().click();
  await page.getByText(subject, { exact: true }).first().click();
}
async function openReadyPlan(page, ctx, { grade, subject, chapter = 1, lesson }) {
  await pickGradeSubject(page, grade, subject);
  await page.waitForURL(/\/lessons\/chapters\?/, { timeout: 15000 });
  await page.locator('main').getByText(String(chapter), { exact: true }).first().click();
  await page.waitForURL(/\/lessons\/lessons\?/, { timeout: 15000 });
  if (lesson) await page.getByText(lesson).first().click();
  else await page.locator('main').getByText('1', { exact: true }).first().click();
  await page.waitForURL(/\/lessons\/(plan|preparing)/, { timeout: 30000 });
}

// The run's own service logs (<run dir>/worker.log, bot.log, portal.log): mark where a log ends, read what came after.
const fs = require('fs');
const path = require('path');
function logMark(ctx, file) {
  try { return fs.statSync(path.join(ctx.runDir, file)).size; } catch (_) { return 0; }
}
function logSince(ctx, file, mark) {
  try {
    const buf = fs.readFileSync(path.join(ctx.runDir, file));
    return buf.slice(mark || 0).toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
  } catch (_) { return ''; }
}
// A plan the worker could not make because the lane's model cassette holds no answer for it (E2E_CASSETTE=replay-strict):
// the reason to report BLOCKED with, or null when the worker log since `mark` shows no such miss.
function cassetteMiss(ctx, mark) {
  const t = logSince(ctx, 'worker.log', mark);
  if (!/E2E_CASSETTE_MISS|replay-strict MISS/.test(t)) return null;
  const stage = (t.match(/E2E_CASSETTE_MISS (\w+)/) || [])[1] || 'llm';
  return 'the plan is made by the worker with a model, and this lane\'s cassette (E2E_CASSETTE=replay-strict) has no recorded '
    + stage + ' answer for it (E2E_CASSETTE_MISS in worker.log): the plan can never be made here';
}

// Is the FLN corpus loaded on this portal? null when it is, else the BLOCKED reason (the catalogue's own answer).
async function flnCorpus(page, ctx) {
  const r = await page.request.get(ctx.baseUrl + '/api/portal/fln/catalogue?grade=1&subject=rh-en');
  if (r.status() === 200) return null;
  return 'the test portal has no FLN corpus: GET /api/portal/fln/catalogue answers ' + r.status()
    + " (no FLN_CORPUS_BASE or CONTENT_R2_PUBLIC_URL in the web lane's portal env), so no FLN list or plan can open here";
}
// The viewer has drawn its buttons (Download PDF is on every plan screen, whether or not the file itself shows).
async function viewerWait(page) { return seeText(page, /Download PDF/, 'the viewer', 30000); }

module.exports = { flnCorpus, viewerWait, logMark, logSince, cassetteMiss, DEMO, MODES, expect, asRole, watch, e164, q, userId, withSettings, modeSettings, bodyText, waitText, seeText,
  noText, menu, inOrder, go, pathOf, healthy, pickGradeSubject, openReadyPlan };
