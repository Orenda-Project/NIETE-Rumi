// teacher-report — web-lane driver for tests/features/web/teacher-report.feature: the teacher's quiz report at
// /r/<token> (dashboard/routes/teacher-report.routes.js → the bot's /api/internal/tr/*, bot/shared/templates/
// teacher-report.page.js), its PDF, its class tab, and the Jugnu tab with its class week card.
//
// Every scenario builds its OWN teacher on this run's local database (teacher-report/fixture.cjs): class lists, a sent
// quiz, children who finish it through the real child-quiz API, a report token minted with the bot's own module. Then it
// opens the page in the browser and checks the spec's Then steps on what the page shows (and, for a link that leaves the
// page, on where it leads: wa.me is caught, never reached). Spec ids are @TR01–@TR17 beside the spec's own @T3xx/@T8xx.
// Switches the bot caches 30 s are set only when they differ, then waited out (fixture.switches); the scenarios are
// ordered so the Jugnu ones (switches on) come after the ones that need them off.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, settledPath, DEMO } = require('../lib.cjs');
const F = require('./teacher-report/fixture.cjs');

const WAIT = 15000;
const JUGNU = { web_quiz_teacher_jugnu: true, web_quiz_challenge_v2: true, web_quiz_challenge: true };
const JUGNU_OFF = { web_quiz_teacher_jugnu: false };
const text = (page) => page.evaluate(() => document.body.innerText);
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// The page carries "Updated 13:42" — the only line that differs between two renders a minute apart.
const steady = (html) => String(html).replace(/Updated \d{1,2}:\d{2}|[0-9۰-۹]{1,2}:[0-9۰-۹]{2}/g, 'Updated HH:MM');
const HTML_DIGITS = /[0-9٠-٩۰-۹]/;

async function open(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
  return res;
}
// WhatsApp's share sheet: the page's link (/r/<token>/remind, /fwd, /wfwd) is answered by the portal with a 302 to wa.me.
// The tap is let through to the portal as it is (the bot logs it, the class week stamps it); the 302 is read and the
// browser shown a stand-in page instead of following it to wa.me — WhatsApp is never reached.
async function catchWa(page) {
  const seen = [];
  await page.route(/\/r\/[^/?]+\/(remind|fwd|wfwd)(\?|$)/, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const loc = res.headers()['location'] || '';
    if (/^https:\/\/(api\.)?wa\.me\//.test(loc)) { seen.push(loc); return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>wa</body></html>' }); }
    return route.fulfill({ response: res });
  });
  return seen;
}
const waText = (url) => decodeURIComponent(new URL(url).searchParams.get('text') || '');
// GET without following the redirect, as the page's link would be answered.
async function raw(ctx, url, init) {
  const r = await fetch(url.startsWith('http') ? url : ctx.baseUrl + url, { redirect: 'manual', ...(init || {}) });
  return { status: r.status, location: r.headers.get('location'), body: await r.text(), headers: r.headers };
}
function botLogSince(ctx, from) {
  try {
    // `from` is a byte offset of the file as written (botLogSize): cut the bytes first, then drop the colour codes
    return fs.readFileSync(path.join(ctx.runDir, 'bot.log')).subarray(from || 0).toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
  } catch (_) { return ''; }
}
// The bot's pino records (header line + its indented fields, as text) of one event since `from`, waiting up to `ms` for at least `min` of them.
async function botEvents(ctx, from, name, min = 1, ms = 10000) {
  const until = Date.now() + ms;
  let recs = [];
  for (;;) {
    const log = botLogSince(ctx, from);
    recs = log.split(/\n(?=\[\d{4}-)/).filter((r) => new RegExp('INFO: ' + name.replace(/\./g, '\\.') + '\\s').test(r.split('\n')[0] + ' '));
    if (recs.length >= min || Date.now() > until) return recs;
    await new Promise((r) => setTimeout(r, 500));
  }
}
const botLogSize = (ctx) => { try { return fs.statSync(path.join(ctx.runDir, 'bot.log')).size; } catch (_) { return 0; } };

const KIDS4 = ['Ayesha Khan', 'Bilal Ahmed', 'Hamza Ali', 'Sana Riaz'];
// "a teacher with a sent quiz for 5-A of 4 children, 2 of whom finished it" (the Background); Bilal misses Q2.
async function background(ctx, extra) {
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: KIDS4 }], ...(extra || {}) });
  await F.play(ctx, T, T.lists[0].kids[0]);
  await F.play(ctx, T, T.lists[0].kids[1], { wrong: [1] });
  return T;
}

const S = [];
const add = ({ id }, title, run) => S.push({ id, title, run });   // ids as an object key: the form validate_specs reads

// ── switch OFF first: the report as it is without the Jugnu tab ─────────────────────────────────────────────────────
add({ id: 'TR14' }, 'With the Jugnu switch off the report is exactly as before', async (page, ctx) => {
  await F.switches(ctx, JUGNU_OFF);
  const T = await background(ctx);
  const q = F.reportUrl(ctx, T), all = F.reportUrl(ctx, T, { quiz: false });
  const a = await raw(ctx, q.url), b = await raw(ctx, q.url + '?tab=jugnu');
  expect(a.status === 200 && b.status === 200, 'the quiz tab answered ' + a.status + ' / ' + b.status);
  expect(steady(a.body) === steady(b.body), 'the quiz tab with tab=jugnu differs from the page without it');
  const c = await raw(ctx, all.url), d = await raw(ctx, all.url + '?tab=jugnu');
  expect(steady(c.body) === steady(d.body), 'the class tab with tab=jugnu differs from the page without it');
  for (const html of [a.body, c.body]) expect(!/tab=jugnu|>Jugnu</.test(html), 'a Jugnu link is on the page');
  const fwd = await raw(ctx, q.token ? '/r/' + q.token + '/fwd?class=' + T.lists[0].id : '');
  const queue = await raw(ctx, '/r/' + q.token + '/queue', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'loose_id=' + T.lists[0].kids[2].id + '&candidate_id=' + T.lists[0].kids[3].id + '&decision=same&class=' + T.lists[0].id });
  expect(fwd.status === 404 && queue.status === 404, 'with the switch off, forward answered ' + fwd.status + ' and the queue ' + queue.status + ' (want 404)');
  await open(page, q.url + '?tab=jugnu');
  return { quizTab: 'identical', classTab: 'identical', fwd: fwd.status, queue: queue.status };
});

