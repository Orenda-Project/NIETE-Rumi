// web-quiz-child-page/lib — what every part of the child-quiz driver shares: the demo codes, how to open the page and
// read its boot payload, how to play questions, how to pin the identity switches and WAIT until the bot reflects them
// (its settings caches live 30 s), how to mint the bot's own tokens from the run's bot tree, SQL reads, a second
// "phone" (a fresh browser context), remembered children in page storage, and a capture of the page's own events.
'use strict';
const path = require('path');
const base = require('../../lib.cjs');
const { expect, watch } = base;

const WAIT = 15000;
// The demo seed's codes (bot/scripts/e2e/portal-demo-seed.js)
const CODES = {
  OPEN: 'AB12CD',      // Parts of a Plant, grade 4, bound to class 4-A (list + class)
  NEXT: 'SM34EF',      // States of Matter, grade 4, unbound (two grade-4 classes → identity v2 asks which)
  G3: 'GR3ABC',        // grade 3: the roll pad searches 3-B only
  G2: 'GR2ABC',        // grade 2: no list in that grade → the child picks the class
  G1: 'GR1ABC',        // grade 1
  UR: 'UR12AB',        // an Urdu quiz
  TITLE: 'TT12AB',     // teacher_name already carries "Teacher"
  EXPIRED: 'EX12AB',   // expires_at in the past
  CLOSED: 'QZCLOSED',  // active = false, Urdu
};
const TOPIC = 'Parts of a Plant';

