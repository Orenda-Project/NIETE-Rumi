// teacher-home-class-link — the hand-written teacher-home scenarios for Home's class link card: the card that shows each class's
// standing link with "Send to class group" and "Copy", folds once the link was sent this term, and (with the evening round on)
// names tonight's round and how many children played it. Joined to the generated teacher-home driver by
// .claude/qa/web/gen_page_features.py (EXTRA).
//
// Nothing is faked between the page and the server: GET /api/portal/class-link and POST /class-link/tap reach this run's
// bot (/api/internal/wq/cl/app*), which mints real class_links rows. What each scenario puts in place, on THIS run's own
// database and Redis only, and puts back afterwards:
//   · the switches web_quiz_class_link + its parents (web_quiz_challenge_v2, web_quiz_challenge), the canary
//     web_quiz_class_link_canary ({"all":true} unless the scenario narrows it) and web_quiz_evening_round. The bot caches
//     each for 30 s in-process, so every change is followed by polling GET /api/portal/class-link until it agrees;
//   · the demo teacher's second class, "Class 5" with no section (her seeded class is Class 3 A), with one child enrolled;
//   · for tonight's line, a READY evening round of Class 3 A as web-quiz-evening-round.js writes it (a quizzes row with
//     meta.source evening_round, its quiz_share_codes row) and completed quiz_sessions per child; the round cache key
//     wq:er:r:<day>:<class> (it remembers "no round" for 10 min) is cleared whenever the round changes;
//   · the "sent this term" Redis keys wq:cl:app:sent:<class>:<term> are cleared before and after.
// Schema: the local database is built from supabase/baseline/schema.sql plus the migrations its stamp
// (schema.migrations.txt) does not list. The stamp lists bot/database/migrations/web_quiz_class_link.sql although the copy
// has no class_links table, so the run's database lacks it (bd-q8wt5e.6.5 finding). Until the copy is re-cut, a scenario
// applies that migration file itself — the repo's own file, idempotent (IF NOT EXISTS), on this run's database only — and
// asks PostgREST to reload its schema. The evidence says when it did (schemaPatched).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DEMO, expect, asRole, watch, mock } = require('../lib.cjs');

const e164 = (p) => '92' + p.slice(1);
const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', 'bot', 'database', 'migrations', 'web_quiz_class_link.sql');
const KEYS = ['web_quiz_class_link', 'web_quiz_challenge_v2', 'web_quiz_challenge', 'web_quiz_class_link_canary', 'web_quiz_evening_round'];
const SWITCH_WAIT_MS = 45000; // the bot's 30 s caches, plus a margin
const LESSON = 'Adding two-digit numbers';
const ISO = /[⁦-⁩]/g; // the copy's bidi isolates
const strip = (s) => String(s || '').replace(ISO, '').replace(/\s+/g, ' ').trim();

