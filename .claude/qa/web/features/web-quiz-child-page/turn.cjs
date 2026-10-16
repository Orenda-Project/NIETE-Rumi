// web-quiz-child-page/turn — one phone, many children: the finished child's card hands the phone to the next child.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, onScreen, openQuiz, finishAsNew, stored, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

on('WQ135', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await finishAsNew(page, ctx, CODES.OPEN, 'Tooba135');   // not a class-list name: a typed roster name takes the confirm path
  const before = await L.rows(ctx, "select q.id, row_to_json(q)::text from quiz_sessions q join students s on s.id = q.student_id where s.student_name = 'Tooba135' and q.share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ') order by q.created_at desc limit 1');
  expect(before.length, 'no finished session for Tooba');
  // the page reopens on Tooba's card
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M10') + ' .wq-scorecard', { state: 'visible', timeout: WAIT });
  await page.waitForSelector('#wq-turn', { state: 'visible', timeout: WAIT });
  const turn = await inner(page, '#wq-turn');
  expect(turn === "Someone else's turn", 'the card offers "' + turn + '"');
  // while answers are still waiting to be sent, the card does not offer it (the saved state carries the queue)
  const key = 'wq_s_' + CODES.OPEN;
  const saved = await stored(page, key);
  expect(saved && saved.result, 'no saved state under ' + key);
  await page.evaluate(([k, s]) => { s.queue = [{ qid: 'pending-check', slot: 'A', ms: 1, seq: 999 }]; localStorage.setItem(k, JSON.stringify(s)); }, [key, saved]);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq[data-m]', { state: 'attached', timeout: WAIT });
  await L.sleep(1200);
  const screenWithQueue = await page.getAttribute('#wq', 'data-m');
  expect(!(await page.$('#wq-turn')), 'the card offers the next turn while an answer waits to be sent (screen ' + screenWithQueue + ')');
  await page.evaluate(([k, s]) => { s.queue = []; localStorage.setItem(k, JSON.stringify(s)); }, [key, saved]);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-turn', { state: 'visible', timeout: WAIT });
  // the next child taps it: "Who is playing?" with the remembered cards and "Someone else"
  await page.click('#wq-turn');
  await page.waitForSelector('#wq-someone', { state: 'visible', timeout: WAIT });
  const body = await text(page);
  expect(/Who is playing\?|Who's playing\?/.test(body), 'the landing does not ask who is playing: ' + body.slice(0, 120));
  const cards = await page.$$eval('.wq-kid-big', (els) => els.map((e) => e.innerText.trim()));
  expect(cards.some((c) => /Tooba135/.test(c)), 'Tooba135 is not among the remembered cards: ' + JSON.stringify(cards));
  expect(/Someone else/.test(await inner(page, '#wq-someone')), '"Someone else" is missing');
  const after = await L.rows(ctx, 'select q.id, row_to_json(q)::text from quiz_sessions q where q.id = ' + q(before[0][0]));
  expect(after[0] && after[0][1] === before[0][1], 'Tooba\'s finished result changed: ' + before[0][1].slice(0, 200) + ' → ' + (after[0] ? after[0][1].slice(0, 200) : 'gone'));
  return { turn, cards, screenWithQueue, result: 'unchanged' };
});

module.exports = { runs, modes };