const text = (page) => page.evaluate(() => document.body.innerText);
const inner = (page, sel) => page.$eval(sel, (el) => el.innerText.trim());
const count = (page, sel) => page.$$eval(sel, (els) => els.length);
const boot = (page) => page.evaluate(() => { const s = document.getElementById('boot'); return s ? JSON.parse(s.textContent) : null; });
const onScreen = (m) => '#wq[data-m="' + m + '"]';
const screen = (page) => page.$eval('#wq', (el) => el.getAttribute('data-m')).catch(() => null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function healthy(w, where) {
  expect(!w.errors.length, where + ': uncaught page error — ' + w.errors[0]);
  expect(!w.fivexx.length, where + ': API returned ' + [...new Set(w.fivexx)].join(', '));
}

// ── SQL (this run's own database; the runner returns psql's unaligned output) ─────────────────────────────────────
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
async function one(ctx, sql) { const out = await ctx.sql(sql); return out == null ? '' : String(out).split('\n')[0].trim(); }
async function rows(ctx, sql) { const out = await ctx.sql(sql); return String(out || '').split('\n').filter(Boolean).map((l) => l.split('|')); }
const codeRow = (ctx, code) => one(ctx, 'select id from quiz_share_codes where code = ' + q(code));
const teacherOf = (ctx, code) => one(ctx, 'select teacher_user_id from quiz_share_codes where code = ' + q(code));
const studentNamed = (ctx, name) => one(ctx, 'select id from students where student_name = ' + q(name) + ' and list_id is not null order by roll_number limit 1');

// ── the bot's own tokens: the token module from THIS run's bot tree, signing with the stack's key ─────────────────
function tokens(ctx) {
  expect(ctx.runDir && ctx.internalKey, 'no run dir / internal key on ctx (e2e-web.sh passes WEB_RUN_DIR + WEB_INTERNAL_KEY)');
  if (!process.env.INTERNAL_API_KEY) process.env.INTERNAL_API_KEY = ctx.internalKey;
  return require(path.join(ctx.runDir, 'src', 'bot', 'shared', 'services', 'quiz', 'web-quiz-token.js'));
}
// The bot's internal API, as the portal calls it (x-api-key).
// A link the bot built (WEB_QUIZ_BASE_URL is the https spelling of this run's portal: dev-portal.sh) opened on THIS run.
const local = (ctx, url) => String(url || '').replace(/^https?:\/\/[^/]+/, ctx.baseUrl);
async function bot(ctx, method, p, body, headers) {
  const r = await fetch(ctx.botUrl + p, { method, headers: { 'content-type': 'application/json', 'x-api-key': ctx.internalKey, ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status, json };
}

// ── identity switches, and waiting until the bot has read them ───────────────────────────────────────────────────
//   off     today's path: Play → I'm new → a first name (no roster, no v2)
//   roster  web_quiz_roster_id = true: Play → the roll-number pad
//   v2      web_quiz_identity = "v2": name first (wq-identity.js)
// The bot caches both settings for 30 s, so after a change this fetches the page until its boot shows the new mode.
async function setMode(ctx, page, mode, code) {
  await ctx.sql("delete from app_settings where key in ('web_quiz_identity', 'web_quiz_roster_id')");
  if (mode === 'roster') await base.setSetting(ctx, 'web_quiz_roster_id', 'true');
  if (mode === 'v2') await base.setSetting(ctx, 'web_quiz_identity', '"v2"');
  const url = ctx.baseUrl + '/q/' + (code || CODES.OPEN);
  const deadline = Date.now() + 45000;
  let seen = null;
  while (Date.now() < deadline) {
    const html = await (await page.request.get(url)).text();
    const m = html.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/);
    const b = m ? JSON.parse(m[1]) : null;
    const cls = (b && b.cls) || {};
    seen = cls.identity && cls.identity.mode === 'v2' ? 'v2' : cls.roster ? 'roster' : 'off';
    if (seen === mode) return;
    await sleep(2000);
  }
  throw new Error('the bot still serves identity mode "' + seen + '" 45 s after setting "' + mode + '"');
}

// Any other app_settings switch the bot reads with a 30 s cache: set it, then either wait for `seen(boot)` to hold on
// the page's boot payload, or (for a switch that only shows at finish time) wait the cache out.
async function setFlag(ctx, page, key, value, seen, code) {
  if (value === null) await ctx.sql("delete from app_settings where key = " + q(key));
  else await base.setSetting(ctx, key, value);
  if (!seen) { await sleep(31000); return; }
  const url = ctx.baseUrl + '/q/' + (code || CODES.OPEN);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const html = await (await page.request.get(url)).text();
    const m = html.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/);
    if (m && seen(JSON.parse(m[1]))) return;
    await sleep(2000);
  }
  throw new Error('the bot still does not reflect ' + key + ' = ' + value + ' after 45 s');
}
// The bot's log for this run (pino JSON lines), for server-written events a scenario asserts.
// The bot, worker and portal write pino's pretty log: a header line, then one indented `key: value` line per field.
// Flattened here to ONE line per record, carrying each field twice — `key: value` and `"key":value` — so a driver can
// grep either way (`/"from":"drawn"/`, `/ok: true/`) without caring how the line was printed.
function flatLog(text) {
  const out = []; let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const m = /^\s+([A-Za-z_][\w.]*): (.*)$/.exec(line);
    if (cur && m && /^\s/.test(line)) { cur.fields.push(m[1] + ': ' + m[2]); cur.json.push(JSON.stringify(m[1]) + ':' + m[2]); continue; }
    if (cur) out.push(cur.head + ' ' + cur.fields.join(' ') + ' {' + cur.json.join(',') + '}');
    cur = line.trim() ? { head: line, fields: [], json: [] } : null;
    if (!cur) out.push(line);
  }
  if (cur) out.push(cur.head + ' ' + cur.fields.join(' ') + ' {' + cur.json.join(',') + '}');
  return out.join('\n');
}
function rawLog(ctx, name) { try { return require('fs').readFileSync(path.join(ctx.runDir, name), 'utf8'); } catch (_) { return ''; } }
function botLog(ctx) { return flatLog(rawLog(ctx, 'bot.log')); }
function workerLog(ctx) { return flatLog(rawLog(ctx, 'worker.log')); }
function portalLog(ctx) { return flatLog(rawLog(ctx, 'portal.log')); }

