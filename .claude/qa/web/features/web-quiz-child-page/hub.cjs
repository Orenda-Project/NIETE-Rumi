// web-quiz-child-page/hub — the kid hub (/h/<token>): the /quiz reply on WhatsApp (through this run's mock Graph API),
// siblings and "Who is playing?", languages, the teacher card, Play again, expired and forwarded links, the library
// lock, the one-shot handset link, the Urdu polish class, the challenge-first order, the hub's door events, the
// install prompt. A family's phone is a students.phone value; the mock's POST /inject is that phone sending a text.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, count, onScreen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
let BASE = '';   // this run's portal origin, set as each scenario starts (openHub needs it without a ctx)
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = (page, ctx) => { BASE = ctx.baseUrl; return fn(page, ctx); }; };
const PHONE = '923009990001', PHONE2 = '923009990002', PHONE3 = '923009990003';

async function api(page, ctx, method, p, body) {
  const url = ctx.baseUrl + '/api/wq/' + p;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}
// A family phone: these class-list children carry it (students.phone), nobody else does.
// A family phone as production has it: the class-list children carry the phone, and the phone has joined a quiz on
// WhatsApp, which leaves a quiz-joined row (no class list) — that row is what student mode reads to treat the phone as
// a child's (student-mode.service quizStudentsFor: list_id null, is_active). Without it every /quiz is a teacher's.
async function family(ctx, phone, names) {
  await ctx.sql('delete from students where phone = ' + q(phone) + " and list_id is null and student_name like 'WA-join %'");
  await ctx.sql('update students set phone = null where phone = ' + q(phone));
  for (const n of names) await ctx.sql('update students set phone = ' + q(phone) + ' where student_name = ' + q(n) + ' and list_id is not null');
  const first = await L.studentNamed(ctx, names[0]);
  await ctx.sql("insert into students (student_name, list_id, enrolled_by_user_id, is_active, status, merged_into, phone) select 'WA-join ' || student_name, null, enrolled_by_user_id, true, 'merged', id, " + q(phone) + ' from students where id = ' + q(first));
  // the bot keeps a phone's verdict a while (student-ingress VerdictCache): a fresh phone each run avoids a stale one
}
// A class-list child's session on `code`, started by chip (the roll pad's way), answered and finished through the API.
async function chipFinish(page, ctx, code, name, wrongAt, device) {
  const kid = await L.chipFor(ctx, code, name);
  const quiz = await api(page, ctx, 'GET', 'quiz/' + code); const qs = quiz.json.quiz.questions;
  const s = await api(page, ctx, 'POST', 'session', Object.assign({ code, chip: kid.chip }, device ? { device_ref: device } : {}));
  expect(s.status === 200, name + ' on ' + code + ': session → ' + s.status + ' ' + JSON.stringify(s.json).slice(0, 100));
  await api(page, ctx, 'POST', 'answers', { st: s.json.st, a: qs.map((x, i) => ({ qid: x.qid, slot: i === wrongAt ? x.options.map((o) => o.slot).find((sl) => sl !== x.correct_slot) : x.correct_slot.split(',')[0], ms: 900 })) });
  const f = await api(page, ctx, 'POST', 'finish', { st: s.json.st });
  return { st: s.json.st, device: s.json.device_ref, result: f.json, kid };
}
// The phone sends `textBody`; the bot's replies to it since `after`.
async function whatsapp(ctx, phone, textBody) {
  const { last } = await L.base.mock(ctx, 'GET', '/outbox?to=' + phone);
  await L.base.mock(ctx, 'POST', '/inject', { kind: 'text', from: phone, text: textBody });
  const until = Date.now() + 12000; let items = [];
  while (Date.now() < until) { ({ items } = await L.base.mock(ctx, 'GET', '/outbox?to=' + phone + '&after=' + last)); if (items && items.length) { await sleep(1500); ({ items } = await L.base.mock(ctx, 'GET', '/outbox?to=' + phone + '&after=' + last)); break; } await sleep(400); }
  return items || [];
}
const hubUrlOf = (items) => { const it = items.find((x) => x.cta && /\/h\//.test(x.cta.url)); return it ? it.cta.url : null; };
const tokenOf = (url) => (url.match(/\/h\/([^?#]+)/) || [])[1];
const payload = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
// the bot's link is the https spelling of this run's portal (dev-portal.sh WEB_QUIZ_BASE_URL): open it on the run
const toRun = (page, url) => String(url || '').replace(/^https?:\/\/[^/]+/, BASE);
async function openHub(page, url) {
  await page.goto(toRun(page, url), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('H1') + ', ' + M('H2') + ', ' + M('H0') + ', ' + M('H-lock') + ', .wq-closed', { state: 'attached', timeout: WAIT });
  return page.$eval('#wq', (e) => e.getAttribute('data-m')).catch(() => null);
}
async function pick(page, first) {
  await page.click('.wq-kid:has-text("' + first + '")');
  await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
}

on('WQ148', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
  const items = await whatsapp(ctx, PHONE, '/quiz');
  expect(items.length === 1, items.length + ' messages arrived: ' + JSON.stringify(items.map((i) => [i.type, i.txt.slice(0, 50)])));
  const it = items[0];
  expect(it.txt === 'Your quizzes, videos and challenges are here.', 'the body reads "' + it.txt + '"');
  expect(it.btns.length === 1 && it.btns[0] === 'Open', 'buttons: ' + JSON.stringify(it.btns));
  const url = hubUrlOf(items); expect(url, 'no hub link in the button');
  const tok = payload(tokenOf(url));
  const tooba = await L.studentNamed(ctx, 'Tooba Testwala');
  expect(tok.k === 'h' && Array.isArray(tok.ids) && tok.ids.length === 1 && tok.ids[0] === tooba, 'the link names ' + JSON.stringify(tok.ids));
  const days = (tok.exp - Date.now() / 1000) / 86400;
  expect(days > 6.9 && days <= 7.01, 'the link lasts ' + days.toFixed(2) + ' days');
  // with the hub off, the same /quiz gets today's reply (no hub link)
  await L.setFlag(ctx, page, 'web_quiz_hub', 'false');
  try {
    const off = await whatsapp(ctx, PHONE, '/quiz');
    expect(off.length >= 1 && !hubUrlOf(off), 'with the hub off the reply still carries a hub link: ' + JSON.stringify(off.map((i) => i.type)));
  } finally { await L.setFlag(ctx, page, 'web_quiz_hub', 'true'); }
  return { body: it.txt, button: it.btns[0], lasts: days.toFixed(1) + ' days' };
});

on('WQ149', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala', 'Yusra Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1); await chipFinish(page, ctx, CODES.OPEN, 'Yusra Testwala', 0);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  const scr = await openHub(page, url);
  expect(scr === 'H1', 'the first screen is ' + scr);
  expect((await inner(page, '#wq h2')) === 'Who is playing?', 'no "Who is playing?"');
  const kids = await page.$$eval('.wq-kid', (els) => els.map((e) => ({ text: e.innerText.trim(), animal: Boolean(e.querySelector('.wq-ani')) })));
  expect(kids.length === 2 && kids.every((k) => k.animal) && kids.map((k) => k.text.replace(/\s+/g, ' ')).join('|').replace(/[^\w|]/g, '').includes('Tooba'), 'children offered: ' + JSON.stringify(kids));
  expect(!/Danish|Hina|Omar|Ali/.test(await text(page)), 'another child is offered');
  await pick(page, 'Tooba');
  expect(/Hi Tooba!/.test(await text(page)), 'not Tooba\'s hub');
  expect((await inner(page, '#wq-h-switch')).includes('Switch player'), 'no "Switch player"');
  await page.click('#wq-h-switch'); await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT });
  return { kids: kids.map((k) => k.text.trim()) };
});

on('WQ150', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala', 'Yusra Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);      // English
  await chipFinish(page, ctx, CODES.UR, 'Yusra Testwala', -1);        // Urdu
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url.replace(/[?&]lang=[a-z]+/, '') + (url.includes('?') ? '&' : '?') + 'lang=en');
  expect((await inner(page, '#wq h2')) === 'Who is playing?' && (await page.$eval('html', (e) => e.lang)) === 'en', 'the picker is not in the link\'s English');
  await pick(page, 'Yusra');
  const h = await page.$eval('html', (e) => ({ lang: e.lang, dir: e.dir }));
  expect(h.lang === 'ur' && h.dir === 'rtl', 'Yusra\'s hub is ' + JSON.stringify(h));
  expect(/السلام علیکم|خوش آمدید/.test(await text(page)), 'the greeting is not Urdu');
  expect((await inner(page, '#wq-h-switch')).includes('کھلاڑی بدلیں'), '"Switch player" is not Urdu');
  if (await page.$('#wq-h-ch')) expect(/چیلنج/.test(await inner(page, '#wq-h-ch')), 'the challenge tile is not Urdu');
  await page.click('#wq-h-switch'); await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT });
  await pick(page, 'Tooba');
  expect((await page.$eval('html', (e) => e.lang)) === 'en', 'Tooba\'s hub is not English');
  return { yusra: h, tooba: 'en' };
});