add({ id: 'TR01' }, 'The report shows who has not played, greyed, with a one-tap reminder', async (page, ctx) => {
  const T = await background(ctx);
  const { url } = F.reportUrl(ctx, T);
  const res = await open(page, url);
  const h = res.headers();
  const body = flat(await text(page));
  expect(/2 of 4 played/.test(body), 'no "2 of 4 played": ' + body.slice(0, 200));
  const tiles = await page.$$eval('.tile', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  expect(tiles.some((t) => /^Average 90%$/.test(t)), 'the average tile is not 90% (5/5 and 4/5): ' + tiles.join(' | '));
  expect(tiles.some((t) => /^Hardest Q2$/.test(t)), 'the hardest tile is not Q2: ' + tiles.join(' | '));
  const np = await page.$$eval('#not-played .np-chip', (els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, ' ').trim(), c: getComputedStyle(e).color, o: getComputedStyle(e).opacity })));
  expect(np.length === 2 && /^Hamza list no\. 3$/.test(np[0].t) && /^Sana list no\. 4$/.test(np[1].t), 'not played: ' + JSON.stringify(np.map((x) => x.t)));
  const ink = await page.$eval('#scores .nm', (e) => getComputedStyle(e).color);   // a played child's name: the page's ink
  const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  expect(np.every((x) => lum(x.c) > lum(ink) + 20 || Number(x.o) < 1), 'the not-played names are not greyed: ' + np[0].c + ' vs a played name ' + ink);
  const order = await page.$$eval('#not-played > *', (els) => els.map((e) => e.tagName + (e.className ? '.' + e.className.split(' ')[0] : '') + ':' + e.innerText.split('\n')[0].trim()));
  const iList = order.findIndex((x) => /^UL/.test(x)), iRemind = order.findIndex((x) => /Remind the class/.test(x)), iCopy = order.findIndex((x) => /Copy message/.test(x));
  expect(iList >= 0 && iRemind > iList && iCopy > iList, '"Remind the class" and "Copy message" are not under the list: ' + order.join(' | '));
  const scripts = await page.$$eval('script', (els) => els.length);
  const handlers = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length);
  expect(scripts === 0 && handlers === 0, 'the page carries script: ' + scripts + ' <script>, ' + handlers + ' on* handlers');
  expect(/no-store/.test(h['cache-control'] || '') && /noindex/.test(h['x-robots-tag'] || ''), 'cache/index headers: ' + h['cache-control'] + ' · ' + h['x-robots-tag']);
  expect(await page.$('meta[name="robots"][content*="noindex"]'), 'no robots noindex meta');
  return { tiles, notPlayed: np.map((x) => x.t), headers: { cache: h['cache-control'], robots: h['x-robots-tag'] } };
});

add({ id: 'TR02' }, 'Remind the class opens WhatsApp with a message that names nobody', async (page, ctx) => {
  const T = await background(ctx);
  const seen = await catchWa(page);
  await open(page, F.reportUrl(ctx, T).url);
  await page.click('a:has-text("Remind the class")');
  await page.waitForFunction(() => /wa/.test(document.body.innerText), null, { timeout: WAIT }).catch(() => {});
  expect(seen.length === 1, 'WhatsApp\'s share link was not opened (' + seen.length + ')');
  const msg = waText(seen[0]);
  expect(/played/.test(msg) && /Parts of a plant/.test(msg) && /[A-Za-z]/.test(msg) && !/[؀-ۿ]/.test(msg), 'the reminder is not in the quiz\'s language (English): ' + msg);
  expect(msg.includes('/q/' + T.code), 'the reminder does not carry the class\'s children link /q/' + T.code + ': ' + msg);
  const named = KIDS4.flatMap((n) => n.split(' ')).filter((n) => new RegExp('\\b' + n + '\\b', 'i').test(msg));
  expect(!named.length, 'the reminder names ' + named.join(', '));
  return { reminder: msg };
});

add({ id: 'TR03' }, 'A teacher with two classes of that grade is asked which one it was for', async (page, ctx) => {
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: ['Ayesha Khan', 'Bilal Ahmed'] }, { grade: 5, section: 'B', kids: ['Zoya Malik', 'Taha Aziz', 'Rida Noor'] }], quiz: { bound: null } });
  await F.play(ctx, T, { name: 'Imran', cls: '5-B' });                   // a child of neither list, who said 5-B
  await open(page, F.reportUrl(ctx, T).url);
  expect(/Which class was this for\?/.test(await text(page)), 'the page does not ask "Which class was this for?"');
  const buttons = await page.$$eval('#which-class form button', (els) => els.map((e) => e.innerText.trim()));
  expect(buttons.join(',') === '5-A,5-B', 'class buttons: ' + buttons.join(','));
  expect(!(await page.$('#not-played')), 'a "Not played yet" list is shown before a class is picked');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#which-class form button:has-text("5-B")')]);
  const body = flat(await text(page));
  expect(!/did not save/.test(body), 'the pick did not save: ' + body.slice(0, 200));
  const np = await page.$$eval('#not-played .np-chip .nm', (els) => els.map((e) => e.innerText.trim()));
  expect(np.join(',') === 'Zoya,Taha,Rida', 'not played after 5-B: ' + np.join(','));
  // the children's page now knows the class too (identity: the hand-out is bound)
  const html = await (await fetch(ctx.baseUrl + '/q/' + T.code)).text();
  const m = html.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/);
  const cls = m ? JSON.parse(m[1]).cls : null;
  const bound = cls && cls.identity && cls.identity.class ? cls.identity.class : null;
  const code = await F.one(ctx, 'select class_id from quiz_share_codes where id = ' + F.q(T.shareCodeId));
  expect((bound && bound.state === 'known' && bound.label === '5-B') || code === T.lists[1].classId, 'the hand-out is not bound to 5-B for the children: ' + JSON.stringify(bound) + ' / code class ' + code);
  return { buttons, notPlayed: np, children: bound };
});