// ── opening the page ──────────────────────────────────────────────────────────────────────────────────────────────
const FIRST = '#wq-play, #wq-play-as, #wq-cont, .wq-scorecard, .wq-closed, .wq-kid-big, #wq-someone, #wq-card, #wq-sync, ' + onScreen('M3-teacher') + ', ' + onScreen('M6') + ', ' + onScreen('M4-name') + ', ' + onScreen('M4-class') + ', .wqc';
async function openQuiz(page, ctx, code, query) {
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + '/q/' + code + (query || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(FIRST, { state: 'visible', timeout: WAIT });
  return w;
}
// Today's path: Play → I'm new → a first name → Start → question 1. Returns the boot payload.
async function startAsNew(page, ctx, code, name) {
  await openQuiz(page, ctx, code);
  const b = await boot(page);
  // the landing of a phone that remembers one child is "Play as <name>" / "Not <name>?"; of several, the cards and
  // "Someone else"; of none, "Play" → "I'm new". Whichever it is, reach the typed-name path.
  await page.waitForSelector('#wq-play, #wq-notme, #wq-someone', { state: 'visible', timeout: WAIT });
  // "Not <name>?" opens "Who is playing?" (the phone's children and "I'm new"), not the landing again
  if (await page.$('#wq-notme')) { await tap(page, '#wq-notme'); await page.waitForSelector('#wq-someone, #wq-play, #wq-new, #wq-name', { state: 'visible', timeout: WAIT }); }
  if (!(await page.$('#wq-new')) && !(await page.$('#wq-name'))) {
    await tap(page, (await page.$('#wq-someone')) ? '#wq-someone' : '#wq-play');
    await page.waitForSelector('#wq-new, #wq-name', { state: 'visible', timeout: WAIT });
  }
  if (await page.$('#wq-new')) await tap(page, '#wq-new');
  await page.fill('#wq-name', name);
  await page.click('#wq-start');
  await page.waitForSelector(onScreen('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  return b;
}

// ── playing ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function current(page, questions) {
  const item = await inner(page, '.wq-item');
  let found = questions.find((x) => item.includes(x.text));
  if (!found) {
    // typeset maths reads differently from the payload's text: fall back to the counter ("Question 3 of 7")
    const qof = await inner(page, '.wq-qof').catch(() => '');
    const m = /(\d+)\s*(?:of|میں سے سوال)\s*(\d+)|(\d+) میں سے سوال (\d+)/.exec(qof);
    const n = m ? Number(m[1] || m[4]) : NaN;
    if (n >= 1 && n <= questions.length) found = questions[n - 1];
  }
  expect(found, 'the question on screen matches none of the quiz: "' + item.slice(0, 80) + '"');
  return found;
}
const wrongSlot = (qq) => { const right = String(qq.correct_slot).split(','); return qq.options.map((o) => o.slot).find((s) => !right.includes(s)) || qq.options[0].slot; };
// A plain click: a forced click on Next stalled after the page redrew it (run 20261016-161021, ~40 scenarios).
const tap = (page, sel) => page.click(sel);
async function tapAndNext(page, slot) {
  await tap(page, '.wq-opt[data-slot="' + slot + '"]');
  await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
  await tap(page, '#wq-next');
}
// Answer the question on screen RIGHT, whatever its kind (plain, picture, true/false, multi, order, match, label).
async function answerRight(page, qq) {
  const kind = await page.$eval('.wq-item', (e) => e.getAttribute('data-kind')).catch(() => 'single');
  const slots = String(qq.correct_slot).split(',');
  if (kind === 'multi') { for (const sl of slots) await tap(page, '.wq-opt[data-slot="' + sl + '"]'); await tap(page, '#wq-check'); }
  else if (kind === 'order') { for (const sl of slots) await tap(page, '.wq-pool .wq-opt[data-slot="' + sl + '"]'); await tap(page, '#wq-check'); }
  else if (kind === 'match') { for (const sl of slots) await tap(page, '.wq-mr[data-slot="' + sl + '"]'); await tap(page, '#wq-check'); }
  else if (kind === 'label' && await page.$('.wq-hot[data-slot]')) await tap(page, '.wq-hot[data-slot="' + slots[0] + '"]');
  else await tap(page, '.wq-opt[data-slot="' + slots[0] + '"]');
  await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
}
async function nextQ(page) { await tap(page, '#wq-next'); }
// og / meta content as the browser reads it (the server HTML-escapes & and ')
const unesc = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const og = (html, prop) => unesc((html.match(new RegExp('property="' + prop.replace(':', '\\:') + '" content="([^"]*)"')) || [])[1] || '');

// Answer `n` questions of the first pass, all right except the one at index `wrongAt` (−1 = none).
async function play(page, questions, n, wrongAt) {
  for (let i = 0; i < n; i++) {
    await page.waitForSelector(onScreen('M6') + ' .wq-item', { state: 'visible', timeout: WAIT });   // a match item has no .wq-opt
    const qq = await current(page, questions);
    if (questions.indexOf(qq) === wrongAt) await tapAndNext(page, wrongSlot(qq));
    else { await answerRight(page, qq); await nextQ(page); }               // kind-aware: multi/order/match need Check
  }
}
// From the first screen after the last answer (tricky or results) to the results screen, all right.
async function toResults(page) {
  await page.waitForSelector('#wq-fix, ' + onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
  if (await page.$('#wq-fix')) { await page.click('#wq-later'); }
  await page.waitForSelector(onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
  return inner(page, onScreen('M9') + ' h1');
}
// Play a whole quiz through to the results screen as a new child of today's path.
async function finishAsNew(page, ctx, code, name) {
  const b = await startAsNew(page, ctx, code, name);
  await play(page, b.quiz.questions, b.quiz.questions.length, -1);
  const got = await toResults(page);
  return { boot: b, result: got };
}

// ── a second phone, page storage, page events ────────────────────────────────────────────────────────────────────
async function newPhone(page) {
  const context = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
  const p = await context.newPage();
  return { page: p, close: () => context.close() };
}
const stored = (page, key) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, key);
// Write `wq_kids` (the children this phone remembers) before the page loads: visit a tiny same-origin page first.
async function remember(page, ctx, kids) {
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((k) => localStorage.setItem('wq_kids', JSON.stringify(k)), kids);
}
// A chip for a class-list child on a code, exactly as the bot computes it, with the animal the page would show.
async function chipFor(ctx, code, name) {
  const T = tokens(ctx);
  const sc = await codeRow(ctx, code), sid = await studentNamed(ctx, name);
  expect(sc && sid, 'no code/student for ' + code + ' / ' + name);
  return { chip: T.chipId(sc, sid), first: name.split(' ')[0], animal: T.animalFor(sid), studentId: sid, shareCodeId: sc };
}
// Capture the page's own events (POST /api/wq/e) — n, and the props the server allow-lists.
function events(page) {
  const list = [];
  page.on('request', (r) => {
    if (!/\/api\/wq\/e$/.test(new URL(r.url()).pathname) || r.method() !== 'POST') return;
    try { const b = JSON.parse(r.postData() || '{}'); for (const e of b.events || []) list.push(e); } catch (_) { /* not JSON */ }
  });
  return {
    list, of: (n) => list.filter((e) => e.n === n),
    // The page flushes its queue every 5 s (or at 10 queued, or on pagehide): wait one period.
    flush: async () => { await sleep(5600); },
  };
}

module.exports = { local, tap, flatLog, answerRight, nextQ, unesc, og, setFlag, botLog, workerLog, portalLog, expect, watch, WAIT, CODES, TOPIC, text, inner, count, boot, onScreen, screen, sleep, healthy,
  q, one, rows, codeRow, teacherOf, studentNamed, tokens, bot, setMode, openQuiz, startAsNew, current, wrongSlot,
  tapAndNext, play, toResults, finishAsNew, newPhone, stored, remember, chipFor, events, base };
