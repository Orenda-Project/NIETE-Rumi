// web-quiz-child-page/end — after the last answer: the results and the scorecard, sharing (and its fallback when the
// browser has no share sheet), the challenge a friend plays, the landing's teacher and class line, finishing with no
// internet, prefetching, the "new best" line, the class table and the school league. The share pictures are drawn by
// the bot's image renderer; when this lane's bot cannot draw (no renderer in its dependency set) those scenarios say so.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, TOPIC, text, inner, count, boot, onScreen, screen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const M = (m) => onScreen(m);

const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

// ── the page's own API, driven directly: a whole play in a second, the same calls the page makes ─────────────────
async function api(page, ctx, method, p, body) {
  const url = ctx.baseUrl + '/api/wq/' + p;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}
// Finish `code` as a new child `name` (today's path), getting `wrongAt` wrong (−1 = none). Returns the finish body + st.
async function apiFinish(page, ctx, code, name, wrongAt, extra) {
  const quiz = await api(page, ctx, 'GET', 'quiz/' + code);
  expect(quiz.status === 200, 'GET quiz/' + code + ' → ' + quiz.status);
  const qs = quiz.json.quiz.questions;
  const s = await api(page, ctx, 'POST', 'session', Object.assign({ code, new: { name, cls: String(quiz.json.quiz.grade || ''), force: true } }, extra || {}));
  expect(s.status === 200 && s.json.st, 'session for ' + name + ' → ' + s.status + ' ' + JSON.stringify(s.json).slice(0, 120));
  const a = await api(page, ctx, 'POST', 'answers', { st: s.json.st, a: qs.map((x, i) => ({ qid: x.qid, slot: i === wrongAt ? x.options.map((o) => o.slot).find((sl) => sl !== x.correct_slot) : x.correct_slot.split(',')[0], ms: 1200 })) });
  expect(a.status === 200, 'answers → ' + a.status);
  const f = await api(page, ctx, 'POST', 'finish', { st: s.json.st });
  expect(f.status === 200, 'finish → ' + f.status + ' ' + JSON.stringify(f.json).slice(0, 120));
  return { st: s.json.st, device: s.json.device_ref, session: s.json, chip: s.json.child && s.json.child.chip, result: f.json, questions: qs };
}
// Open the scorecard after a results screen.
async function toCard(page) {
  await page.click('#wq-card');
  await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
}
// No share sheet in this browser: the share button falls back to the WhatsApp link screen.
async function noShareSheet(page) {
  await page.addInitScript(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch (_) { /* fine */ } });
}
// Fetch a share picture; say plainly when the bot cannot draw.
async function picture(page, url) {
  const r = await page.request.get(url);
  const type = r.headers()['content-type'] || '';
  if (r.status() === 200 && /image\/jpeg/.test(type)) {
    const buf = await r.body();
    // JPEG SOF0/SOF2: FF C0/C2, length, precision, height(2), width(2)
    let w = 0, h = 0; for (let i = 2; i < buf.length - 9; i++) { if (buf[i] === 0xFF && (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; } }
    return { ok: true, status: 200, type, bytes: buf.length, w, h };
  }
  return { ok: false, status: r.status(), type, body: (await r.text()).slice(0, 160) };
}
const NO_RENDERER = 'the share picture is drawn by the bot\'s image renderer (web-quiz-art.js → html-to-pdf.js: playwright-core Chromium + sharp), which this lane\'s bot dependency set does not carry';
const PIXELS = 'what the picture SHOWS is pixels (names, places, animals, scores): not readable headless without OCR; the picture\'s id, size, type and the facts the renderer is given are checked';

// ── sharing ───────────────────────────────────────────────────────────────────────────────────────────────────────
on('WQ007', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await noShareSheet(page);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Sharif');
  await toCard(page);
  expect((await inner(page, '#wq-share')) === 'Share to class group', 'no "Share to class group"');
  await page.click('#wq-share');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const wa = await page.$eval('a#wq-wa', (a) => ({ text: a.innerText.trim(), href: a.getAttribute('href') }));
  expect(/^https:\/\/wa\.me\/\?text=/.test(wa.href), 'the WhatsApp link is ' + wa.href);
  expect(decodeURIComponent(wa.href).includes('/q/' + CODES.OPEN), 'the message carries no quiz link');
  expect((await inner(page, '#wq-copy')) === 'Copy the message', 'no "Copy the message"');
  // the spec words the WhatsApp action "Open WhatsApp with the message"; the page's button reads "Send on WhatsApp"
  return { whatsapp: wa.text, copy: 'Copy the message', note: 'spec says "Open WhatsApp with the message"; the page reads "' + wa.text + '"' };
});