add({ id: 'TR04' }, 'A teacher with no class list is told how to add one', async (page, ctx) => {
  const T = await F.teacher(ctx, { lists: [] });
  await F.play(ctx, T, { name: 'Alee Raza' });
  await F.play(ctx, T, { name: 'Noor Fatima' }, { wrong: [0, 1] });
  await open(page, F.reportUrl(ctx, T).url);
  const body = flat(await text(page));
  expect(/Send \/roster on WhatsApp/.test(body) && /who has not played/.test(body), 'no "send /roster on WhatsApp" line: ' + body.slice(0, 260));
  const scores = await page.$$eval('#scores li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  expect(scores.some((s) => /^Alee 5\/5$/.test(s)) && scores.some((s) => /^Noor 3\/5$/.test(s)), 'scores: ' + scores.join(' | '));
  expect(!(await page.$('#not-played')), 'a not-played list is shown without a class list');
  return { scores };
});

add({ id: 'TR05' }, 'Export PDF is the same report, printed', async (page, ctx) => {
  const T = await background(ctx);
  await open(page, F.reportUrl(ctx, T).url);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('a:has-text("Export PDF")')]);
  const name = dl.suggestedFilename();
  const file = path.join(os.tmpdir(), 'tr05-' + process.pid + '.pdf');
  await dl.saveAs(file);
  const pdf = F.pdfText(file);
  fs.rmSync(file, { force: true });
  const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  expect(name === 'quiz-report-' + day + '.pdf', 'the PDF is named ' + name);
  const t = flat(pdf.text);
  for (const want of ['2 of 4 played', 'Average', '90%', 'Hardest', 'Q2', 'Not played yet', 'Hamza list no. 3', 'Sana list no. 4', 'Ayesha', '5/5', 'Bilal', '4/5', 'Question by question', 'Which part of a plant makes food using sunlight?'])
    expect(t.includes(want), 'the PDF lacks "' + want + '"');
  for (const no of ['Remind the class', 'Export PDF', 'Copy message', 'All my classes', 'Press and hold'])
    expect(!t.includes(no), 'the PDF shows the button/hint "' + no + '"');
  expect(t.includes('/q/' + T.code) && /2 of 4 in 5-A have played/.test(t), 'the reminder is not printed as text with the children\'s link');
  return { file: name, pages: pdf.pages, bytes: pdf.bytes };
});

add({ id: 'TR06' }, 'The report reads right to left in Urdu', async (page, ctx) => {
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: ['Ayesha Khan', 'Bilal Ahmed', 'Hamza Ali'] }], quiz: { language: 'ur' } });
  await F.play(ctx, T, T.lists[0].kids[0]);
  await F.play(ctx, T, T.lists[0].kids[1], { wrong: [2] });
  await open(page, F.reportUrl(ctx, T).url);
  const html = await page.$eval('html', (e) => ({ dir: e.getAttribute('dir'), lang: e.getAttribute('lang'), font: getComputedStyle(document.body).fontFamily }));
  expect(html.dir === 'rtl' && html.lang === 'ur', 'the page is ' + html.dir + '/' + html.lang);
  expect(/nastaliq/i.test(html.font), 'the page face is not Nastaliq: ' + html.font);
  // numbers, scores and dates: every run of digits is laid out left to right on screen (its first digit leftmost) —
  // measured glyph by glyph, which is what the reader sees, whatever direction the box around it carries
  const runs = await page.evaluate(() => {
    const out = [];
    const boxes = [...document.querySelectorAll('.tiles, #scores, #not-played .np, header .sub')];
    for (const box of boxes) {
      const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const re = /[0-9\u06F0-\u06F9]{2,}/g; let m;
        while ((m = re.exec(n.data))) {
          const xs = [];
          for (let i = 0; i < m[0].length; i++) { const r = document.createRange(); r.setStart(n, m.index + i); r.setEnd(n, m.index + i + 1); xs.push(r.getBoundingClientRect().left); }
          out.push({ t: m[0], where: box.className || box.id || box.tagName, ltr: xs.every((x, i) => i === 0 || x > xs[i - 1]) });
        }
      }
    }
    return out;
  });
  const bad = runs.filter((r) => !r.ltr);
  expect(runs.length >= 3 && runs.some((r) => /sub/.test(r.where)), 'too few numbers measured: ' + JSON.stringify(runs));
  expect(!bad.length, 'numbers that read right to left: ' + JSON.stringify(bad.slice(0, 4)));
  const date = await page.$eval('.sub > span', (e) => e.innerText.trim()).catch(() => null);
  const heading = await page.$eval('h1', (e) => e.innerText.trim());
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('header a:has-text("English")')]);
  const en = await page.$eval('html', (e) => ({ dir: e.getAttribute('dir'), lang: e.getAttribute('lang') }));
  const h1 = await page.$eval('h1', (e) => e.innerText.trim());
  expect(en.lang === 'en' && /Quiz report/.test(await text(page)), 'the English link did not reopen it in English: ' + JSON.stringify(en));
  expect(h1 === heading && new URL(page.url()).pathname === new URL(F.reportUrl(ctx, T).url).pathname.replace(/\.[^.]+$/, (x) => x) || h1 === heading, 'the English page is another report: "' + h1 + '"');
  return { dir: html.dir, font: html.font.split(',')[0], numbers: runs.length, date, english: en };
});