on('WQ151', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']);
  await chipFinish(page, ctx, CODES.UR, 'Tooba Testwala', -1);         // played, but not the teacher's newest English one
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url);
  expect((await inner(page, '.wq-hcard .wq-hlabel')) === 'From your teacher', 'no teacher card');
  const card = await inner(page, '.wq-hcard');
  expect(/Sent (today|yesterday|\d+ days ago)/.test(card), 'no "Sent …" line: ' + card);
  await page.click('#wq-h-teacher');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  expect(!/Whose turn/.test(await text(page)), '"Whose turn?" showed');
  // a child whose teacher sent nothing in 7 days: the warm empty state
  await ctx.sql("update quiz_share_codes set created_at = now() - interval '10 days' where code = 'SC2ABC'");
  try {
    await family(ctx, PHONE2, ['Farah Testwala']);                      // Farah is in 3-B of the science teacher… use a school-2 child instead
    const s2kid = await L.one(ctx, "select s.student_name from students s join quiz_share_codes c on c.teacher_user_id = s.enrolled_by_user_id where c.code = 'SC2ABC' and s.list_id is not null order by s.roll_number limit 1");
    await family(ctx, PHONE2, [s2kid]);
    const url2 = hubUrlOf(await whatsapp(ctx, PHONE2, '/quiz'));
    if (!url2) return { card: card.split('\n')[0], play: 'straight in', note: 'the school-2 child has never played: /quiz gave no hub link, so the empty state was not reached' };
    await openHub(page, url2);
    if (await page.$(M('H1'))) await page.click('.wq-kid');
    await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
    expect((await inner(page, '.wq-hnone').catch(() => '')) === 'No new quiz from your teacher right now. Watch a video and try its quiz!', 'no warm empty state: ' + (await text(page)).slice(0, 160));
    expect(await page.$('#wq-h-lib2'), 'no video library button in the empty state');
  } finally { await ctx.sql("update quiz_share_codes set created_at = now() - interval '1 day' where code = 'SC2ABC'"); }
  return { card: card.split('\n')[0], play: 'straight in', empty: 'warm' };
});