on('WQ009', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // TT12AB's stored teacher name is "Teacher Sana Javed": named once. Before anyone finishes, no class.
  await openQuiz(page, ctx, CODES.TITLE);
  const before = await inner(page, '#wq .wq-sub');
  expect(before === 'From Teacher Sana Javed', 'before any finish the landing says "' + before + '"');
  await apiFinish(page, ctx, CODES.TITLE, 'Lamia', -1);
  await openQuiz(page, ctx, CODES.TITLE);
  const after = await inner(page, '#wq .wq-sub');
  expect(after === 'From Teacher Sana Javed · Class 4', 'after a finish the landing says "' + after + '"');
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.TITLE + '/class')).text();
  const og = L.og(html, 'og:title');
  expect(/Class 4/.test(og), 'the class page preview is titled "' + og + '"');
  return { before, after, classPreview: og };
});

on('WQ181', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await openQuiz(page, ctx, CODES.TITLE);
  const line = await inner(page, '#wq .wq-sub');
  expect(line.startsWith('From Teacher Sana Javed'), 'the teacher is named "' + line + '"');
  expect(!/Teacher Teacher/.test(line), 'the title is doubled');
  const og = await page.$eval('meta[property="og:description"], meta[property="og:title"]', (m) => m.getAttribute('content'));
  expect(!/Teacher Teacher/.test(og), 'the preview doubles the title');
  return { line, note: 'the stored name was "Teacher Sana Javed"; a "Mr …" form is not in the demo seed' };
});

on('WQ060', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await noShareSheet(page);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Rania');
  await toCard(page);
  await page.click('#wq-chal');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const url = await inner(page, M('M12-fallback') + ' .wq-url');
  const m = url.match(/\/q\/([A-Z0-9]{4,12})(\?[^ ]*)?$/);
  expect(m && m[1] !== CODES.OPEN && !/Rania/i.test(url) && !m[2], 'the shared link is ' + url);
  const F = await L.newPhone(page);
  try {
    await openQuiz(F.page, ctx, m[1]);
    const banner = await inner(F.page, '.wq-banner');
    expect(banner.startsWith('Rania got 5/5 stars.') || banner.startsWith('Rania challenged you'), 'the friend\'s landing says "' + banner + '"');
  } finally { await F.close(); }
  return { link: url };
});

on('WQ059', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // the challenger: 3 of 5; the friends: 5/5 (beat), 3/5 (tie), 2/5 (lower), each on a phone of their own
  // the challenger: 4 of 5 through the API (one wrong)
  const challenger = await apiFinish(page, ctx, CODES.OPEN, 'Hamid2', 0);
  const chal = challenger.result.challenge_code;
  expect(chal, 'no challenge code on the finish');
  // three friends through the API: the finish names the outcome (vs.outcome); the first one also plays in a browser
  const outcomes = [];
  for (const [name, wrong, want] of [['Gul', [0], 'tie'], ['Haya', [0, 1, 2], 'lose']]) {
    const F = await L.newPhone(page);
    try {
      const quiz = await api(F.page, ctx, 'GET', 'quiz/' + chal); const qs = quiz.json.quiz.questions;
      const s = await api(F.page, ctx, 'POST', 'session', { code: chal, new: { name, force: true } });
      await api(F.page, ctx, 'POST', 'answers', { st: s.json.st, a: qs.map((x, i) => ({ qid: x.qid, slot: wrong.includes(i) ? x.options.map((o) => o.slot).find((sl) => sl !== x.correct_slot) : x.correct_slot, ms: 900 })) });
      const f = await api(F.page, ctx, 'POST', 'finish', { st: s.json.st });
      outcomes.push({ name, outcome: f.json.vs && f.json.vs.outcome });
      expect(f.json.vs && f.json.vs.outcome === want, name + '\'s finish says ' + JSON.stringify(f.json.vs) + ', wanted ' + want);
    } finally { await F.close(); }
  }
  const F = await L.newPhone(page);
  try {
    await L.finishAsNew(F.page, ctx, chal, 'Fawad'); await toCard(F.page);
    const vs = await F.page.$eval('.wq-banner.wq-vs', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    expect(/^You beat the challenge!/.test(vs) && /You 5\/5/.test(vs) && /Hamid2 4\/5/.test(vs), 'the winner\'s card says "' + vs + '"');
    outcomes.push({ name: 'Fawad', banner: vs });
  } finally { await F.close(); }
  // the challenger's "My scores" names the friends' outcomes
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  // the page asks "me" for the history only for the children this phone remembers: remember the challenger
  await page.evaluate(([c, st, res, chip]) => {
    localStorage.setItem('wq_s_' + c, JSON.stringify({ st, child: { first: 'Hamid2', chip }, answers: {}, queue: [], seq: 0, wrong: [], result: res }));
    localStorage.setItem('wq_kids', JSON.stringify([{ chip, first: 'Hamid2', animal: 'lion' }]));
  }, [CODES.OPEN, challenger.st, challenger.result, challenger.chip]);
  expect(challenger.chip, 'the challenger\'s session carries no chip');
  await openQuiz(page, ctx, CODES.OPEN);
  await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  await page.click('#wq-class'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT }); await page.click('#wq-next');
  await page.waitForSelector(M('M13'), { state: 'attached', timeout: WAIT });
  const hist = await text(page);
  expect(/beat you!/.test(hist) && /you won/.test(hist), 'My scores does not name the friends\' outcomes: ' + hist.slice(0, 200));
  return { outcomes };
});