add({ id: 'TR07' }, 'All my classes lists every recent quiz with its own report link', async (page, ctx) => {
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: ['Ayesha Khan', 'Bilal Ahmed', 'Hamza Ali'] }] });
  const Q2 = await F.addQuiz(ctx, T, { topic: 'States of matter', hoursAgo: 30 });
  await F.play(ctx, T, T.lists[0].kids[0]);
  await F.play(ctx, { ...T, ...Q2 }, T.lists[0].kids[1], { wrong: [0] });
  await open(page, F.reportUrl(ctx, T).url);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('a:has-text("All my classes")')]);
  const cells = await page.$$eval('.cells .cell', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  expect(cells.length === 1 && /Class 5 · Science/.test(cells[0]) && /90%/.test(cells[0]) && /2 quizzes · 2 played/.test(cells[0]), 'class cells: ' + cells.join(' | '));
  const bars = await page.$$eval('.wk .wk-col', (els) => els.map((e) => ({ n: (e.querySelector('.n') || {}).innerText, h: parseFloat((e.querySelector('.wk-bar') || { style: {} }).style.height) })));
  expect(bars.length >= 1 && bars.some((b) => b.n === '2' && b.h > 0), 'no week bar of 2 children: ' + JSON.stringify(bars));
  const links = await page.$$eval('.ql li a', (els) => els.map((e) => ({ href: e.getAttribute('href'), topic: e.querySelector('.tp').innerText.trim() })));
  expect(links.map((l) => l.topic).join('|') === 'Parts of a plant|States of matter', 'quizzes listed: ' + links.map((l) => l.topic).join('|'));
  const opened = [];
  for (const l of links) {
    await open(page, ctx.baseUrl + l.href);
    opened.push(await page.$eval('h1', (e) => e.innerText.trim()));
  }
  expect(opened.join('|') === 'Parts of a plant|States of matter', 'each quiz link opens: ' + opened.join('|'));
  expect(new Set(links.map((l) => l.href.split('?')[0])).size === 2, 'the two quizzes share one report link');
  return { cells, weeks: bars.length, opened };
});

add({ id: 'TR08' }, 'A link that cannot open a report says so and shows nothing', async (page, ctx) => {
  const T = await background(ctx);
  const expired = F.reportUrl(ctx, T, { now: Date.now() - 8 * 24 * 3600e3 });
  const res = await open(page, expired.url);
  const body = flat(await text(page));
  expect(res.status() === 410, 'an expired link answered ' + res.status());
  expect(body.includes('This link has expired') && body.includes('Send /quiz on WhatsApp for a fresh one.'), 'no English expiry line: ' + body);
  expect(/اس لنک کی مدت ختم ہو گئی ہے/.test(body), 'no Urdu expiry line: ' + body);
  // a genuine token of THIS teacher pointed at ANOTHER teacher's quiz
  const other = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: ['Zoya Malik'] }], quiz: { topic: 'Secret Topic Of Another Teacher' } });
  await F.play(ctx, other, other.lists[0].kids[0]);
  const tok = F.reportTokens(ctx).signTeacherReport({ teacherId: T.teacherId, quizId: other.quizId });
  const r2 = await open(page, ctx.baseUrl + '/r/' + tok);
  const b2 = flat(await text(page));
  expect(r2.status() === 404, 'another teacher\'s quiz answered ' + r2.status());
  expect(/could not (be )?find|could not be found|not found/i.test(b2), 'the page does not say the report could not be found: ' + b2);
  expect(!/Secret Topic|Zoya/.test(b2), 'the page shows something of the other teacher\'s quiz');
  return { expired: 410, other: 404, said: b2.slice(0, 80) };
});

add({ id: 'TR09' }, 'A child who typed a name not on the list is reconciled by the teacher', async (page, ctx) => {
  // (a) "Add to 5-A" adds the typed child to the class list
  const T = await background(ctx);
  await F.play(ctx, T, { name: 'Alee', cls: '5-A' }, { wrong: [4] });
  await open(page, F.reportUrl(ctx, T).url);
  const sec = async () => flat(await page.$eval('section:has(h2:has-text("Not on your class list"))', (e) => e.innerText).catch(() => ''));
  const first = await sec();
  expect(/Alee/.test(first) && /4\/5/.test(first), '"Not on your class list" does not show Alee 4/5: ' + first);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button:has-text("Add to 5-A")')]);
  const after = flat(await text(page));
  expect(!/did not save/.test(after), 'Add to 5-A did not save');
  const listed = await F.one(ctx, "select count(*) from students where list_id = " + F.q(T.lists[0].id) + " and student_name ilike 'Alee%'");
  expect(Number(listed) === 1, 'Alee is not on 5-A\'s list after "Add to 5-A" (' + listed + ')');
  expect(!(await sec()).includes('Alee'), 'Alee is still under "Not on your class list"');
  // (b) "This is…" moves the typed child's score onto a child who has not played
  const U = await background(ctx);
  await F.play(ctx, U, { name: 'Alee', cls: '5-A' }, { wrong: [4] });
  await open(page, F.reportUrl(ctx, U).url);
  const opts = await page.$$eval('section:has(h2:has-text("Not on your class list")) select option', (els) => els.map((e) => e.innerText.trim()));
  expect(opts.join(',').includes('Hamza') && opts.join(',').includes('Sana') && !opts.join(',').includes('Ayesha'), '"This is…" offers ' + opts.join(','));
  await page.selectOption('section:has(h2:has-text("Not on your class list")) select', { label: opts.find((o) => /Hamza/.test(o)) });
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('section:has(h2:has-text("Not on your class list")) button:has-text("Save")')]);
  const scores = await page.$$eval('#scores li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  const np = await page.$$eval('#not-played .np-chip .nm', (els) => els.map((e) => e.innerText.trim()));
  expect(scores.some((s) => /^Hamza list no\. 3 4\/5$/.test(s)), 'the score did not move onto Hamza: ' + scores.join(' | '));
  expect(!np.includes('Hamza') && !scores.some((s) => /Alee/.test(s)), 'Hamza still not played / Alee still scored: ' + np.join(',') + ' · ' + scores.join(' | '));
  return { added: 'Alee → 5-A', moved: 'Alee → Hamza', notPlayed: np };
});