on('WQ152', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await ctx.sql("update quiz_share_codes set created_at = now() where code = 'SM34EF'");  // the unbound one is newer
  await family(ctx, PHONE, ['Tooba Testwala']); await family(ctx, PHONE2, ['Sara Testwala']);
  await chipFinish(page, ctx, CODES.UR, 'Tooba Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link for Tooba');
  await openHub(page, url);
  const topic = await inner(page, '.wq-hcard h2');
  expect(topic === 'Parts of a Plant', '4-A\'s child sees "' + topic + '" first, not the quiz handed to 4-A');
  const B = await L.newPhone(page);
  try {
    await chipFinish(B.page, ctx, CODES.UR, 'Sara Testwala', -1);
    const url2 = hubUrlOf(await whatsapp(ctx, PHONE2, '/quiz')); expect(url2, 'no hub link for Sara');
    await openHub(B.page, url2);
    const t2 = await inner(B.page, '.wq-hcard h2').catch(() => '');
    expect(t2 !== 'Parts of a Plant', '4-B\'s child sees the quiz handed to 4-A');
  } finally { await B.close(); }
  return { tooba: topic, note: '"the same lesson in the other language" needs a twin lesson code (library), absent here' };
});

on('WQ153', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']);
  const first = await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', 0);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1, first.device);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url);
  const again = await page.$$eval('a.wq-vitem[data-again]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  const row = again.find((t) => /Parts of a Plant/.test(t));
  expect(row && /Best 5\/5 · 2 tries/.test(row), 'Play again rows: ' + JSON.stringify(again));
  expect(/first score/i.test(await text(page)), 'no note that the first score is the teacher\'s');
  await page.click('a.wq-vitem[data-again]:has-text("Parts of a Plant")');
  await page.waitForURL(/\/q\/AB12CD\?again=1/, { timeout: WAIT });
  await page.waitForSelector(M('M3') + ', ' + M('M6') + ', ' + M('M4-opening') + ', .wq-scorecard', { state: 'attached', timeout: WAIT });
  expect(!(await page.$('.wq-scorecard')), 'Play again opened the old scorecard');
  return { row };
});