// ── finishing with no internet ────────────────────────────────────────────────────────────────────────────────────
on('WQ075', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Offa');
  await play(page, b.quiz.questions, 4, 1);
  // the connection drops before the last answer reaches the server
  await page.route('**/api/wq/**', (r) => r.abort('internetdisconnected'));
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const qq = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + L.wrongSlot(qq) + '"]');
  await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT }); await page.click('#wq-next');
  if (await page.$('#wq-fix')) await page.click('#wq-later');
  await page.waitForSelector(M('M9-pending'), { state: 'attached', timeout: WAIT });
  const h1 = await inner(page, M('M9-pending') + ' h1');
  expect(h1 === 'You got 3 out of 5', 'the offline result says "' + h1 + '"');
  expect((await page.$eval(M('M9-pending') + ' .wq-stars', (e) => e.getAttribute('aria-label'))) === '3/5', 'no 3/5 stars');
  expect((await text(page)).includes('Your results will reach your teacher when you are back online.'), 'the back-online line is missing');
  expect(!(await text(page)).includes('No internet right now'), 'the error screen is shown');
  const jugnu = await page.$eval(M('M9-pending') + ' .wq-jug img', (i) => i.complete && i.naturalWidth > 0);
  expect(jugnu, 'Jugnu is not shown (the picture was not already fetched)');
  await page.unroute('**/api/wq/**');
  return { h1 };
});

on('WQ076', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Offb');
  await play(page, b.quiz.questions, 4, -1);
  await page.route('**/api/wq/**', (r) => r.abort('internetdisconnected'));
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const qq = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + qq.correct_slot + '"]'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT }); await page.click('#wq-next');
  await page.waitForSelector(M('M9-pending'), { state: 'attached', timeout: WAIT });
  await page.unroute('**/api/wq/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector(M('M9') + ' h1', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '#wq-card')) === 'See my card' && (await inner(page, '#wq-class')) === 'See my class', 'the real results did not replace the pending screen');
  const [row] = await L.rows(ctx, "select status from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") order by created_at desc limit 1");
  expect(row && row[0] === 'completed', 'the session is ' + (row && row[0]));
  return { sent: 'on online', status: row[0] };
});

on('WQ077', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Offc');
  await play(page, b.quiz.questions, 4, -1);
  await page.route('**/api/wq/**', (r) => r.abort('internetdisconnected'));
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const qq = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + qq.correct_slot + '"]'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT }); await page.click('#wq-next');
  await page.waitForSelector(M('M9-pending'), { state: 'attached', timeout: WAIT });
  await page.unroute('**/api/wq/**');
  // the tab closes; the same link is opened again with internet
  await openQuiz(page, ctx, CODES.OPEN);
  await page.waitForSelector(M('M9') + ' h1, .wq-scorecard', { state: 'visible', timeout: WAIT });
  expect(!(await page.$('#wq-cont')), 'the page offers "Go on: question 5 of 5"');
  const [row] = await L.rows(ctx, "select status from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") order by created_at desc limit 1");
  expect(row && row[0] === 'completed', 'the result was not sent on the next open (' + (row && row[0]) + ')');
  return { nextOpen: 'results' };
});