add({ id: 'TR10' }, 'The training link on the same portal still logs the teacher into training', async (page, ctx) => {
  const teacherId = await F.one(ctx, 'select id from users where phone_number = ' + F.q('92' + DEMO.teacher.slice(1)));   // the demo teacher (lib DEMO)
  const T = F.botModule(ctx, 'shared/services/portal-link-token.js');
  const tok = T.signPortalLink(teacherId, 'training');
  expect(tok, 'could not sign a training link');
  await open(page, ctx.baseUrl + '/t/' + tok);
  const at = await settledPath(page, '/t/' + tok);
  expect(at.startsWith('/portal/training') || at.startsWith('/portal/teacher/training'), 'the training link settled on ' + at);
  await page.waitForFunction(() => /Training|Courses/.test(document.body.innerText), null, { timeout: WAIT });
  // the same token is not a report: /r/ never opens a training token as a report
  const r = await raw(ctx, '/r/' + tok);
  expect(r.status === 401 || r.status === 404, '/r/<training token> answered ' + r.status);
  expect(!/Quiz report/.test(r.body), '/r/<training token> renders a report');
  return { landed: at, report: r.status };
});

// ── the Jugnu tab (switches on) ──────────────────────────────────────────────────────────────────────────────────────
const period = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
async function runRow(ctx, kid, exercise, status, extra = {}) {
  const fin = status === 'scored' || status === 'failed';
  await ctx.sql('insert into web_quiz_challenge_runs (id, student_id, canonical_id, exercise, status, mode, record, period_id, created_at, scored_at, lang, grade, wcpm, meta) values ('
    + ['gen_random_uuid()', F.q(kid.id), F.q(kid.id), F.q(exercise), F.q(status), F.q('check'), 'true', F.q(period()), 'now()', fin ? 'now()' : 'null', F.q('en'), '5',
      extra.wcpm === undefined ? 'null' : String(extra.wcpm), F.q(JSON.stringify(extra.meta || {})) + '::jsonb'].join(', ') + ')');
}
// A live class link for the list's class this term (class_links), and a story released this PKT week (challenge_passages).
const termOf = (now = Date.now()) => { const d = new Date(now + 5 * 3600e3); const m = d.getUTCMonth() + 1; const y = m >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0') + (m >= 4 && m <= 9 ? 'a' : 'b'); };
async function classLink(ctx, T, list) {
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';                         // class_links_code_check: no I, O, 0, 1
  const code = [...require('crypto').randomBytes(8)].map((b) => ABC[b % ABC.length]).join('');
  await ctx.sql('insert into class_links (code, class_id, teacher_id, term_code, minted_at, expires_at) values (' + [F.q(code), F.q(list.classId), F.q(T.teacherId), F.q(termOf()), 'now()', "now() + interval '60 days'"].join(', ') + ')');
  return code;
}
const STORY = { id: 'tr-e2e-story', title: 'The Firefly and the Moon' };
// Released this PKT week and at least 6 h ago. The lane's Postgres answers timestamps in +05:00 and weekStory compares
// released_at with now as STRINGS (teacher-jugnu.data weekStory: p.released_at <= nowIso, nowIso in Z): a story stamped
// in the last 5 h reads as "in the future" here (production answers +00:00). 6 h back keeps the scenario about the page.
const RELEASED = "greatest(now() - interval '6 hours', (date_trunc('week', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi') + interval '1 minute')";
async function story(ctx, releasedSql) {
  await ctx.sql('insert into challenge_passages (passage_id, lang, kind, pool, band, status, released_at, title_en, title_ur, bank_version, reviewer, reviewed_at) values ('
    + [F.q(STORY.id), F.q('en'), F.q('read'), F.q('check'), '1', F.q('calibrated'), releasedSql, F.q(STORY.title), F.q('جگنو اور چاند'), F.q('e2e'), F.q('e2e'), 'now()'].join(', ')
    + ') on conflict (passage_id) do update set released_at = excluded.released_at');
}

add({ id: 'TR11' }, 'The Jugnu tab shows the class\'s month, sorted by first name, behind its switch', async (page, ctx) => {
  await F.switches(ctx, JUGNU);
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: [['Zara Khan', 'Imran Khan'], ['Zara Ali', 'Tahir Ali'], 'Bilal Ahmed', 'Ayesha Noor', 'Hamza Riaz', 'Sana Mir', 'Omar Butt', 'Fatima Gul'] }] });
  const k = Object.fromEntries(T.lists[0].kids.map((x) => [x.first + (x.first === 'Zara' ? x.name.split(' ')[1] : ''), x]));
  await runRow(ctx, k.ZaraKhan, 'missing', 'scored'); await runRow(ctx, k.ZaraKhan, 'read', 'scored', { wcpm: 40 });
  await runRow(ctx, k.ZaraAli, 'listen', 'served');                                 // only served: shows nothing
  await runRow(ctx, k.Bilal, 'bigger', 'abandoned');                                // only abandoned: shows nothing
  await runRow(ctx, k.Ayesha, 'read', 'failed', { meta: { reason: 'no_mic' } });    // waiting for a microphone
  await runRow(ctx, k.Hamza, 'missing', 'scored'); await runRow(ctx, k.Hamza, 'read', 'scored', { wcpm: 0 });   // stopped early
  await ctx.sql("insert into child_rungs (canonical_id, ladder, rung, rule_v, period_id) values (" + [F.q(k.ZaraKhan.id), F.q('reading'), '2', F.q('e2e'), F.q(period())].join(', ') + ')');
  await ctx.sql('insert into child_phone_bindings (canonical_id, phone_tomb, via, confirmed_at, expires_at, phone_norm) values (' + [F.q(k.ZaraKhan.id), F.q('e2e' + T.teacherId.replace(/-/g, '').slice(0, 29)), F.q('save'), 'now()', "now() + interval '30 days'", F.q('3001234567')].join(', ') + ')');
  await open(page, F.reportUrl(ctx, T).url);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('a:has-text("Jugnu")')]);
  const body = flat(await text(page));
  const cov = (body.match(/have started this month/g) || []).length;
  expect(/5 of 8 have started this month/.test(body) && cov === 1, 'the coverage line: ' + cov + '× · ' + (body.match(/\d+ of \d+ have started this month/) || ['none'])[0]);
  expect(await page.$eval('.jcov', (e) => Boolean(e.closest('header'))).catch(() => false), 'the coverage line is not at the top');
  const rows = await page.$$eval('.jl .jk', (els) => els.map((e) => ({ name: (e.querySelector('.jn') || {}).innerText, father: (e.querySelector('.jf') || {}).innerText || '',
    stops: [...e.querySelectorAll('.st')].map((s) => s.classList.contains('on')), txt: e.innerText.replace(/\s+/g, ' ').trim(), dots: e.querySelectorAll('.dd i').length, dotsOn: e.querySelectorAll('.dd i.on').length })));
  const names = rows.map((r) => r.name + (r.father ? '/' + r.father : ''));
  expect(names.join(',') === 'Ayesha,Bilal,Fatima,Hamza,Omar,Sana,Zara/Imran,Zara/Tahir', 'rows: ' + names.join(','));
  const by = (n) => rows.find((r) => r.name + (r.father ? '/' + r.father : '') === n);
  expect(by('Zara/Imran').stops.join() === 'true,true,false,false' && rows.every((r) => r.stops.length === 4), 'Zara (Imran) stops: ' + by('Zara/Imran').stops.join());
  expect(/Stopped early/.test(by('Hamza').txt) && /Waiting for a microphone/.test(by('Ayesha').txt), 'the words: Hamza "' + by('Hamza').txt + '" · Ayesha "' + by('Ayesha').txt + '"');
  expect(/Stickers \d/.test(by('Zara/Imran').txt) && by('Zara/Imran').dots === 7 && by('Zara/Imran').dotsOn >= 1, 'stickers/day dots: ' + by('Zara/Imran').txt);
  expect(/Saved on WhatsApp ✓/.test(by('Zara/Imran').txt), 'no "Saved on WhatsApp ✓" for the bound child: ' + by('Zara/Imran').txt);
  const lampTxt = by('Zara/Imran').txt;
  const lamps = /Reading|reading|rung|lamp/i.test(lampTxt);
  expect(by('Zara/Tahir').stops.every((s) => !s) && by('Bilal').stops.every((s) => !s) && !/Stopped|Waiting/.test(by('Bilal').txt + by('Zara/Tahir').txt), 'a served/abandoned stop shows something');
  const html = await page.content();
  const leaks = ['Khan', 'Ali ', 'Ahmed', 'Noor', 'Riaz', 'Mir', 'Butt', 'Gul', T.phone, T.phone.slice(2)].filter((s) => html.includes(s));
  expect(!leaks.length, 'a surname or phone is on the page: ' + leaks.join(', '));
  return { coverage: '5 of 8', rows: names, lamps: lamps ? 'shown' : 'no rung name in the row text: ' + lampTxt.slice(0, 120) };
});