const pktNow = (now = Date.now()) => new Date(now + 5 * 3600e3);
const pktDay = () => pktNow().toISOString().slice(0, 10);
/** web-quiz-class-link.js termOf: Apr–Sep is "a", Oct–Mar "b", of the school year starting in April. */
function termCode(offset = 0) {
  const d = pktNow();
  let y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1;
  let start = m >= 4 ? y : y - 1; let half = m >= 4 && m <= 9 ? 'a' : 'b';
  for (let i = 0; i < Math.abs(offset); i++) {
    if (offset < 0) { if (half === 'b') half = 'a'; else { half = 'b'; start -= 1; } }
    else if (half === 'a') half = 'b'; else { half = 'a'; start += 1; }
  }
  y = start;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}${half}`;
}

// ── this run's Redis (the third port in <run>/ports) ──────────────────────────────────────────────────────────────
function redis(ctx, ...args) {
  const port = fs.readFileSync(path.join(ctx.runDir, 'ports'), 'utf8').trim().split(/\s+/)[2];
  return String(execFileSync('redis-cli', ['-p', port, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })).trim();
}
const sentKey = (classId, term = termCode()) => `wq:cl:app:sent:${classId}:${term}`;
const roundKey = (classId) => `wq:er:r:${pktDay()}:${classId}`;

// ── the bot's own log: each tap writes quiz_forward_tap {surface class_link, method wa_me|copy} ──────────────────────
const botLog = (ctx) => fs.readFileSync(path.join(ctx.runDir, 'bot.log'), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
function tapsSince(ctx, offset) {
  const text = botLog(ctx).slice(offset);
  const out = [];
  for (const block of text.split(/\n(?=\[\d{4}-)/)) {
    if (!/event: "quiz_forward_tap"/.test(block) || !/surface: "class_link"/.test(block)) continue;
    out.push((block.match(/method: "([a-z_]+)"/) || [])[1]);
  }
  return out;
}

async function ensureSchema(ctx) {
  if ((await ctx.sql("select to_regclass('public.class_links') is not null")) === 't') return false;
  await ctx.sql(fs.readFileSync(MIGRATION, 'utf8'));
  await ctx.sql("notify pgrst, 'reload schema'");
  await new Promise((r) => setTimeout(r, 2000));
  return true;
}

async function setKey(ctx, key, json) {
  await ctx.sql('insert into app_settings (key, value) values (' + q(key) + ', ' + q(json) + '::jsonb) '
    + 'on conflict (key) do update set value = excluded.value, updated_at = now()');
}

/**
 * The demo teacher with the class link set up as `opts` says, then everything put back:
 *   on (class link + parents), canary (a JSON value, default {"all":true}), evening (the evening round), lang.
 * body gets { t: teacher id, c3: Class 3 A's id, c5: Class 5's id, kids3: Class 3 A's children, other: another teacher's class }.
 */
async function withClassLink(ctx, opts, body) {
  const o = { on: true, canary: '{"all":true}', evening: false, lang: 'en', ...opts };
  const schemaPatched = await ensureSchema(ctx);
  const [t, prevLang] = (await ctx.sql('select id, preferred_language from users where phone_number = ' + q(e164(DEMO.teacher)))).split('|');
  expect(t, 'no demo teacher ' + DEMO.teacher);
  const [c3, school, session] = (await ctx.sql('select c.id, c.school_id, c.session_code from classes c join class_teachers ct on ct.class_id = c.id '
    + 'and ct.is_active where ct.teacher_user_id = ' + q(t) + " and c.grade_code = 'grade_3' and c.section = 'A' and c.is_active limit 1")).split('|');
  expect(c3, 'the demo teacher has no Class 3 A in this run\'s database');
  const kids3 = (await ctx.sql('select student_id from class_enrollments where class_id = ' + q(c3) + ' and is_active order by roll_number')).split('\n').filter(Boolean);
  const other = (await ctx.sql('select ct.class_id from class_teachers ct where ct.is_active and ct.teacher_user_id <> ' + q(t)
    + ' and not exists (select 1 from class_teachers m where m.class_id = ct.class_id and m.teacher_user_id = ' + q(t) + ') limit 1')).trim();
  const prev = {};
  for (const k of KEYS) prev[k] = await ctx.sql('select value::text from app_settings where key = ' + q(k));
  const linksBefore = (await ctx.sql('select code from class_links')).split('\n').filter(Boolean);
  let c5 = null;
  const clearRedis = (ids) => { for (const id of ids) { redis(ctx, 'del', sentKey(id), sentKey(id, termCode(-1)), roundKey(id)); } };
  try {
    c5 = (await ctx.sql('insert into classes (school_id, grade_code, section, session_code, is_active, created_by_user_id) values ('
      + q(school) + ", 'grade_5', null, " + q(session) + ', true, ' + q(t) + ') returning id')).trim();
    await ctx.sql('insert into class_teachers (class_id, teacher_user_id, is_class_teacher, is_active) values (' + q(c5) + ', ' + q(t) + ', true, true)');
    await ctx.sql('insert into class_enrollments (class_id, student_id, roll_number, is_active) values (' + q(c5) + ', ' + q(kids3[0]) + ', 1, true)');
    clearRedis([c3, c5, other].filter(Boolean));
    await setKey(ctx, 'web_quiz_class_link', o.on ? 'true' : 'false');
    await setKey(ctx, 'web_quiz_challenge_v2', 'true');
    await setKey(ctx, 'web_quiz_challenge', 'true');
    await setKey(ctx, 'web_quiz_class_link_canary', typeof o.canary === 'function' ? o.canary({ c3, c5 }) : o.canary);
    await setKey(ctx, 'web_quiz_evening_round', o.evening ? 'true' : 'false');
    await ctx.sql('update users set preferred_language = ' + q(o.lang) + ' where id = ' + q(t));
    return await body({ t, c3, c5, kids3, other, schemaPatched });
  } finally {
    await ctx.sql("delete from quiz_sessions where share_code_id in (select id from quiz_share_codes where code like 'E2ECL%')");
    await ctx.sql("delete from quiz_share_codes where code like 'E2ECL%'");
    await ctx.sql("delete from quizzes where meta->>'e2e' = 'class-link'");
    await ctx.sql('delete from class_links' + (linksBefore.length ? ' where code not in (' + linksBefore.map(q).join(', ') + ')' : ''));
    if (c5) {
      await ctx.sql('delete from class_enrollments where class_id = ' + q(c5));
      await ctx.sql('delete from class_teachers where class_id = ' + q(c5));
      await ctx.sql('delete from classes where id = ' + q(c5));
    }
    clearRedis([c3, c5, other].filter(Boolean));
    for (const k of KEYS) {
      if (prev[k]) await ctx.sql('update app_settings set value = ' + q(prev[k]) + '::jsonb, updated_at = now() where key = ' + q(k));
      else await ctx.sql('delete from app_settings where key = ' + q(k));
    }
    await ctx.sql('update users set preferred_language = ' + q(prevLang || null) + ' where id = ' + q(t));
  }
}

/** Poll the portal's own GET /api/portal/class-link (her session) until `ok(status, body)`: the bot's switch caches. */
async function until(page, ctx, ok, what) {
  const deadline = Date.now() + SWITCH_WAIT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const r = await page.request.get(ctx.baseUrl + '/api/portal/class-link');
    let b = null; try { b = await r.json(); } catch (_) { /* not JSON */ }
    last = { status: r.status(), body: b };
    if (ok(last.status, b)) return last;
    await page.waitForTimeout(1500);
  }
  throw new Error('the class link answer never reached "' + what + '" (last: ' + JSON.stringify(last).slice(0, 300) + ')');
}
const classesOf = (b) => (b && Array.isArray(b.classes) ? b.classes : []);
const has = (b, id) => classesOf(b).some((c) => c.classId === id);
const cls = (b, id) => classesOf(b).find((c) => c.classId === id) || null;

async function signIn(page, ctx) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ctx.baseUrl });
  // wa.me never leaves the machine: a new tab to it gets a stub, and its address is what is checked
  await page.context().route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>wa.me</p>' }));
  await asRole(page, ctx, 'teacher', 'teacherV2');
}
async function home(page, ctx) {
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + '/portal/teacher', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('feature-tiles').waitFor({ timeout: 20000 });
  return w;
}
const card = (page) => page.getByTestId('class-link-card');
// Home where the card is expected: the card is drawn after its own read, so it is waited for; one reload when a read was
// lost (a shared local stack under load), never more — a card that is still missing fails the step that needs it.
async function homeCard(page, ctx) {
  const w = await home(page, ctx);
  if (await card(page).waitFor({ timeout: 15000 }).then(() => true, () => false)) return w;
  return home(page, ctx);
}
// a block by its class label; the label may carry bidi isolates (ui/bidi), so any may sit between its characters
const labelRx = (label) => new RegExp('^[\\u2066-\\u2069]*' + [...label].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\u2066-\\u2069]*').join('') + '$');
const block = (page, label) => page.getByTestId('class-link-class').filter({ has: page.locator('p, span').getByText(labelRx(label)) });
async function blockText(page, label) { return strip(await block(page, label).innerText()); }
async function cardOrNone(page) { await page.waitForTimeout(2500); return card(page).count(); }

// a READY evening round of `classId` today, as the round writer leaves it; `played` children completed it (`twice`: the
// first one twice, to prove a child counts once)
async function seedRound(ctx, { t, classId, topic, kids = [], twice = false }) {
  const code = 'E2ECL' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const quiz = (await ctx.sql('insert into quizzes (teacher_id, quiz_source, topic, status, language, meta) values (' + q(t) + ", 'lp_v8', "
    + q(topic) + ", 'ready', 'en', '{}'::jsonb) returning id")).trim();
  const sc = (await ctx.sql('insert into quiz_share_codes (code, quiz_id, teacher_user_id, topic, class_id) values (' + q(code) + ', ' + q(quiz) + ', '
    + q(t) + ', ' + q(topic) + ', ' + q(classId) + ') returning id')).trim();
  const meta = { e2e: 'class-link', source: 'evening_round', round_day: pktDay(), class_id: classId, round_code: code, share_code_id: sc,
    round_ready_at: new Date().toISOString(), n_items: 6, n_recall: 2 };
  await ctx.sql('update quizzes set meta = ' + q(JSON.stringify(meta)) + '::jsonb where id = ' + q(quiz));
  for (const [i, k] of kids.entries()) {
    for (let n = 0; n < (twice && i === 0 ? 2 : 1); n++) {
      await ctx.sql('insert into quiz_sessions (quiz_id, student_id, status, completed_at, expires_at, share_code_id, source) values ('
        + q(quiz) + ', ' + q(k) + ", 'completed', now(), now() + interval '1 day', " + q(sc) + ", 'share_link')");
    }
  }
  redis(ctx, 'del', roundKey(classId));
  return { quiz, sc, code };
}
async function playedBy(ctx, round, kids) {
  for (const k of kids) {
    await ctx.sql('insert into quiz_sessions (quiz_id, student_id, status, completed_at, expires_at, share_code_id, source) values ('
      + q(round.quiz) + ', ' + q(k) + ", 'completed', now(), now() + interval '1 day', " + q(round.sc) + ", 'share_link')");
  }
}

// The report's own class-tab Forward / Copy (/r/<token>/jlink), with a report token the run's bot would sign.
function reportToken(ctx, teacherId) {
  const saved = { k: process.env.INTERNAL_API_KEY, s: process.env.WEB_QUIZ_TOKEN_SECRET };
  try {
    process.env.INTERNAL_API_KEY = ctx.internalKey; delete process.env.WEB_QUIZ_TOKEN_SECRET;
    return require(path.join(ctx.runDir, 'src', 'bot', 'shared', 'services', 'quiz', 'teacher-report-token.js')).signTeacherReport({ teacherId });
  } finally {
    if (saved.k === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = saved.k;
    if (saved.s !== undefined) process.env.WEB_QUIZ_TOKEN_SECRET = saved.s;
  }
}

// ── TH19 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function th19(page, ctx) {
  return withClassLink(ctx, {}, async ({ t, c3, c5, schemaPatched }) => {
    await signIn(page, ctx);
    const ans = await until(page, ctx, (s, b) => s === 200 && has(b, c3) && has(b, c5), 'Class 3 A and Class 5 listed');
    const outbox = await mock(ctx, 'GET', '/outbox?to=' + e164(DEMO.teacher));
    const w = await homeCard(page, ctx);
    await card(page).waitFor({ timeout: 20000 });
    expect(strip(await card(page).locator('h2').innerText()) === 'Your class link', 'the card should be headed "Your class link"');
    // order: after the evening reminder card (when drawn) and after the tiles; the card is the last thing on Home
    const order = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="class-link-card"]');
      const after = (sel) => { const el = document.querySelector(sel); return el ? !!(el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) : null; };
      return { tiles: after('[data-testid="feature-tiles"]'), remind: after('[data-testid="remind-card"]') };
    });
    expect(order.tiles === true && order.remind !== false, 'the card should come after the tiles and the evening reminder card, got ' + JSON.stringify(order));
    const labels = (await page.getByTestId('class-link-class').evaluateAll((els) => els.map((e) => e.querySelector('p').innerText)));
    expect(JSON.stringify(labels.map(strip)) === '["Class 3 A","Class 5"]', 'one block per class, "Class 3 A" then "Class 5", got ' + JSON.stringify(labels));
    const body = 'One link for this term. Send it once to your class group.';
    expect((await card(page).getByText(body, { exact: true }).count()) === 1, 'the sentence should be shown once');
    expect((await block(page, 'Class 3 A').getByText(body, { exact: true }).count()) === 1, 'the sentence should be in Class 3 A, the first class still to send');
    for (const [label, id] of [['Class 3 A', c3], ['Class 5', c5]]) {
      const url = cls(ans.body, id).url;
      const shown = await block(page, label).getByTestId('class-link-url').innerText();
      expect(shown === url.replace(/^https:\/\//, '') && !/https:\/\//.test(shown), label + ': the link should show without https://, got ' + shown);
      for (const id2 of ['class-link-send', 'class-link-copy']) {
        const box = await block(page, label).getByTestId(id2).boundingBox();
        expect(box && box.height >= 56, label + ': ' + id2 + ' should be at least 56 px tall, is ' + (box && box.height));
      }
    }
    const url3 = cls(ans.body, c3).url;
    // Copy first (Send folds the block): the whole link on the clipboard, the button says Copied
    let logAt = botLog(ctx).length;
    await block(page, 'Class 5').getByTestId('class-link-copy').click();
    await block(page, 'Class 5').getByText('Copied', { exact: true }).waitFor({ timeout: 5000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip === cls(ans.body, c5).url, 'the clipboard should hold the whole link, got ' + clip);
    await page.waitForTimeout(1500);
    const copyTaps = tapsSince(ctx, logAt);
    expect(JSON.stringify(copyTaps) === '["copy"]', 'Copy should be logged once as the report\'s Copy is (quiz_forward_tap, surface class_link, method copy), got ' + JSON.stringify(copyTaps));
    // Send: WhatsApp's share in a new tab, the class link alone as the text, ?f=1
    logAt = botLog(ctx).length;
    const [tab] = await Promise.all([page.context().waitForEvent('page'), block(page, 'Class 3 A').getByTestId('class-link-send').click()]);
    await tab.waitForLoadState('domcontentloaded').catch(() => {});
    const shared = new URL(tab.url());
    expect(shared.host === 'wa.me', 'Send should open wa.me in a new tab, opened ' + tab.url());
    expect(shared.searchParams.get('text') === url3 + '?f=1', 'the share text should be the class link alone with ?f=1, got ' + shared.searchParams.get('text'));
    await tab.close();
    await page.waitForTimeout(1500);
    const sendTaps = tapsSince(ctx, logAt);
    expect(JSON.stringify(sendTaps) === '["wa_me"]', 'Send should be logged once as the report\'s Forward is (method wa_me), got ' + JSON.stringify(sendTaps));
    const after = await mock(ctx, 'GET', '/outbox?to=' + e164(DEMO.teacher) + '&after=' + outbox.last);
    expect(!(after.items || []).length, 'Home should send no WhatsApp message itself, sent ' + (after.items || []).length);
    expect(!w.errors.length && !w.fivexx.length, 'no page error or 5xx: ' + JSON.stringify(w));
    return { schemaPatched, classes: labels.map(strip), shared: shared.searchParams.get('text'), taps: [...copyTaps, ...sendTaps] };
  });
}

// ── TH20 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function th20(page, ctx) {
  return withClassLink(ctx, {}, async ({ t, c3, c5, schemaPatched }) => {
    await signIn(page, ctx);
    const ans = await until(page, ctx, (s, b) => s === 200 && has(b, c3) && has(b, c5), 'Class 3 A and Class 5 listed');
    await homeCard(page, ctx);
    await card(page).waitFor({ timeout: 20000 });
    const [tab] = await Promise.all([page.context().waitForEvent('page'), block(page, 'Class 3 A').getByTestId('class-link-send').click()]);
    await tab.close();
    const folded = async (label) => {
      const b = block(page, label);
      await b.getByTestId('class-link-sent').waitFor({ timeout: 10000 });
      const text = await blockText(page, label);
      expect(/Class link sent/.test(text) && /Send again/.test(text), label + ' should fold to "Class link sent" and "Send again", got ' + text);
      expect(!(await b.getByTestId('class-link-url').count()) && !(await b.getByTestId('class-link-copy').count()) && !/One link for this term/.test(text),
        label + ': its link, Copy and the sentence should be gone');
      return b.getByTestId('class-link-send').getAttribute('href');
    };
    const again = await folded('Class 3 A');
    expect(again === cls(ans.body, c3).sendHref, 'Send again should carry the same share link, got ' + again);
    expect(await block(page, 'Class 5').getByTestId('class-link-copy').count() === 1, 'Class 5 should keep its full block');
    // later in the term: Home again, from the server's memory of the tap
    await until(page, ctx, (s, b) => s === 200 && cls(b, c3) && cls(b, c3).sent === true, 'Class 3 A sent');
    await homeCard(page, ctx); await card(page).waitFor({ timeout: 20000 });
    await folded('Class 3 A');
    // Class 5 sent from the class tab of her WhatsApp report: Forward, then (unfolded again) Copy
    const token = reportToken(ctx, t);
    expect(token, 'the run\'s bot would not sign a report link');
    for (const how of ['forward', 'copy']) {
      redis(ctx, 'del', sentKey(c5));
      const r = await page.request.get(ctx.baseUrl + '/r/' + encodeURIComponent(token) + '/jlink?class=' + c5 + '&how=' + how, { maxRedirects: 0 });
      expect(r.status() === (how === 'copy' ? 303 : 302), 'the report\'s ' + how + ' should answer ' + (how === 'copy' ? 303 : 302) + ', got ' + r.status());
      await homeCard(page, ctx); await card(page).waitFor({ timeout: 20000 });
      await folded('Class 5');
    }
    // the next term: a class marked sent in another term is a full block again. The bot reads the term from its own
    // clock, so the run moves the mark instead: Class 5's mark is set under the LAST term only.
    redis(ctx, 'del', sentKey(c3), sentKey(c5));
    redis(ctx, 'set', sentKey(c5, termCode(-1)), JSON.stringify({ at: Date.now() }));
    await homeCard(page, ctx); await card(page).waitFor({ timeout: 20000 });
    for (const label of ['Class 3 A', 'Class 5']) expect(await block(page, label).getByTestId('class-link-copy').count() === 1, label + ' should be a full block in a new term');
    return { schemaPatched, sendAgain: again };
  });
}

// ── TH21 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function th21(page, ctx) {
  return withClassLink(ctx, { evening: true }, async ({ t, c3, c5, kids3, schemaPatched }) => {
    await signIn(page, ctx);
    redis(ctx, 'set', sentKey(c3), JSON.stringify({ at: Date.now() })); // "whose link was sent this term"
    await until(page, ctx, (s, b) => s === 200 && cls(b, c3) && cls(b, c3).sent && cls(b, c3).round === null, 'Class 3 A sent, no round');
    await homeCard(page, ctx); await card(page).waitFor({ timeout: 20000 });
    expect(!(await block(page, 'Class 3 A').getByTestId('class-link-round').count()), 'no round yet: no round line');
    expect(!/\d{1,2}:\d\d|\b\d{1,2}\s*(am|pm)\b|o'clock/i.test(await blockText(page, 'Class 3 A')), 'with no round the block promises no time');
    const round = await seedRound(ctx, { t, classId: c3, topic: LESSON });
    await until(page, ctx, (s, b) => cls(b, c3) && cls(b, c3).round && cls(b, c3).round.played === 0, 'tonight\'s round ready');
    await homeCard(page, ctx);
    const line = () => block(page, 'Class 3 A').getByTestId('class-link-round').locator('p').first();
    await line().waitFor({ timeout: 15000 });
    const ready = `Tonight's class quiz is ready, from today's lesson: ${LESSON}. It is on your class link: nothing to send.`;
    expect(strip(await line().innerText()) === ready, 'the ready line, got ' + strip(await line().innerText()));
    await ctx.sql("update quizzes set topic = 'Lesson' where id = " + q(round.quiz)); // the writer's topic for a lesson with none
    await homeCard(page, ctx); await line().waitFor({ timeout: 15000 });
    const noLesson = "Tonight's class quiz is ready, from today's lesson. It is on your class link: nothing to send.";
    expect(strip(await line().innerText()) === noLesson, 'the ready line with no lesson title, got ' + strip(await line().innerText()));
    // one child, then every child, the first of them twice: each child counted once
    await playedBy(ctx, round, [kids3[0]]);
    await homeCard(page, ctx); await line().waitFor({ timeout: 15000 });
    expect(strip(await line().innerText()) === "1 child played tonight's quiz", 'one child: ' + strip(await line().innerText()));
    await playedBy(ctx, round, kids3); // kids3[0] plays a second time
    await homeCard(page, ctx); await line().waitFor({ timeout: 15000 });
    const n = kids3.length;
    expect(strip(await line().innerText()).startsWith(`${n} children played tonight's quiz`), `${n} children (one played twice) should read "${n} children played tonight's quiz", got ` + strip(await line().innerText()));
    const names = (await ctx.sql('select student_name from students where id in (' + kids3.map(q).join(', ') + ')')).split('\n').filter(Boolean);
    const cardText = await card(page).innerText();
    expect(!names.some((nm) => cardText.includes(nm) || cardText.includes(nm.split(' ')[0])), 'no child\'s name may be on Home');
    const see = block(page, 'Class 3 A').getByTestId('class-link-report');
    expect(strip(await see.innerText()) === 'See evening rounds' && (await see.getAttribute('target')) === '_blank', '"See evening rounds" in a new tab');
    // The address it opens: the report's class tab at Evening rounds. This run's bot builds report links on its web base
    // (https://localhost:<port>) while the local portal serves plain http, so the new tab is checked by its address and the
    // same page is then opened over the run's own http base.
    const href = await see.getAttribute('href');
    const opened = new URL(href);
    expect(/^\/r\/[^/]+$/.test(opened.pathname) && opened.searchParams.get('tab') === 'class' && opened.hash === '#evening-rounds',
      '"See evening rounds" should open the report\'s class tab at Evening rounds, links to ' + opened.pathname.replace(/\/r\/.+/, '/r/<token>') + opened.search + opened.hash);
    const [tab] = await Promise.all([page.context().waitForEvent('page'), see.click()]);
    await tab.close();
    const report = await page.request.get(ctx.baseUrl + opened.pathname + opened.search);
    const status = report.status();
    expect(status < 500 && /evening-rounds/.test(await report.text()), 'the report\'s class tab should open with its Evening rounds section, answered ' + status);
    // the evening round off: no round line, even with the round written
    await setKey(ctx, 'web_quiz_evening_round', 'false');
    await until(page, ctx, (s, b) => cls(b, c3) && cls(b, c3).round === null, 'no round with the evening round off');
    await homeCard(page, ctx); await card(page).waitFor({ timeout: 20000 });
    expect(!(await block(page, 'Class 3 A').getByTestId('class-link-round').count()), 'with the evening round off the block has no round line');
    return { schemaPatched, children: n, reportStatus: status };
  });
}