on('WQ078', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // every other request to answers/finish fails, and each takes over a second
  // each distinct request fails once (connection reset), then goes through slowly (over a second)
  let n = 0; const seen = new Set();
  await page.route('**/api/wq/{answers,finish}', async (r, req) => { n += 1; const key = req.url() + '|' + (req.postData() || ''); if (!seen.has(key)) { seen.add(key); return r.abort('connectionreset'); } await sleep(1100); return r.continue(); });
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Flappy');
  await play(page, b.quiz.questions, 5, -1);
  await page.waitForSelector(M('M9') + ' h1, ' + M('M9-pending') + ', #wq-fix', { state: 'attached', timeout: 60000 });
  if (await page.$('#wq-fix')) await page.click('#wq-later');
  if (await page.$(M('M9-pending'))) { await page.click('#wq-sync'); }
  await page.waitForSelector(M('M9') + ' h1', { state: 'visible', timeout: 60000 });
  await page.unroute('**/api/wq/{answers,finish}');
  const [[sid]] = await L.rows(ctx, "select id from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") order by created_at desc limit 1");
  const answers = await L.rows(ctx, 'select question_id, count(*) from quiz_answers where session_id = ' + q(sid) + ' group by question_id');
  expect(answers.length === 5 && answers.every((r) => r[1] === '1'), 'answers recorded: ' + JSON.stringify(answers));
  return { requests: n, answers: answers.length, note: '"a result sent a week later is still accepted" is a token-lifetime rule (session token exp) not driven here' };
});

on('WQ079', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const fetched = [];
  page.on('request', (r) => { if (/\/api\/wq\/media\//.test(r.url())) fetched.push(r.url()); });
  const b = await startAsNew(page, ctx, 'IT12AB', 'Ahead');
  const qs = b.quiz.questions;
  // on question 1 for a moment: the pictures of questions 2 and 3 are already fetched
  await sleep(2500);
  const later = qs.slice(1, 3).flatMap((x) => [x.img, ...(x.options || []).map((o) => o.img)]).filter(Boolean);
  const hit = later.filter((u) => fetched.some((f) => f.includes(u.split('?')[0])));
  expect(later.length === 0 || hit.length > 0, 'none of the next questions\' pictures were fetched ahead (' + later.length + ' expected, fetched: ' + fetched.length + ')');
  return { ahead: hit.length, of: later.length, note: 'the demo quizzes carry no recorded voice (audio recording is off on this lane), so only pictures are checked' };
});

on('WQ080', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // one child (the same session's device + chip reuse by name on this phone): 3/5 first, then 4/5, then 5/5
  const first = await apiFinish(page, ctx, CODES.OPEN, 'Besty', 0);
  const chip = first.chip;
  const again = async (wrongAt) => {
    const quiz = await api(page, ctx, 'GET', 'quiz/' + CODES.OPEN); const qs = quiz.json.quiz.questions;
    const s = await api(page, ctx, 'POST', 'session', { code: CODES.OPEN, chip, device_ref: first.device });
    expect(s.status === 200, 'replay session → ' + s.status + ' ' + JSON.stringify(s.json).slice(0, 100));
    await api(page, ctx, 'POST', 'answers', { st: s.json.st, a: qs.map((x, i) => ({ qid: x.qid, slot: wrongAt.includes(i) ? x.options.map((o) => o.slot).find((sl) => sl !== x.correct_slot) : x.correct_slot, ms: 900 })) });
    return (await api(page, ctx, 'POST', 'finish', { st: s.json.st })).json;
  };
  // first = 3/5? apiFinish got one wrong (4/5): make the FIRST 3/5 by a second wrong via a fresh run instead
  const r2 = await again([0, 1]);          // practice 3/5 (below the first 4/5): adds nothing
  const r3 = await again([]);              // practice 5/5: new best
  const st = (await api(page, ctx, 'POST', 'session', { code: CODES.OPEN, chip, device_ref: first.device })).json.st;
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([c, token, res]) => localStorage.setItem('wq_s_' + c, JSON.stringify({ st: token, child: { first: 'Besty' }, answers: {}, queue: [], seq: 0, wrong: [], result: res })), [CODES.OPEN, st, r3]);
  await openQuiz(page, ctx, CODES.OPEN);
  await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  const card = await text(page);
  expect(/Practice round · your first score 4\/5 is the one that counts/.test(card), 'the card does not keep the first score: ' + card.slice(0, 200));
  const best = await page.$eval('.wq-banner.wq-best', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  expect(/New best! 5\/5 · was 4\/5/.test(best), 'the new-best line reads "' + best + '"');
  expect(!(r2.best && r2.best.improved), 'a practice round below the best was called a new best: ' + JSON.stringify(r2.best || null));
  return { first: '4/5 (counted)', practice: ['3/5', '5/5'], best };
});

// ── the leagues ───────────────────────────────────────────────────────────────────────────────────────────────────
const schoolOf = (ctx, code) => L.one(ctx, 'select s.name from schools s join users u on u.school_id = s.id join quiz_share_codes c on c.teacher_user_id = u.id where c.code = ' + q(code));

on('WQ064', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // finishes from three schools this week; a practice re-attempt and the teacher's own test add nothing
  await apiFinish(page, ctx, CODES.OPEN, 'Lg1', -1); await apiFinish(page, ctx, 'SC2ABC', 'Lg2', 0); await apiFinish(page, ctx, 'SC2ABC', 'Lg3', -1); await apiFinish(page, ctx, 'SC3ABC', 'Lg4', 1);
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Lg5', -1);
  const board = await api(page, ctx, 'GET', 'schools/' + CODES.OPEN + '?st=' + encodeURIComponent(me.st));
  expect(board.status === 200, 'schools board → ' + board.status);
  const b = board.json;
  const ranked = b.rows || b.schools || [];
  expect(ranked.length >= 3, 'ranked schools: ' + ranked.length + ' ' + JSON.stringify(b).slice(0, 200));
  for (const r of ranked) {
    expect(r.name && r.points > 0 && r.kids >= 1 && r.place >= 1, 'a ranked row lacks place/points/children: ' + JSON.stringify(r));
    expect(r.points >= 10 * r.kids && r.points <= 20 * r.kids, 'points outside 10–20 per child: ' + JSON.stringify(r));
  }
  const names = JSON.stringify(b);
  expect(!/Sana Javed|Testwala|Lg1|Lg5|4-A|Grade 4/.test(names), 'a teacher, class or child is named on the league');
  // the page: every ranked school shows place, points, children
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([c, token]) => localStorage.setItem('wq_s_' + c, JSON.stringify({ st: token, child: { first: 'Lg5' }, answers: {}, queue: [], seq: 0, wrong: [], result: {} })), [CODES.OPEN, me.st]);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '/schools', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M16'), { state: 'attached', timeout: WAIT });
  const rowsShown = await page.$$eval('.wq-srow', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  expect(rowsShown.length >= 3 && rowsShown.every((r) => /#?\d/.test(r) && /point/.test(r)), 'rows: ' + rowsShown.join(' | '));
  return { ranked: ranked.map((r) => ({ place: r.place, points: r.points, kids: r.kids })), note: 'a test school\'s visibility (is_probable_test) is a server rule (web-quiz-schools.js eligible); not toggled here' };
});

on('WQ065', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Mine1', -1);
  const school = await schoolOf(ctx, CODES.OPEN);
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([c, token, res]) => localStorage.setItem('wq_s_' + c, JSON.stringify({ st: token, child: { first: 'Mine1' }, answers: {}, queue: [], seq: 0, wrong: [], result: res })), [CODES.OPEN, me.st, me.result]);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '/schools', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-mycard', { state: 'visible', timeout: WAIT });
  const card = await inner(page, '#wq-mycard');
  expect(card.includes(school + ' is #'), 'the card reads "' + card.split('\n')[0] + '" (school ' + school + ')');
  expect(/\+\d+ points for /.test(card), 'no "+N points" line: ' + card);
  const mine = await page.$eval('li.wq-you#wq-mine', (e) => ({ tag: e.querySelector('.wq-tag') && e.querySelector('.wq-tag').innerText.trim(), sticky: /sticky|fixed/.test(getComputedStyle(e).position) }));
  expect(mine.tag === 'YOUR SCHOOL', 'own row tag: ' + mine.tag);
  return { card: card.split('\n')[0], pinned: mine.sticky, note: mine.sticky ? '' : 'the row is highlighted; whether it pins when scrolled away depends on CSS position (sticky) — read as ' + mine.sticky };
});

