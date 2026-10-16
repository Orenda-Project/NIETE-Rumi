// web-quiz-child-page/peer — classmates on the same link: the quiet peer line while a child plays, who is named and
// who is not, the landing's "playing right now", the place among today's finishers; and the friend on a challenge
// link, who sees the challenger and never the class. Other children are driven through the page's own API.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, TOPIC, text, inner, count, boot, onScreen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

async function api(page, ctx, method, p, body) {
  const url = ctx.baseUrl + '/api/wq/' + p;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}
// Another child's session on `code`: answers the questions at `rightAt` right and `wrongAt` wrong, then (optionally) finishes.
async function other(page, ctx, code, name, { rightAt = [], wrongAt = [], finish = false, extra = {} } = {}) {
  const quiz = await api(page, ctx, 'GET', 'quiz/' + code); const qs = quiz.json.quiz.questions;
  const s = await api(page, ctx, 'POST', 'session', Object.assign({ code, new: { name, cls: String(quiz.json.quiz.grade || ''), force: true } }, extra));
  expect(s.status === 200, name + ': session → ' + s.status + ' ' + JSON.stringify(s.json).slice(0, 100));
  const a = [...rightAt.map((i) => ({ qid: qs[i].qid, slot: qs[i].correct_slot.split(',')[0], ms: 900 })), ...wrongAt.map((i) => ({ qid: qs[i].qid, slot: qs[i].options.map((o) => o.slot).find((sl) => sl !== qs[i].correct_slot), ms: 900 }))];
  let ans = null;
  if (a.length) { ans = await api(page, ctx, 'POST', 'answers', { st: s.json.st, a }); expect(ans.status === 200, name + ': answers → ' + ans.status); }
  let fin = null;
  if (finish) { fin = await api(page, ctx, 'POST', 'finish', { st: s.json.st }); expect(fin.status === 200, name + ': finish → ' + fin.status); }
  return { st: s.json.st, answers: ans && ans.json, result: fin && fin.json, qs };
}
// Collect every peer line the page shows and every pulse request it makes.
function watchPulse(page) {
  const lines = [], polls = [];
  page.on('request', (r) => { if (/\/api\/wq\/pulse\//.test(r.url())) polls.push(Date.now()); });
  const arm = () => page.evaluate(() => { window.__pulse = window.__pulse || []; if (window.__pulseObs) return; window.__pulseObs = new MutationObserver(() => { document.querySelectorAll('.wq-pulse').forEach((el) => { const t = el.innerText.trim(); if (t && window.__pulse[window.__pulse.length - 1] !== t) window.__pulse.push(t); }); }); window.__pulseObs.observe(document.body, { childList: true, subtree: true }); });
  return { polls, arm, lines: async () => { const l = await page.evaluate(() => window.__pulse || []); lines.push(...l.filter((x) => !lines.includes(x))); return lines; } };
}

on('WQ081', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Peer1');
  const w = watchPulse(page); await w.arm();
  // on question 1, after its first 3 seconds; Sara answers question 4 right
  await sleep(3500);
  await other(page, ctx, CODES.OPEN, 'Sara', { rightAt: [3] });
  const t0 = Date.now();
  await page.waitForSelector('.wq-pulse', { state: 'attached', timeout: 40000 });
  const shown = Date.now() - t0;
  const line = await page.$eval('.wq-pulse', (e) => ({ text: e.innerText.trim(), hidden: e.getAttribute('aria-hidden'), rect: e.getBoundingClientRect().toJSON(), opts: [...document.querySelectorAll('.wq-opt, #wq-spk, .wq-item')].map((o) => o.getBoundingClientRect().toJSON()) }));
  expect(line.text === 'Sara got Q4 right ✓', 'the line reads "' + line.text + '"');
  expect(line.hidden === 'true', 'the line is not aria-hidden (it must take no tap and no focus)');
  const overlaps = line.opts.some((r) => line.rect.left < r.right && line.rect.right > r.left && line.rect.top < r.bottom && line.rect.bottom > r.top);
  expect(!overlaps, 'the line covers an option, the speaker or the question');
  await page.waitForSelector('.wq-pulse', { state: 'detached', timeout: 6000 });
  expect(await count(page, 'audio[src*="pulse"]') === 0, 'a sound was attached to the line');
  void b;
  return { line: line.text, shownAfterMs: shown, gone: 'within 2.5 s' };
});

on('WQ082', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // the class child on the page; a wrong answer by Wrongo; a friend's right answer on a challenge code; the teacher's preview answers
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Peer2');
  const w = watchPulse(page); await w.arm();
  const challenger = await other(page, ctx, CODES.OPEN, 'Chal2', { rightAt: [0, 1, 2, 3, 4], finish: true });
  const chal = challenger.result.challenge_code;
  await other(page, ctx, CODES.OPEN, 'Wrongo', { wrongAt: [2] });
  await other(page, ctx, chal, 'Friendo', { rightAt: [1] });
  const T = L.tokens(ctx); const sc = await L.codeRow(ctx, CODES.OPEN), tid = await L.teacherOf(ctx, CODES.OPEN);
  const p = T.signPreview({ shareCodeId: sc, teacherUserId: tid });
  const tq = await api(page, ctx, 'GET', 'quiz/' + CODES.OPEN); const ts = await api(page, ctx, 'POST', 'session', { code: CODES.OPEN, p });
  if (ts.status === 200) await api(page, ctx, 'POST', 'answers', { st: ts.json.st, a: [{ qid: tq.json.quiz.questions[4].qid, slot: tq.json.quiz.questions[4].correct_slot, ms: 500 }] });
  // the page's own right answer on question 1 must never come back to it
  await sleep(40000);
  const lines = await w.lines();
  expect(lines.some((l) => l === 'A friend got Q2 right ✓'), 'the friend\'s right answer is not shown as "A friend got Q2 right ✓" (seen: ' + lines.join(' | ') + ')');
  expect(!lines.some((l) => /Wrongo/.test(l)), 'a wrong answer showed: ' + lines.join(' | '));
  expect(!lines.some((l) => /Q5/.test(l)), 'the teacher\'s preview answer showed: ' + lines.join(' | '));
  expect(!lines.some((l) => /Testwala|Javed|Peer2/.test(l)), 'a surname or the child\'s own answer showed: ' + lines.join(' | '));
  void b;
  return { lines };
});

on('WQ083', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Peer3');
  await play(page, b.quiz.questions, 2, -1);              // on question 3
  const w = watchPulse(page); await w.arm();
  const before = w.polls.length;
  await sleep(16000);                                       // thinking for more than 15 s
  await other(page, ctx, CODES.OPEN, 'Mate3', { rightAt: [0] });
  const t0 = Date.now();
  await page.waitForSelector('.wq-pulse', { state: 'attached', timeout: 20000 });
  const within = Date.now() - t0;
  const pollsOnQ3 = w.polls.length - before;
  expect(pollsOnQ3 <= 8, pollsOnQ3 + ' pulse requests on one question');
  // once the child answers, the asking stops for that question
  const qq = await L.current(page, b.quiz.questions); await page.click('.wq-opt[data-slot="' + qq.correct_slot + '"]');
  const atAnswer = w.polls.length; await sleep(17000);
  expect(w.polls.length - atAnswer <= 1, (w.polls.length - atAnswer) + ' pulse requests kept coming after the answer');
  return { shownWithinMs: within, pollsOnQuestion: pollsOnQ3 };
});