// ── TH22 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function th22(page, ctx) {
  return withClassLink(ctx, { on: false }, async ({ t, c3, c5, other, schemaPatched }) => {
    const minted = async (id) => Number(await ctx.sql('select count(*) from class_links where class_id = ' + q(id)));
    await signIn(page, ctx);
    // off: no card, the read answers not found, no link minted
    await until(page, ctx, (s) => s === 404, 'off (404)');
    // a read made while the bot still held the last scenario's "on" (its 30 s cache) may have minted: start from none
    await ctx.sql('delete from class_links where class_id in (' + q(c3) + ', ' + q(c5) + ')');
    let w = await home(page, ctx);
    expect(!(await cardOrNone(page)), 'with the class link off Home draws no class link card');
    expect(await minted(c3) === 0 && await minted(c5) === 0, 'off: no link may be minted');
    expect(!w.errors.length, 'no page error: ' + w.errors[0]);
    // on, the canary naming only Class 5: no Class 3 A block, no link minted for it, Class 5 drawn
    await setKey(ctx, 'web_quiz_class_link_canary', JSON.stringify({ class_ids: [c5] }));
    await setKey(ctx, 'web_quiz_class_link', 'true');
    await until(page, ctx, (s, b) => s === 200 && has(b, c5) && !has(b, c3), 'canary: Class 5 only');
    await homeCard(page, ctx); await card(page).waitFor({ timeout: 20000 });
    expect(await block(page, 'Class 5').count() === 1 && await block(page, 'Class 3 A').count() === 0, 'only Class 5, inside the canary, is drawn');
    expect(await minted(c3) === 0, 'no link may be minted for Class 3 A, outside the canary');
    // a canary that cannot be read (a value that is not the canary's shape): every class left out
    await setKey(ctx, 'web_quiz_class_link_canary', '"not a canary"');
    await until(page, ctx, (s, b) => s === 200 && !classesOf(b).length, 'unreadable canary: no class');
    w = await home(page, ctx);
    expect(!(await cardOrNone(page)), 'an unreadable canary leaves every class out: no card');
    await setKey(ctx, 'web_quiz_class_link_canary', '{"all":true}');
    await until(page, ctx, (s, b) => s === 200 && has(b, c3), 'canary all');
    // a teacher with no class: her class rows switched off for the moment
    await ctx.sql('update class_teachers set is_active = false where teacher_user_id = ' + q(t) + ' and class_id in (' + q(c3) + ', ' + q(c5) + ')');
    try {
      await until(page, ctx, (s, b) => !classesOf(b).length, 'no class');
      w = await home(page, ctx);
      expect(!(await cardOrNone(page)) && !w.errors.length, 'a teacher with no class sees no card and no error');
    } finally {
      await ctx.sql('update class_teachers set is_active = true where teacher_user_id = ' + q(t) + ' and class_id in (' + q(c3) + ', ' + q(c5) + ')');
    }
    // a malformed answer: no card, no error
    await page.route('**/api/portal/class-link', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"classes":[{"classId":7,"url":"ftp://x"}],"reportHref":5}' }));
    w = await home(page, ctx);
    expect(!(await cardOrNone(page)) && !w.errors.length, 'a malformed answer draws no card and no error');
    await page.unroute('**/api/portal/class-link');
    // only her own classes: a teacher or user_id in the query is dropped, and a Send on another teacher's class is not found
    expect(other, 'no other teacher\'s class in this run\'s database');
    const otherTeacher = (await ctx.sql('select teacher_user_id from class_teachers where class_id = ' + q(other) + ' and is_active limit 1')).trim();
    const asked = await page.request.get(ctx.baseUrl + '/api/portal/class-link?teacher=' + otherTeacher + '&user_id=' + otherTeacher);
    const askedBody = await asked.json();
    expect(!has(askedBody, other) && has(askedBody, c3), 'the signed-in session decides who she is: another teacher\'s class is never listed');
    const logAt = botLog(ctx).length;
    const tap = await page.request.post(ctx.baseUrl + '/api/portal/class-link/tap', { data: { classId: other, how: 'forward', teacher: otherTeacher } });
    expect(tap.status() === 404, 'a Send on another teacher\'s class should answer 404, got ' + tap.status());
    await page.waitForTimeout(1000);
    expect(!tapsSince(ctx, logAt).length, 'nothing may be logged for another teacher\'s class');
    expect(!redis(ctx, 'get', sentKey(other)), 'another teacher\'s class may not be folded');
    return { schemaPatched, offStatus: 404 };
  });
}