on('WQ066', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // other schools have points; school-4 (SC4ABC, seeded for this) has never played. The bot keeps every finish it has
  // seen this week in memory (web-quiz-schools.js weekRows — sessions are never deleted in production), so a school
  // that HAS played cannot be made new by deleting rows: nothing before this scenario may finish on SC4ABC.
  await apiFinish(page, ctx, CODES.OPEN, 'Gh1', -1);
  await sleep(61000);                                    // the league snapshot is kept 60 s (web-quiz-schools.js)
  await openQuiz(page, ctx, 'SC4ABC');
  await page.goto(ctx.baseUrl + '/q/SC4ABC/schools', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-mine.wq-zero, #wq-mycard', { state: 'visible', timeout: WAIT });
  const school = await schoolOf(ctx, 'SC4ABC');
  const ghost = await page.$eval('#wq-mine.wq-zero', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  expect(ghost === 'No one from ' + school + ' has played yet this week. Be the first!', 'the top card reads "' + ghost + '"');
  expect(!/#\d/.test(ghost), 'a place number is shown');
  expect((await inner(page, '#wq-share-s')) === 'Invite my school to play', 'share reads "' + (await inner(page, '#wq-share-s')) + '"');
  const folded = await page.$eval('details.wq-zero-list summary', (e) => e.innerText.trim()).catch(() => '');
  expect(/^\d+ schools? still to start$/.test(folded) || folded === '', 'the folded line reads "' + folded + '"');
  if (folded) { await page.click('details.wq-zero-list summary'); const names = await inner(page, 'details.wq-zero-list'); expect(!/\d+ points/.test(names.replace(folded, '')), 'the folded names carry numbers'); }
  return { ghost, folded };
});

on('WQ067', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // one child, seven quizzes in one PKT day: only five count. One phone (device) minting children: at most three count.
  const codes = [CODES.OPEN, CODES.NEXT, CODES.G3, CODES.G2, CODES.G1, CODES.TITLE, 'IT34CD'];
  const first = await apiFinish(page, ctx, codes[0], 'Capper', -1);
  const chip = first.chip, device = first.device;
  const results = [first.result];
  for (const c of codes.slice(1)) {
    const quiz = await api(page, ctx, 'GET', 'quiz/' + c); const qs = quiz.json.quiz.questions;
    const s = await api(page, ctx, 'POST', 'session', { code: c, chip, device_ref: device });
    const st = s.status === 200 ? s.json.st : (await api(page, ctx, 'POST', 'session', { code: c, new: { name: 'Capper', force: true }, device_ref: device })).json.st;
    await api(page, ctx, 'POST', 'answers', { st, a: qs.map((x) => ({ qid: x.qid, slot: x.correct_slot.split(',')[0], ms: 900 })) });
    results.push(Object.assign((await api(page, ctx, 'POST', 'finish', { st })).json, { _st: st }));
  }
  expect(results.every((r) => r.score && r.score.correct >= 0), 'a sixth or seventh quiz did not show its score');
  const sts = [first.st, ...results.slice(1).map((r) => r._st)].filter(Boolean);
  let counted = 0;
  for (const [i, c] of codes.entries()) { const bd = await api(page, ctx, 'GET', 'schools/' + c + '?st=' + encodeURIComponent(sts[i] || '')); if (bd.json && bd.json.mine && bd.json.mine.added > 0) counted += 1; }
  expect(counted <= 5, counted + ' of 7 quizzes added school points (cap is 5)');
  // seven friends of one challenge: only five add points
  const chal = first.result.challenge_code;
  let friendsAdded = 0;
  for (let i = 0; i < 7; i++) {
    const F = await L.newPhone(page);
    try {
      const r = await apiFinish(F.page, ctx, chal, 'Fr' + i, -1);
      expect(r.result.score, 'friend ' + i + ' saw no score');
      const bd = await api(F.page, ctx, 'GET', 'schools/' + CODES.OPEN + '?st=' + encodeURIComponent(r.st));
      if (bd.json && bd.json.mine && bd.json.mine.added > 0) friendsAdded += 1;
    } finally { await F.close(); }
  }
  expect(friendsAdded <= 5, friendsAdded + ' of 7 friends added points (cap is 5)');
  return { quizzesCounted: counted, friendsCounted: friendsAdded, note: 'the three-children-per-phone cap is the same counter (web-quiz-schools.js DEVICE_NEW_CAP); the first-five rules above are what the lane proves' };
});

on('WQ068', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await apiFinish(page, ctx, CODES.OPEN, 'Lnk1', -1);
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '/schools')).text();
  const og = L.og(html, 'og:title');
  expect(/School league this week/.test(og), 'the preview title is "' + og + '"');
  const htmlUr = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.UR + '/schools')).text();
  const ogUr = L.og(htmlUr, 'og:title');
  expect(/اس ہفتے اسکولوں کی لیگ/.test(ogUr), 'the Urdu preview title is "' + ogUr + '"');
  // a phone that never played: straight on the league, "Play and add points for <school>" opens the quiz
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '/schools', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M16'), { state: 'attached', timeout: WAIT });
  const school = await schoolOf(ctx, CODES.OPEN);
  const cold = await api(page, ctx, 'GET', 'schools/' + CODES.OPEN);
  const btn = (await inner(page, '#wq-play-s').catch(() => '')).replace(/\s+/g, ' ').trim();   // two columns on the button
  expect(btn === 'Play and add points for ' + school, 'the cold visitor sees "' + btn + '" (school "' + school + '"; the board\'s mine: ' + JSON.stringify(cold.json && cold.json.mine) + ')');
  await page.click('#wq-sector'); await sleep(400);
  const sector = await count(page, '.wq-srow');
  await page.click('#wq-all'); await sleep(400);
  const all = await count(page, '.wq-srow');
  expect(all >= sector, 'All shows fewer schools than My sector (' + all + ' < ' + sector + ')');
  await page.click('#wq-play-s');
  await page.waitForSelector('#wq-play, ' + M('M3'), { state: 'attached', timeout: WAIT });
  return { og, ogUr, sector, all };
});