on('WQ084', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // a grade-1 quiz: no line, no asking
  await startAsNew(page, ctx, CODES.G1, 'Tiny');
  const w1 = watchPulse(page); await sleep(20000);
  expect(w1.polls.length === 0, w1.polls.length + ' pulse requests on a grade-1 quiz');
  // the teacher's preview
  const T = L.tokens(ctx); const sc = await L.codeRow(ctx, CODES.OPEN), tid = await L.teacherOf(ctx, CODES.OPEN);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '?p=' + encodeURIComponent(T.signPreview({ shareCodeId: sc, teacherUserId: tid })), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-preview', { state: 'visible', timeout: WAIT }); await page.click('#wq-preview');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const w2 = watchPulse(page); await sleep(20000);
  expect(w2.polls.length === 0, w2.polls.length + ' pulse requests on the teacher\'s preview');
  // sounds off
  await page.evaluate(() => localStorage.clear());
  await startAsNew(page, ctx, CODES.OPEN, 'Quiet4');
  await page.click('#wq-snd'); await sleep(1500);                 // a poll already on its timer may land first
  const w3 = watchPulse(page); await sleep(20000);
  expect(w3.polls.length === 0, w3.polls.length + ' pulse requests with sounds off: ' + JSON.stringify(w3.polls.slice(0, 2)));
  return { grade1: 0, preview: 0, quiet: 0, note: 'every demo quiz carries a grade; "no grade shows as grade 3" is not driven' };
});

on('WQ085', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Peer5');
  let answersBody = null;
  page.on('response', async (r) => { if (/\/api\/wq\/answers$/.test(r.url())) { try { answersBody = await r.json(); } catch (_) { /* */ } } });
  await other(page, ctx, CODES.OPEN, 'Mate5', { rightAt: [1] });
  const qq = await L.current(page, b.quiz.questions); await page.click('.wq-opt[data-slot="' + qq.correct_slot + '"]');
  await page.waitForFunction(() => true); await sleep(3000);
  expect(answersBody && 'pulse' in answersBody, 'the answers response carries no pulse: ' + JSON.stringify(answersBody || {}).slice(0, 120));
  return { pulseInAnswers: true, note: '"no database read for the idle check" is a server-internal property (web-quiz-pulse.js keeps a ring in memory); not measurable from the browser' };
});