// ── TH23 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function th23(page, ctx) {
  return withClassLink(ctx, { evening: true, lang: 'ur' }, async ({ t, c3, c5, kids3, schemaPatched }) => {
    await signIn(page, ctx);
    const round = await seedRound(ctx, { t, classId: c3, topic: LESSON });
    await until(page, ctx, (s, b) => s === 200 && cls(b, c3) && cls(b, c3).round && !cls(b, c3).sent, 'Class 3 A not sent, round ready');
    const w = await homeCard(page, ctx);
    await card(page).waitFor({ timeout: 20000 });
    expect(strip(await card(page).locator('h2').innerText()) === 'آپ کا کلاس لنک', 'the card should be headed «آپ کا کلاس لنک», got ' + strip(await card(page).locator('h2').innerText()));
    const b3 = block(page, 'کلاس 3 A');
    expect(await b3.count() === 1, 'a block headed «کلاس 3 A» in Western digits');
    expect(strip(await b3.getByTestId('class-link-send').innerText()) === 'کلاس گروپ میں بھیجیں', 'Send should read «کلاس گروپ میں بھیجیں»');
    expect(strip(await b3.getByTestId('class-link-copy').innerText()) === 'کاپی کریں', 'Copy should read «کاپی کریں»');
    const line = () => block(page, 'کلاس 3 A').getByTestId('class-link-round').locator('p').first();
    const ready = strip(await line().innerText());
    expect(ready.startsWith('آج شام کا کلاس کوئز تیار ہے، آج کے سبق سے:') && ready.includes(LESSON), 'tonight\'s line in Urdu with the lesson title as written, got ' + ready);
    const [tab] = await Promise.all([page.context().waitForEvent('page'), b3.getByTestId('class-link-send').click()]);
    await tab.close();
    await b3.getByTestId('class-link-sent').waitFor({ timeout: 10000 });
    const folded = await blockText(page, 'کلاس 3 A');
    expect(folded.includes('کلاس لنک بھیجا گیا') && folded.includes('دوبارہ بھیجیں'), 'the block should fold to «کلاس لنک بھیجا گیا» and «دوبارہ بھیجیں», got ' + folded);
    await playedBy(ctx, round, kids3);
    await homeCard(page, ctx); await line().waitFor({ timeout: 15000 });
    const played = strip(await line().innerText());
    expect(played.startsWith(kids3.length + ' بچوں نے آج شام کا کوئز کھیلا'), 'the count should read «… بچوں نے آج شام کا کوئز کھیلا», got ' + played);
    const see = block(page, 'کلاس 3 A').getByTestId('class-link-report');
    expect(strip(await see.innerText()) === 'شام کے راؤنڈ دیکھیں', 'under it «شام کے راؤنڈ دیکھیں»');
    const above = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="class-link-round"]');
      const p = r.querySelector('p').getBoundingClientRect(); const a = r.querySelector('[data-testid="class-link-report"]').getBoundingClientRect();
      return p.bottom <= a.top + 1;
    });
    expect(above, 'the count should sit above «شام کے راؤنڈ دیکھیں»');
    expect(!w.errors.length && !w.fivexx.length, 'no page error or 5xx: ' + JSON.stringify(w));
    return { schemaPatched, ready, played };
  });
}

const scenarios = [
  { id: "TH19", title: "Teacher app v2: with the class link on, Home shows \"Your class link\" with each class, its link, \"Send to class group\" and \"Copy\"", run: th19 },
  { id: "TH20", title: "Teacher app v2: once a class's link was sent this term, its block folds to \"Class link sent\" with \"Send again\"", run: th20 },
  { id: "TH21", title: "Teacher app v2: tonight's line shows only when the class's round is ready, then how many children played, never who", run: th21 },
  { id: "TH22", title: "Teacher app v2: with the class link off, Home is the Home before; a class outside the canary, or another teacher's class, gets no card", run: th22 },
  { id: "TH23", title: "Teacher app v2: the class link card reads in Urdu for a teacher whose language is Urdu", run: th23 },
];

module.exports = scenarios;