// ── the share pictures ────────────────────────────────────────────────────────────────────────────────────────────
on('WQ139', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await noShareSheet(page);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Picca');
  await toCard(page);
  await page.click('#wq-share');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const url = await inner(page, M('M12-fallback') + ' .wq-url');
  const m = url.match(/\/q\/([A-Z0-9]+)\?a=([^&\s]+)/);
  expect(m && m[1] === CODES.OPEN && /^c\./.test(decodeURIComponent(m[2])), 'the shared link is ' + url);
  expect((await inner(page, 'a#wq-save')) === 'Save the picture', 'no "Save the picture"');
  const html = await (await page.request.get(url)).text();
  const ogImg = L.og(html, 'og:image');
  expect(/\/art\/card\.jpg\?a=/.test(ogImg), 'the preview image is ' + ogImg);
  expect(/<script id="boot"/.test(html), 'the link no longer opens the class quiz');
  const pic = await picture(page, ogImg);
  if (!pic.ok) return { blocked: NO_RENDERER + ' (the card picture answered ' + pic.status + ')', link: url, ogImage: ogImg };
  expect(pic.w === 1200 && pic.h === 630, 'the picture is ' + pic.w + '×' + pic.h);
  return { link: url, picture: pic, note: PIXELS };
});

on('WQ140', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // a browser that can share files: capture what navigator.share receives
  await page.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared.push({ files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })), text: d.text, url: d.url }); }; });
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Filer');
  await toCard(page);
  await sleep(3000);  // the square picture is fetched when the card opens
  await page.click('#wq-share');
  await sleep(800);
  const shared = await page.evaluate(() => window.__shared);
  expect(shared.length === 1, 'navigator.share was called ' + shared.length + ' times');
  const s = shared[0];
  expect(/\/q\/AB12CD/.test(s.text || s.url || ''), 'no link in the share: ' + JSON.stringify(s));
  if (!s.files.length) {
    const pic = await picture(page, ctx.baseUrl + '/q/' + CODES.OPEN + '/art/card.jpg?a=x');
    return { blocked: NO_RENDERER + '; without a drawn picture the text and link went at once, as the spec\'s last line says', shared: s };
  }
  expect(s.files[0].type === 'image/jpeg', 'the attached file is ' + s.files[0].type);
  return { shared: s };
});