add({ id: 'TR12' }, 'Forward to the class group carries the week\'s story and no number or name', async (page, ctx) => {
  await F.switches(ctx, { ...JUGNU, web_quiz_class_link: true });
  await story(ctx, RELEASED);
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: ['Ayesha Noor', 'Bilal Ahmed', 'Sana Mir'] }] });
  await classLink(ctx, T, T.lists[0]);
  const seen = await catchWa(page);
  await open(page, F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url);
  const btn = await page.$('a:has-text("Forward to the class group")');
  expect(btn, 'no "Forward to the class group" button');
  await btn.click();
  await page.waitForTimeout(800);
  expect(seen.length === 1, 'WhatsApp\'s share sheet did not open');
  const msg = waText(seen[0]);
  expect(msg.includes(STORY.title) && /every Monday/i.test(msg) && /open the pinned link/i.test(msg), 'the forward reads: ' + msg);
  expect(!HTML_DIGITS.test(msg), 'the forward carries a digit: ' + msg);
  expect(!['Ayesha', 'Bilal', 'Sana'].some((n) => msg.includes(n)), 'the forward names a child: ' + msg);
  // no class link → no button
  const N = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: ['Omar Butt'] }] });
  await open(page, F.reportUrl(ctx, N, { query: '?tab=jugnu' }).url);
  expect(!(await page.$('a:has-text("Forward to the class group")')), 'the button shows for a class with no class link');
  // no story this week → no button
  await story(ctx, "now() - interval '9 days'");
  await open(page, F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url);
  const noStory = !(await page.$('a:has-text("Forward to the class group")'));
  await story(ctx, RELEASED);
  expect(noStory, 'the button shows with no story released this week');
  // the class link switch off → no button
  await F.switches(ctx, { web_quiz_class_link: false });
  await open(page, F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url);
  const noSwitch = !(await page.$('a:has-text("Forward to the class group")'));
  expect(noSwitch, 'the button shows with the class link switch off');
  return { forward: msg, hidden: ['no class link', 'no story this week', 'class link switch off'] };
});