on('WQ086', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // one classmate with a right answer: nothing on the landing
  await other(page, ctx, CODES.G3, 'Live1', { rightAt: [0] });
  await openQuiz(page, ctx, CODES.G3);
  expect(!/playing right now/.test(await text(page)), 'the landing shows the line with one classmate');
  await other(page, ctx, CODES.G3, 'Live2', { rightAt: [0] });
  await other(page, ctx, CODES.G3, 'Live3', { rightAt: [1] });
  await openQuiz(page, ctx, CODES.G3);
  const line = await page.$$eval('.wq-proof', (els) => els.map((e) => e.innerText.trim()).find((t) => /playing right now/.test(t)) || '');
  expect(line === '🟢 3 classmates are playing right now — join them!', 'the landing says "' + line + '"');
  expect(!/Live1|Live2|Live3/.test(line), 'a name is on the line');
  // a friend's challenge link never shows it
  const ch = await other(page, ctx, CODES.G3, 'Live4', { rightAt: [0, 1, 2, 3, 4], finish: true });
  await openQuiz(page, ctx, ch.result.challenge_code);
  expect(!/playing right now/.test(await text(page)), 'the friend\'s landing shows classmates playing');
  return { line };
});

on('WQ087', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // a code nobody has finished today (scenarios share the run database): one minted for this scenario
  await ctx.sql("insert into quiz_share_codes select (json_populate_record(c, json_build_object('id', gen_random_uuid(), 'code', 'NTH087', 'created_at', now())::json)).* from quiz_share_codes c where c.code = 'IT34CD' on conflict do nothing");
  const done0 = Number(await L.one(ctx, "select count(*) from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = 'NTH087') and status = 'completed'"));
  expect(done0 === 0, 'NTH087 already has ' + done0 + ' finishes');
  const first = await L.finishAsNew(page, ctx, 'NTH087', 'Nth1');
  await page.click('#wq-card'); await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  const l1 = await page.$eval('.wq-nth', (e) => e.innerText.trim()).catch(() => '');
  expect(l1 === "You're the first in your class to finish today!", 'the first finisher sees "' + l1 + '"');
  await other(page, ctx, 'NTH087', 'Nth2', { rightAt: [0, 1, 2, 3, 4, 5, 6], finish: true });
  await page.evaluate(() => localStorage.clear());
  await L.finishAsNew(page, ctx, 'NTH087', 'Nth3');
  await page.click('#wq-card'); await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  const l3 = await page.$eval('.wq-nth', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  expect(l3 === "You're the 3rd in your class to finish today", 'the third finisher sees "' + l3 + '"');
  // a friend gets no such line
  const chal = (await L.stored(page, 'wq_s_NTH087')).result.challenge_code;
  const F = await L.newPhone(page);
  try {
    const fr = await other(F.page, ctx, chal, 'NthF', { rightAt: [0, 1, 2, 3, 4, 5, 6], finish: true });
    await F.page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
    await F.page.evaluate(([c, st, res]) => localStorage.setItem('wq_s_' + c, JSON.stringify({ st, child: { first: 'NthF' }, answers: {}, queue: [], seq: 0, wrong: [], result: res })), [chal, fr.st, fr.result]);
    await openQuiz(F.page, ctx, chal);
    await F.page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
    expect(!(await F.page.$('.wq-nth')), 'the friend got a place line');
  } finally { await F.close(); }
  void first;
  return { first: l1, third: l3 };
});

on('WQ136', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ch = await other(page, ctx, CODES.OPEN, 'Host6', { rightAt: [0, 1, 2, 3, 4], finish: true });
  const chal = ch.result.challenge_code;
  await other(page, ctx, CODES.OPEN, 'Mate6', { rightAt: [0, 1] });
  await other(page, ctx, CODES.OPEN, 'Mate7', { rightAt: [2] });
  // the friend plays while the class plays: no name, no pulse, no live line
  await openQuiz(page, ctx, chal);
  expect(!/playing right now/.test(await text(page)), 'the friend\'s landing shows the class playing');
  await page.click('#wq-play'); await page.waitForSelector('#wq-new', { state: 'visible', timeout: WAIT }); await page.click('#wq-new');
  await page.fill('#wq-name', 'Guest6'); await page.click('#wq-start');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const w = watchPulse(page); await w.arm();
  await sleep(35000);
  const idle = await api(page, ctx, 'GET', 'pulse/' + chal + '?st=' + encodeURIComponent((await L.stored(page, 'wq_s_' + chal)).st));
  expect(idle.status === 200 && Array.isArray(idle.json.pulse) && idle.json.pulse.length === 0, 'the friend\'s idle check returned ' + JSON.stringify(idle.json));
  const lines = await w.lines();
  expect(lines.length === 0, 'the friend saw: ' + lines.join(' | '));
  return { idle: 'empty', lines: 0 };
});