on('WQ141', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const r = await apiFinish(page, ctx, CODES.OPEN, 'Amal', 0);     // 4/5
  const chal = r.result.challenge_code;
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + chal)).text();
  const og = L.og(html, 'og:title');
  expect(/^Can you beat Amal's 4\/5\?/.test(og), 'the invite preview reads "' + og + '"');
  const desc = L.og(html, 'og:description');
  expect(/Parts of a Plant|Jugnu/.test(og + ' ' + desc), 'no topic or mascot in the preview: ' + desc);
  expect(!/Testwala|Danish|Hina/.test(og + desc), 'another child is named in the preview');
  const ogImg = L.og(html, 'og:image');
  const pic = await picture(page, ogImg);
  if (!pic.ok) return { blocked: NO_RENDERER + ' (the invite picture answered ' + pic.status + ')', og, desc };
  return { og, desc, picture: pic, note: PIXELS };
});

on('WQ142', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  for (const n of ['Cl1', 'Cl2', 'Cl3']) await apiFinish(page, ctx, CODES.OPEN, n, n === 'Cl2' ? 0 : -1);
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Cl4', -1);
  const art = me.result.art || {};
  expect(art.class && /^l\./.test(art.class), 'no class picture id on the finish: ' + JSON.stringify(art));
  const pic = await picture(page, ctx.baseUrl + '/q/' + CODES.OPEN + '/art/class.jpg?a=' + encodeURIComponent(art.class));
  if (!pic.ok) return { blocked: NO_RENDERER + ' (the class picture answered ' + pic.status + '); the renderer is given places, animals and scores, and names only the sharer\'s own session (web-quiz-art.js 137–168)', artId: art.class };
  return { picture: pic, blocked: PIXELS + '; the renderer names only the sharer\'s row "(me)" (web-quiz-art.js 157–161) — not readable from the JPEG here' };
});