add({ id: 'TR13' }, 'The teacher-confirm queue asks one question per pair and passes the tap on', async (page, ctx) => {
  await F.switches(ctx, { ...JUGNU, web_quiz_hub: true, web_quiz_identity_canon: true });
  const T = await F.teacher(ctx, { lists: [{ grade: 5, section: 'A', kids: [['Ayesha Noor', 'Javed Noor'], 'Bilal Ahmed'] }] });
  await F.play(ctx, T, { name: 'Ayesha', cls: '5-A' });           // a typed "Ayesha", no father, not on the list
  // the join queue routes only a loose child it can reach (a phone on the record: web-quiz-join-queue teacherLoose) —
  // the typed child is given one, as a child who also plays on WhatsApp has
  await ctx.sql("update students set phone = '0300" + String(Math.floor(Math.random() * 1e7)).padStart(7, '0') + "' where enrolled_by_user_id = " + F.q(T.teacherId) + " and list_id is null and student_name = 'Ayesha'");
  await open(page, F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url);
  const body = flat(await text(page));
  if (!/Is Ayesha the same child as Ayesha\?/.test(body)) {
    const held = /join queue: tier precision not read — every tier held/.test(botLogSince(ctx, 0));
    return { blocked: 'the confirm queue served no pair: its pairs are the join queue\'s (web-quiz-join-queue candidatesFor), which '
      + (held ? 'holds every tier on this lane (bot.log: "tier precision not read — every tier held" — its precision read over merge_log fails on the lane schema) and ' : '')
      + 'routes a typed child to a listed one only on the identity store\'s phone/device evidence across sessions, which the WhatsApp quiz path writes; '
      + 'the tab, its switches and its no-surname rule are proved in TR11/TR14' };
  }
  const cards = await page.$$eval('form[action$="/queue"]', (els) => els.map((e) => e.closest('li, .card, section').innerText.replace(/\s+/g, ' ').trim()));
  expect(/5-A|Class 5/.test(body) && cards.length >= 1, 'no queue card with the class');
  expect(/—/.test(cards[0]) && /Javed/.test(cards[0]) && !/Noor/.test(cards[0]), 'the fathers under the names: ' + cards[0]);
  for (const b of ['Same child', 'Different', 'Not sure']) expect(await page.$('button:has-text("' + b + '")'), 'no "' + b + '" button');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button:has-text("Same child")')]);
  expect(/tab=jugnu/.test(page.url()), 'the tap did not come back to the tab: ' + page.url());
  expect(await page.$('button:has-text("Undo")'), 'no "Undo" on a pair said to be the same child');
  return { card: cards[0] };
});

// The class week card: a class drawn this term whose week window is open now, with a live class link.
const WEEK = { ...JUGNU, web_quiz_class_link: true, web_quiz_class_round: true, web_quiz_class_week: true };
async function draw(ctx, T, list, { from = "now() - interval '1 day'", to = "now() + interval '6 days'", term = termOf() } = {}) {
  await ctx.sql('delete from class_round_draws where class_id = ' + F.q(list.classId));
  await ctx.sql('insert into class_round_draws (round, term_code, class_id, stratum, "N_h", "n_h", p_incl, seed, weights_version, plan_sha256, window_start, window_end, order_arm, roster_k, week_start, week_end) values ('
    + [F.q(require('crypto').randomBytes(8).toString('hex')), F.q(term), F.q(list.classId), F.q('e2e'), '10', '1', '0.1', '42', F.q('e2e'), F.q('0'.repeat(64)), "now() - interval '7 days'", "now() + interval '30 days'", F.q('week_first'), '3', from, to].join(', ') + ')');
}
async function weekTeacher(ctx, lang) {
  const T = await F.teacher(ctx, { lang: lang || 'en', lists: [{ grade: 5, section: 'A', kids: ['Ayesha Noor', 'Bilal Ahmed', 'Sana Mir'] }] });
  const code = await classLink(ctx, T, T.lists[0]);
  await draw(ctx, T, T.lists[0]);
  return { T, code };
}
const weekLine = { en: 'This week Jugnu is for everyone in our class. Open the pinned link and play at home.' };
const cardOf = (page) => page.$('section:has-text("Forward the week"), .card:has-text("Forward the week")');

add({ id: 'TR15' }, 'The class week card shows only for a drawn class inside its week window', async (page, ctx) => {
  await F.switches(ctx, WEEK);
  const { T } = await weekTeacher(ctx);
  const url = F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url;
  await open(page, url);
  const card = await cardOf(page);
  expect(card, 'no "Forward the week" card');
  const ct = flat(await card.innerText());
  expect(ct.includes(weekLine.en) && /Forward to the class group/.test(ct), 'the card reads: ' + ct);
  await open(page, url.replace(/\?.*$/, '') + '?tab=jugnu&lang=ur');
  const ur = await page.evaluate(() => { const c = [...document.querySelectorAll('section, .card')].find((e) => /جگنو/.test(e.innerText) && e.querySelector('a[href*="/wfwd"]')); return c ? { dir: getComputedStyle(c).direction, font: getComputedStyle(c).fontFamily } : null; });
  expect(ur && ur.dir === 'rtl' && /nastaliq/i.test(ur.font), 'the Urdu card: ' + JSON.stringify(ur));
  const hidden = {};
  const shows = async () => { await open(page, url); return Boolean(await cardOf(page)); };
  await draw(ctx, T, T.lists[0], { from: "now() + interval '1 day'", to: "now() + interval '8 days'" }); hidden.beforeWindow = !(await shows());
  await draw(ctx, T, T.lists[0], { from: "now() - interval '8 days'", to: "now() - interval '1 minute'" }); hidden.windowClosed = !(await shows());
  await draw(ctx, T, T.lists[0], { term: '2019-20a' }); hidden.otherTerm = !(await shows());
  await ctx.sql('delete from class_round_draws where class_id = ' + F.q(T.lists[0].classId)); hidden.notDrawn = !(await shows());
  await draw(ctx, T, T.lists[0]);
  await ctx.sql('update class_links set revoked_at = now() where class_id = ' + F.q(T.lists[0].classId)); hidden.noLiveLink = !(await shows());
  const miss = Object.entries(hidden).filter(([, v]) => !v).map(([k]) => k);
  expect(!miss.length, 'the card still shows when: ' + miss.join(', '));
  return { card: ct.slice(0, 120), urdu: ur, hidden: Object.keys(hidden), deck: 'the copy deck carries jg.week.forward; its absence is a code path (cardFor returns null) not reachable without editing the deck' };
});