on('WQ155', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']); await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  const tampered = url.replace(/(\/h\/[^?#]+?)(.)([?#]|$)/, (m, a, c, d) => a + (c === 'a' ? 'b' : 'a') + d);
  const r = await page.request.get(tampered);
  expect(r.status() === 401 || r.status() === 410, 'a tampered link answered ' + r.status());
  await page.goto(tampered, { waitUntil: 'domcontentloaded' });
  const body = await text(page);
  expect(/This link has expired/.test(body) && /Send \/quiz on WhatsApp to get a new one\./.test(body), 'the closed page reads: ' + body.slice(0, 160));
  expect(!/Tooba/.test(body) && !/Parts of a Plant/.test(body), 'a child or quiz is named');
  return { status: r.status() };
});

on('WQ156', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala', 'Yusra Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1); await chipFinish(page, ctx, CODES.OPEN, 'Yusra Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url);                                 // the family's phone opens it first
  expect(await page.$(M('H1')), 'the family phone did not see its children');
  const B = await L.newPhone(page);
  try {
    const scr = await openHub(B.page, url);
    expect(scr === 'H-lock', 'the second phone saw ' + scr);
    const body = await text(B.page);
    expect(/This link was sent to another player/.test(body) && /Ask the child this link was sent to to open it\./.test(body), 'lock copy: ' + body.slice(0, 160));
    expect(!/Tooba|Yusra|Parts of a Plant/.test(body), 'a child or quiz shows on the locked page');
    expect((await inner(B.page, '#wq-h-new')) === 'Someone else / new player', 'no "Someone else / new player"');
    await B.page.click('#wq-h-new'); await B.page.waitForSelector(M('H-new'), { state: 'attached', timeout: WAIT });
    expect(/Ask your teacher for a quiz link, or send \/quiz on WhatsApp from your family's phone\./.test(await text(B.page)), 'the new-player copy is missing');
    const tok = tokenOf(url);
    const tooba = await L.chipFor(ctx, CODES.OPEN, 'Tooba Testwala');
    const T = L.tokens(ctx);
    await B.page.goto(ctx.baseUrl + '/c/' + tok + '?kid=' + T.chipId('h', tooba.studentId), { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    const c = await text(B.page);
    expect(/Ask the child this link was sent to to open it/.test(c) && !/Tooba/.test(c), 'the challenge on the second phone shows: ' + c.slice(0, 160));
  } finally { await B.close(); }
  await openHub(page, url);
  expect(await page.$(M('H1') + ', ' + M('H2')), 'the family phone lost its hub');
  return { secondPhone: 'locked', family: 'unchanged' };
});

on('WQ171', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']); await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url); if (await page.$(M('H1'))) await pick(page, 'Tooba');
  const lib = await page.$eval('#wq-h-lib, #wq-h-lib2', (e) => e.getAttribute('href')).catch(() => null);
  expect(lib && /\/lib\//.test(lib), 'the hub has no library link: ' + lib);
  const B = await L.newPhone(page);
  try {
    await B.page.goto(ctx.baseUrl + lib, { waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector(M('M15-lock'), { state: 'attached', timeout: WAIT });
    const body = await text(B.page);
    expect(/This link was sent to another player/.test(body) && /Ask the child this link was sent to to open it\./.test(body), 'lock copy: ' + body.slice(0, 160));
    expect(/Is this your link\? Send \/quiz on WhatsApp again for a new one\./.test(body), 'no way for the family to get a new link');
    expect(!(await B.page.$('#wql-retry')) && await B.page.$('#wql-back'), 'the lock offers Try again, or no Back');
    expect(!/Tooba|Science|Maths/.test(body), 'subjects, lessons or a name show');
  } finally { await B.close(); }
  return { lock: true };
});

on('WQ172', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
  // more than 40 other children play the teacher's quizzes after her
  for (let i = 0; i < 41; i++) { const quiz = await api(page, ctx, 'GET', 'quiz/' + CODES.NEXT); const s = await api(page, ctx, 'POST', 'session', { code: CODES.NEXT, new: { name: 'Crowd' + i, force: true } }); if (s.status === 200) { await api(page, ctx, 'POST', 'answers', { st: s.json.st, a: quiz.json.quiz.questions.slice(0, 3).map((x) => ({ qid: x.qid, slot: x.correct_slot, ms: 500 })) }); await api(page, ctx, 'POST', 'finish', { st: s.json.st }); } }
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url); if (await page.$(M('H1'))) await pick(page, 'Tooba');
  const href = await page.$eval('#wq-h-teacher, a.wq-vitem[data-again]', (e) => e.getAttribute('href'));
  await page.click('#wq-h-teacher, a.wq-vitem[data-again]');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  expect(!/Which class are you in|Whose turn/.test(await text(page)), 'the child was asked to pick');
  const B = await L.newPhone(page);
  try {
    await B.page.goto(ctx.baseUrl + href, { waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector('#wq-play, ' + M('M4-roll') + ', ' + M('M4-name') + ', ' + M('M6'), { state: 'attached', timeout: WAIT });
    expect(!(await B.page.$(M('M6'))), 'the same link played as Tooba on another phone');
    expect(!/Tooba/.test(await text(B.page)), 'the other phone saw Tooba\'s name');
  } finally { await B.close(); }
  return { crowd: 41, family: 'straight in', other: 'asked' };
});

on('WQ173', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala', 'Yusra Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1); await chipFinish(page, ctx, CODES.OPEN, 'Yusra Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url);                                  // the family's phone first
  // Yusra plays on a class phone (roll 16 on the pad), then that phone opens the family's link
  const B = await L.newPhone(page);
  try {
    await openQuiz(B.page, ctx, CODES.OPEN); await B.page.click('#wq-play'); await B.page.waitForSelector(M('M4-roll'), { state: 'attached', timeout: WAIT });
    for (const d of '16') await B.page.click('.wq-pad .wq-key[data-k="' + d + '"]'); await B.page.click('.wq-pad .wq-key-go');
    await B.page.waitForSelector(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]', { state: 'visible', timeout: WAIT }); await B.page.click(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]');
    await B.page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
    const scr = await openHub(B.page, url);
    const kids = await B.page.$$eval('.wq-kid', (els) => els.map((e) => e.innerText.trim()));
    if (scr === 'H1') expect(kids.length === 1 && /Yusra/.test(kids[0]), 'the class phone was offered ' + JSON.stringify(kids));
    else expect(scr === 'H2' && /Hi Yusra!/.test(await text(B.page)) && !/Tooba/.test(await text(B.page)), 'the class phone saw ' + scr + ': ' + (await text(B.page)).slice(0, 100));
    const tooba = await L.chipFor(ctx, CODES.OPEN, 'Tooba Testwala'); const T = L.tokens(ctx);
    await B.page.goto(ctx.baseUrl + '/c/' + tokenOf(url) + '?kid=' + T.chipId('h', tooba.studentId), { waitUntil: 'domcontentloaded' }); await sleep(800);
    expect(!/Which is bigger/.test(await text(B.page)), 'Tooba\'s challenge opened on the class phone');
  } finally { await B.close(); }
  return { classPhone: 'Yusra only' };
});

// ── the one-shot handset link ─────────────────────────────────────────────────────────────────────────────────────
on('WQ197', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']);
  const tooba = await L.studentNamed(ctx, 'Tooba Testwala');
  const items = await whatsapp(ctx, PHONE, 'QUIZ-' + CODES.OPEN);
  const it = items.find((x) => x.cta && /\/q\//.test(x.cta.url));
  expect(it && items.length === 1, 'the old link got ' + items.length + ' messages: ' + JSON.stringify(items.map((i) => [i.type, i.txt.slice(0, 40)])));
  expect(it.btns.length === 1, 'buttons: ' + JSON.stringify(it.btns));
  const u = new URL(it.cta.url);
  expect(/^#x=[A-Za-z0-9_.-]+$/.test(u.hash), 'the address carries ' + u.hash.slice(0, 20) + ', not a fragment nonce');
  expect(!u.href.includes(PHONE) && !u.href.includes(tooba) && !u.search, 'the address carries the phone, a child id or a query');
  await page.goto(L.local(ctx, it.cta.url), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  expect(!page.url().includes('#x='), 'the fragment is still in the address bar: ' + page.url());
  const [row] = await L.rows(ctx, "select coalesce(student_id::text, '') from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ') order by created_at desc limit 1');
  expect(row && row[0] === tooba, 'the page did not open as Tooba');
  return { button: it.btns[0], fragment: 'dropped', child: 'Tooba' };
});

on('WQ198', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala', 'Yusra Testwala']);
  const items = await whatsapp(ctx, PHONE, 'QUIZ-' + CODES.OPEN);
  const it = items.find((x) => x.cta && /#x=/.test(x.cta.url)); expect(it, 'no handset button');
  await page.goto(L.local(ctx, it.cta.url), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-play, #wq-play-as, .wq-kid, ' + M('M4-roll'), { state: 'attached', timeout: WAIT });
  if (await page.$('#wq-play')) await page.click('#wq-play');
  if (await page.$('#wq-play-as')) await page.click('#wq-notme');
  await page.waitForSelector('.wq-kid', { state: 'visible', timeout: WAIT });
  const kids = await page.$$eval('.wq-kid', (els) => els.map((e) => e.innerText.trim()));
  expect(kids.length === 2 && kids.some((k) => /Tooba/.test(k)) && kids.some((k) => /Yusra/.test(k)), 'children shown: ' + JSON.stringify(kids));
  // a typed name that is one of them is confirmed, never duplicated
  await page.click('#wq-noroll, #wq-new'); await page.fill('#wq-name', 'Yusra'); await page.click('#wq-start');
  await page.waitForSelector(M('M4-isyou'), { state: 'attached', timeout: WAIT });
  expect(/Are you Yusra\?/.test(await text(page)) && await count(page, M('M4-isyou') + ' .wq-btn.wq-go') === 1, 'no single "Is this you?" card for Yusra');
  return { kids };
});

on('WQ199', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']);
  const items = await whatsapp(ctx, PHONE, 'QUIZ-' + CODES.OPEN);
  const it = items.find((x) => x.cta && /#x=/.test(x.cta.url)); expect(it, 'no handset button');
  const before = Number(await L.one(ctx, 'select count(*) from students'));
  const F = await L.newPhone(page);
  try { await F.page.goto(L.local(ctx, it.cta.url), { waitUntil: 'domcontentloaded' }); await F.page.waitForSelector('#wq-play, ' + M('M6') + ', .wq-kid', { state: 'attached', timeout: WAIT }); } finally { await F.close(); }
  await page.goto(L.local(ctx, it.cta.url), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-play, #wq-play-as, ' + M('M4-roll'), { state: 'attached', timeout: WAIT });
  expect(!(await page.$(M('M6'))), 'the owner\'s page started a quiz from a spent button');
  expect(!/Tooba/.test(await text(page)), 'the spent button still names the child');
  const after = Number(await L.one(ctx, 'select count(*) from students'));
  expect(after === before, 'the first tap wrote children (' + before + ' → ' + after + ')');
  return { owner: 'asked who is playing', written: 0 };
});

on('WQ200', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await L.setFlag(ctx, page, 'web_quiz_handset_link', 'false');
  try {
    await family(ctx, PHONE, ['Tooba Testwala']);
    const items = await whatsapp(ctx, PHONE, 'QUIZ-' + CODES.OPEN);
    const it = items.find((x) => x.cta && /\/q\//.test(x.cta.url)); expect(it, 'no button at all: ' + JSON.stringify(items.map((i) => i.type)));
    expect(!/#x=/.test(it.cta.url), 'the button still carries a handset fragment');
    const binds = []; page.on('request', (r) => { if (/\/api\/wq\/bind$/.test(r.url())) binds.push(1); });
    await page.goto(L.local(ctx, it.cta.url), { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#wq-play', { state: 'visible', timeout: WAIT }); await sleep(1000);
    expect(binds.length === 0, 'the page called the bind endpoint');
  } finally { await L.setFlag(ctx, page, 'web_quiz_handset_link', 'true'); }
  return { plain: true };
});

// ── polish, order, doors, install, Book ───────────────────────────────────────────────────────────────────────────
on('WQ214', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala', 'Yusra Testwala']);
  await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1); await chipFinish(page, ctx, CODES.UR, 'Yusra Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  await openHub(page, url.replace(/[?&]lang=[a-z]+/, '') + (url.includes('?') ? '&' : '?') + 'lang=ur');
  const cls = () => page.$eval('html', (e) => e.classList.contains('wq-ur2'));
  expect(await cls(), 'the Urdu boot has no polish class');
  await pick(page, 'Tooba');
  expect(!(await cls()), 'the English child\'s hub keeps the Urdu polish class');
  await page.click('#wq-h-switch'); await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT }); await pick(page, 'Yusra');
  expect(await cls(), 'the Urdu child\'s hub lost the polish class');
  return { follows: 'the child\'s language' };
});

on('WQ231', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await L.setFlag(ctx, page, 'web_quiz_hub_challenge_first', 'true');
  try {
    await family(ctx, PHONE, ['Tooba Testwala']); await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
    const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
    await openHub(page, url); if (await page.$(M('H1'))) await pick(page, 'Tooba');
    const idx = await page.evaluate(() => { const all = [...document.querySelectorAll('#wq *')]; const at = (s) => { const e = document.querySelector(s); return e ? all.indexOf(e) : -1; }; return { ch: at('#wq-h-ch'), last: at('.wq-hlast, .wq-hcard, a.wq-vitem[data-again]'), tiles: document.querySelectorAll('#wq-h-ch').length }; });
    expect(idx.ch >= 0 && (idx.last === -1 || idx.ch < idx.last), 'the Jugnu card is not first: ' + JSON.stringify(idx));
    expect(idx.tiles === 1, 'the challenge tile is shown ' + idx.tiles + ' times');
  } finally { await L.setFlag(ctx, page, 'web_quiz_hub_challenge_first', null); }
  return { first: 'Jugnu', note: 'the "still open → Continue first" branch is not driven' };
});

on('WQ234', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await L.setFlag(ctx, page, 'web_quiz_events_v2', 'true');
  try {
    await family(ctx, PHONE, ['Tooba Testwala']); await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
    const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
    const ev = L.events(page);
    await openHub(page, url); if (await page.$(M('H1'))) await pick(page, 'Tooba');
    await sleep(1500); await page.click('#wq-h-ch'); await sleep(1500); await ev.flush();
    const shown = ev.of('door_shown'), tapped = ev.of('door_tap');
    expect(shown.length >= 1 && shown.every((e) => e.door), 'no door_shown with a door: ' + JSON.stringify(shown));
    expect(tapped.length >= 1 && tapped.every((e) => e.door), 'no door_tap: ' + JSON.stringify(tapped));
    const dup = shown.map((e) => e.door + '|' + (e.slot || '')).filter((d, i, a) => a.indexOf(d) !== i);
    expect(!dup.length, 'a door was counted twice in one view: ' + dup.join(','));
    return { shown: shown.map((e) => e.door), tapped: tapped.map((e) => e.door), note: 'the lantern and the shelf (next/tomorrow/shelf doors) are Trail v2 features, off on this lane' };
  } finally { await L.setFlag(ctx, page, 'web_quiz_events_v2', null); }
});

on('WQ235', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']); await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  const before = await (await page.request.get(L.local(ctx, url))).text();
  expect(!/rel="manifest"/.test(before), 'a manifest link without the switch');
  await L.setFlag(ctx, page, 'web_quiz_install_prompt', 'true');
  try {
    const after = await (await page.request.get(L.local(ctx, url))).text();
    const link = (after.match(/<link rel="manifest" href="([^"]+)"/) || [])[1];
    expect(link && /\/manifest\.webmanifest$/.test(link), 'no manifest link with the switch on');
    const m = await page.request.get(ctx.baseUrl + link);
    expect(m.status() === 200 && /manifest/.test(m.headers()['content-type'] || ''), 'the manifest answered ' + m.status());
    expect(!/install/i.test(after.replace(/manifest/g, '')) || !/<[^>]*class="[^"]*install/.test(after), 'an install card is drawn');
    return { manifest: link.replace(/\/h\/[^/]+/, '/h/<token>') };
  } finally { await L.setFlag(ctx, page, 'web_quiz_install_prompt', null); }
});

on('WQ241', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await family(ctx, PHONE, ['Tooba Testwala']); await chipFinish(page, ctx, CODES.OPEN, 'Tooba Testwala', -1);
  const url = hubUrlOf(await whatsapp(ctx, PHONE, '/quiz')); expect(url, 'no hub link');
  const scripts = new Set(); page.on('request', (r) => { if (r.resourceType() === 'script' || r.resourceType() === 'stylesheet') scripts.add(new URL(r.url()).pathname.split('/').pop()); });
  await openHub(page, url); if (await page.$(M('H1'))) await pick(page, 'Tooba');
  expect(![...scripts].some((s) => /wq-book/.test(s)), 'the Book script or stylesheet loaded: ' + [...scripts].join(', '));
  expect(!/Jugnu's Book|wq-book/.test(await page.content()), 'a Book tile is drawn');
  const hub = await L.bot(ctx, 'GET', '/api/internal/wq/hub/' + encodeURIComponent(tokenOf(url)));
  expect(hub.status === 200 && !('book' in (hub.json || {})), 'the hub payload carries a book key');
  return { book: 'absent' };
});

for (const [id, why] of [
  ['WQ154', 'the recommendations are video quizzes from the lesson bank (student_videos), absent from the demo seed'],
  ['WQ170', 'WEB_QUIZ_BASE_URL is not set on this lane\'s portal, so the canonical redirect (createCanonicalRedirect) is inert; the quiz\'s own address IS the default address here'],
]) on(id, 'off', async () => ({ blocked: why }));

module.exports = { runs, modes };