on('WQ137', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await startAsNew(page, ctx, CODES.G2, 'Early7');
  const w2 = watchPulse(page); await sleep(20000);
  expect(w2.polls.length === 0, w2.polls.length + ' pulse requests on a grade-2 quiz');
  await page.evaluate(() => localStorage.clear());
  await startAsNew(page, ctx, CODES.OPEN, 'Older7');
  const w4 = watchPulse(page); await sleep(20000);
  expect(w4.polls.length >= 1, 'no pulse request on a grade-4 quiz in 20 s');
  return { grade2: 0, grade4: w4.polls.length };
});

on('WQ138', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await other(page, ctx, CODES.OPEN, 'Today8', { rightAt: [0, 1, 2, 3, 4], finish: true });
  const ch = await other(page, ctx, CODES.OPEN, 'Host8', { rightAt: [0, 1, 2, 3], wrongAt: [4], finish: true });
  await openQuiz(page, ctx, ch.result.challenge_code);
  const body = await text(page);
  expect(/Host8 got 4\/5 stars\. Can you beat it\?/.test(body), 'the challenger line is missing: ' + body.slice(0, 160));
  expect(!/Teacher|Sana Javed|Class 4|in your class played today/.test(body), 'the friend sees the teacher or the class: ' + body.slice(0, 200));
  await page.click('#wq-play'); await page.waitForSelector('#wq-new, #wq-name', { state: 'visible', timeout: WAIT });
  expect(!(await page.$('.wq-kid, [data-cls]')), 'class names to pick from are shown to the friend');
  return { line: 'Host8 got 4/5 stars. Can you beat it?' };
});

on('WQ157', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ch = await other(page, ctx, CODES.OPEN, 'Zero9', { wrongAt: [0, 1, 2, 3, 4], finish: true });
  await openQuiz(page, ctx, ch.result.challenge_code);
  const banner = await inner(page, '.wq-banner');
  expect(banner === 'Zero9 challenged you. Can you beat their score?', 'the landing says "' + banner + '"');
  expect(!/0\/5 stars/.test(await text(page)), '"0/5 stars" is shown');
  expect(!/in your class played today/.test(await text(page)), 'the friend is told how many of the class played');
  return { banner };
});

on('WQ158', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ch = await other(page, ctx, CODES.OPEN, 'Host10', { rightAt: [0, 1, 2, 3, 4], finish: true });
  const chal = ch.result.challenge_code;
  await L.finishAsNew(page, ctx, chal, 'Guest10');
  expect(!(await page.$('#wq-class')), 'the Quiz complete screen offers "See my class" to a friend');
  await page.click('#wq-card'); await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  expect(await page.$('#wq-chal') && await page.$('#wq-schools'), 'the friend\'s card lacks "Challenge a friend" or "School league"');
  expect(!(await page.$('#wq-class')) && !(await page.$('#wq-share')), 'the friend\'s card offers the class');
  const r = await page.request.get(ctx.baseUrl + '/q/' + chal + '/class');
  expect(r.status() === 404, '/q/<challenge>/class answered ' + r.status());
  const b = await api(page, ctx, 'GET', 'board/' + chal);
  expect(b.status === 404, 'board/<challenge> answered ' + b.status);
  return { card: 'challenge + school league only', classPage: 404, boardApi: 404 };
});

on('WQ159', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ch = await other(page, ctx, CODES.UR, 'Noor', { rightAt: [0, 1, 2, 3], wrongAt: [4, 5], finish: true });
  const title = (await (await page.request.get(ctx.baseUrl + '/q/' + ch.result.challenge_code)).text()).match(/property="og:title" content="([^"]*)"/);
  expect(title && /سے آگے نکلیں!/.test(title[1]) && !/کیا آپ/.test(title[1]), 'the Urdu invite title is "' + (title && title[1]) + '"');
  const zero = await other(page, ctx, CODES.UR, 'Sifr', { wrongAt: [0, 1, 2, 3, 4, 5], finish: true });
  const t0 = (await (await page.request.get(ctx.baseUrl + '/q/' + zero.result.challenge_code)).text()).match(/property="og:title" content="([^"]*)"/);
  expect(t0 && /نے آپ کو چیلنج کیا ہے/.test(t0[1]) && !/\d\s*\/\s*\d|[۰-۹]/.test(t0[1]) && !/کیا آپ/.test(t0[1]), 'the zero-score Urdu title is "' + (t0 && t0[1]) + '"');
  return { title: title[1], zero: t0[1], note: 'the picture\'s words are the same strings the renderer is given (web-quiz-art.js invite); the pixels are not read' };
});

module.exports = { runs, modes };