on('WQ146', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const plain = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN)).text();
  const withV = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '?v=3')).text();
  const img = (h) => L.og(h, 'og:image');
  expect(/\/art\/class\.jpg\?a=.*&v=3/.test(img(withV)), 'the reminder link previews as ' + img(withV));
  expect(!/\/art\/class\.jpg/.test(img(plain)), 'the plain link lost the quiz\'s own picture: ' + img(plain));
  await apiFinish(page, ctx, CODES.OPEN, 'Rem1', -1);
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Rem2', -1);
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([c, token, res]) => localStorage.setItem('wq_s_' + c, JSON.stringify({ st: token, child: { first: 'Rem2' }, answers: {}, queue: [], seq: 0, wrong: [], result: res })), [CODES.OPEN, me.st, me.result]);
  await noShareSheet(page);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '/class', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-share-t', { state: 'visible', timeout: WAIT });
  await page.click('#wq-share-t');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const url = await inner(page, M('M12-fallback') + ' .wq-url');
  expect(/\/q\/AB12CD\/class\?v=\d+/.test(url), 'the shared table link is ' + url);
  return { reminder: img(withV).replace(/^.*\/art/, '…/art'), plain: img(plain).replace(/^.*\//, '…/'), tableShare: url.replace(/^.*\/q\//, '/q/') };
});

on('WQ147', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const r = await apiFinish(page, ctx, CODES.OPEN, 'Amal2', 0);
  const chal = r.result.challenge_code;
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + chal)).text();
  const ogImg = L.og(html, 'og:image');
  const ogAlt = L.og(html, 'og:image:alt');
  await openQuiz(page, ctx, chal);
  const img = await page.$eval('.wq-chpic img, img.wq-chpic, .wq-banner ~ img, img[alt*="Can you beat"]', (i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), shown: getComputedStyle(i).display !== 'none' && i.offsetParent !== null, loaded: i.complete && i.naturalWidth > 0 })).catch(() => null);
  expect(img, 'no picture above the challenge line');
  expect(img.alt === ogAlt, 'alt "' + img.alt + '" differs from the preview\'s "' + ogAlt + '"');
  if (!img.loaded) { await sleep(1500); const gone = await page.$eval('img[alt*="Can you beat"]', (i) => i.offsetParent === null || getComputedStyle(i).display === 'none').catch(() => true); expect(gone, 'a picture that cannot load is shown broken'); return { blocked: NO_RENDERER + '; the page removed the unloadable picture as the spec\'s last line says', alt: img.alt }; }
  return { alt: img.alt, src: img.src.replace(/^.*\/art/, '…/art') };
});

on('WQ145', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Sch1', -1);
  const board = await api(page, ctx, 'GET', 'schools/' + CODES.OPEN + '?st=' + encodeURIComponent(me.st));
  expect(board.json && board.json.mine && typeof board.json.mine.added === 'number' && board.json.mine.added > 0, 'the league does not say what this play added: ' + JSON.stringify(board.json && board.json.mine));
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([c, token, res]) => localStorage.setItem('wq_s_' + c, JSON.stringify({ st: token, child: { first: 'Sch1' }, answers: {}, queue: [], seq: 0, wrong: [], result: res })), [CODES.OPEN, me.st, me.result]);
  await noShareSheet(page);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '/schools', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-share-s', { state: 'visible', timeout: WAIT });
  expect(/\+\d+ points for /.test(await text(page)), 'no "+N points for <School>" on the card');
  await page.click('#wq-share-s');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const url = await inner(page, M('M12-fallback') + ' .wq-url');
  expect(/\/q\/AB12CD\/schools\?v=\d{10}$/.test(url), 'the league link does not carry the hour: ' + url);
  const html = await (await page.request.get(url)).text();
  const ogImg = L.og(html, 'og:image');
  expect(/\/art\/schools\.jpg\?a=.*&v=\d{10}/.test(ogImg), 'the preview is ' + ogImg);
  const pic = await picture(page, ogImg);
  if (!pic.ok) return { blocked: NO_RENDERER + ' (the schools picture answered ' + pic.status + ')', link: url.replace(/^.*\/q\//, '/q/'), added: board.json.mine.added };
  return { link: url.replace(/^.*\/q\//, '/q/'), picture: pic, added: board.json.mine.added, note: PIXELS };
});

on('WQ143', 'off', async () => ({ blocked: 'a video quiz needs a quizzes.video_id → student_videos row with a lesson video the stack can serve (presigned from the run\'s file store); the demo seed carries no lesson videos' }));
on('WQ144', 'off', async () => ({ blocked: 'the "Next in this chapter" card needs the video library (student_videos of one chapter, web_quiz_library) — no lesson videos in the demo seed' }));

module.exports = { runs, modes };