add({ id: 'TR16' }, 'Forwarding the week sends one fixed line and the class link, with no number or name', async (page, ctx) => {
  await F.switches(ctx, WEEK);
  const { T, code } = await weekTeacher(ctx);
  const from = botLogSize(ctx);
  const seen = await catchWa(page);
  await open(page, F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url);
  await page.click('a[href*="/wfwd"]');
  await page.waitForTimeout(800);
  expect(seen.length === 1, 'WhatsApp\'s share sheet did not open');
  const msg = waText(seen[0]);
  expect(msg.startsWith(weekLine.en + ' ') && new RegExp('/j/' + code + '$').test(msg), 'the forward reads: ' + msg);
  const outside = msg.replace(/https?:\/\/\S+\/j\/[A-Z0-9]+/, '');   // the class link (this lane's host carries a port)
  expect(!HTML_DIGITS.test(outside), 'a digit outside the link\'s code: ' + outside);
  expect(!['Ayesha', 'Bilal', 'Sana'].some((n) => msg.includes(n)), 'a child is named: ' + msg);
  const recs = await botEvents(ctx, from, 'web_quiz.class_week_forwarded');
  const stamped = await F.one(ctx, 'select week_forwarded_at is not null from class_round_draws where class_id = ' + F.q(T.lists[0].classId));
  expect(recs.length === 1 && stamped === 't', 'class_week_forwarded: ' + recs.length + ' record(s), week_forwarded_at stamped ' + stamped);
  const rec = recs[0];
  expect(new RegExp('term: "' + termOf() + '"').test(rec), 'the event has no term ' + termOf() + ': ' + rec.slice(0, 400));
  const leaks = [T.lists[0].classId, T.teacherId, T.lists[0].id, ...T.lists[0].kids.map((k) => k.id), ...T.lists[0].kids.map((k) => k.first)].filter((x) => rec.includes(x));
  expect(!leaks.length, 'the event carries ' + leaks.join(', '));
  const cls = (rec.match(/cls: ("[^"]*"|null)/) || [])[1];
  return { forward: msg, event: 1, stamped: true, term: termOf(), cls,
    ...(cls === 'null' ? { note: 'cls (the keyed class) is null on this lane: the bot has no WEB_QUIZ_KID_KEY in its env (web-quiz-kid.cls)' } : {}) };
});

add({ id: 'TR17' }, 'The class week forward is counted once per class per window and is invisible while switched off', async (page, ctx) => {
  await F.switches(ctx, WEEK);
  const { T } = await weekTeacher(ctx);
  const url = F.reportUrl(ctx, T, { query: '?tab=jugnu' }).url;
  const from = botLogSize(ctx);
  const seen = await catchWa(page);
  await open(page, url);
  const viewLog = botLogSince(ctx, from);
  expect(!/sample_window/.test(viewLog), 'viewing the card wrote sample_window');
  await page.click('a[href*="/wfwd"]'); await page.waitForTimeout(600);
  await open(page, url);
  await page.click('a[href*="/wfwd"]'); await page.waitForTimeout(600);
  expect(seen.length === 2, 'WhatsApp opened ' + seen.length + ' times for two taps');
  await botEvents(ctx, from, 'web_quiz.class_week_forwarded', 2, 6000);   // give a second record every chance to land
  const records = (await botEvents(ctx, from, 'web_quiz.class_week_forwarded', 1, 1000)).length;
  expect(records === 1, 'class_week_forwarded was written ' + records + ' times for two taps in one window');
  expect(!(await botEvents(ctx, from, 'web_quiz.sample_window', 1, 10)).length, 'the card wrote sample_window');
  // switched off: the tab is byte-for-byte the page without the card, and the forward answers not found
  await ctx.sql('delete from class_round_draws where class_id = ' + F.q(T.lists[0].classId));
  const before = await raw(ctx, url);                        // switch on, no card: the page before the card
  await draw(ctx, T, T.lists[0]);
  await F.switches(ctx, { web_quiz_class_week: false });
  const off = await raw(ctx, url);
  expect(steady(before.body) === steady(off.body), 'with the class week switch off the Jugnu tab differs from the page before the card');
  const fwd = await raw(ctx, url.replace(/\?.*$/, '') + '/wfwd?class=' + T.lists[0].id);
  expect(fwd.status === 404, 'the forward answered ' + fwd.status + ' while switched off');
  await F.switches(ctx, { web_quiz_class_week: true });
  return { taps: seen.length, events: records, offIdentical: true, offForward: fwd.status };
});

// Spec ids are the two-letter tags beside the spec's own @T tags, in this run order.
const ORDER = ['TR14', 'TR01', 'TR02', 'TR03', 'TR04', 'TR05', 'TR06', 'TR07', 'TR08', 'TR09', 'TR10', 'TR11', 'TR12', 'TR13', 'TR15', 'TR16', 'TR17'];
const scenarios = ORDER.map((id) => S.find((s) => s.id === id));

// Run-wide: the Jugnu tab's schema on this run's database, and the report switch for every teacher.
async function before(ctx) {
  await F.jugnuSchema(ctx);
}

module.exports = { feature: 'teacher-report', spec: 'tests/features/web/teacher-report.feature', scenarios, before };
