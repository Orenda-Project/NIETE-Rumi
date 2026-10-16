// web-quiz-child-page/nav — the doors out of a quiz and the way back: the Home button and its sheet, Back through
// answered questions, the hub door on the card, the Jugnu card, the challenge panel ("Who can beat your score?"),
// and the old link that lands a finished child on their hub. Switches: web_quiz_hub, web_quiz_home_button,
// web_quiz_back_nav, web_quiz_hub_door, web_quiz_challenge_card, web_quiz_invite_ask, web_quiz_link_home (app_settings,
// read by the bot with a 30 s cache — lib.setFlag waits for the boot payload to reflect them).
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, TOPIC, text, inner, count, boot, onScreen, screen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

async function toCard(page) { await page.click('#wq-card'); await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT }); }
async function noShareSheet(page) { await page.addInitScript(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch (_) { /* fine */ } }); }
const rect = (page, sel) => page.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
const order = (page, sels) => page.evaluate((list) => list.map((s) => { const e = document.querySelector(s); return e ? [...document.querySelectorAll('#wq *')].indexOf(e) : -1; }), sels);

// ── Home ──────────────────────────────────────────────────────────────────────────────────────────────────────────
on('WQ206', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_home_button', 'true', (b) => b.nav && b.nav.home);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Homer');
  const home = await page.$eval('#wq-home', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, right: window.innerWidth - r.right, top: r.top, text: e.innerText.trim() }; });
  expect(home.w >= 48 && home.h >= 48, 'the Home button is ' + home.w + '×' + home.h);
  expect(home.right < 80 && home.top < 80, 'the Home button is not at the top right: ' + JSON.stringify(home));
  await play(page, b.quiz.questions, 5, -1); await toResults(page);
  expect(await page.$('#wq-home'), 'no Home on the results screen');
  await toCard(page);
  expect(await page.$('#wq-home'), 'no Home on the card');
  // during a question: the sheet, then Go home sends what waits and opens the hub
  await page.evaluate(() => localStorage.clear());
  const b2 = await startAsNew(page, ctx, CODES.OPEN, 'Homer2');
  await play(page, b2.quiz.questions, 1, -1);
  await page.click('#wq-home');
  await page.waitForSelector('#wq-sheet', { state: 'visible', timeout: WAIT });
  const ask = await inner(page, '#wq-sheet p');
  expect(/Go to your home page\?/.test(ask), 'the sheet asks "' + ask + '"');
  expect(/Your answers are saved\.|Saving your answers first\./.test(ask), 'the sheet does not say whether the answers are saved: "' + ask + '"');
  await page.click('#wq-gohome');
  await page.waitForURL(/\/h\/[A-Za-z0-9_-]+/, { timeout: WAIT });
  expect(/from=home/.test(page.url()), 'the hub was not counted as opened from Home: ' + page.url());
  // no Home before a child is chosen, on a friend's run, or on the teacher's test run
  await openQuiz(page, ctx, CODES.NEXT);
  expect(!(await page.$('#wq-home')), 'Home shows on the landing before a child is chosen');
  const fin = (await L.stored(page, 'wq_s_AB12CD'));
  const T = L.tokens(ctx); const sc = await L.codeRow(ctx, CODES.OPEN), tid = await L.teacherOf(ctx, CODES.OPEN);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '?p=' + encodeURIComponent(T.signPreview({ shareCodeId: sc, teacherUserId: tid })), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-preview', { state: 'visible', timeout: WAIT }); await page.click('#wq-preview');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  expect(!(await page.$('#wq-home')), 'Home shows on the teacher\'s test run');
  void fin;
  return { button: home, sheet: ask, hub: page.url().replace(/\/h\/[^?]+/, '/h/<token>') };
});

on('WQ207', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_home_button', 'true', (b) => b.nav && b.nav.home);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Homer3');
  await toCard(page);
  await page.click('#wq-hubdoor');
  await page.waitForURL(/\/h\//, { timeout: WAIT });
  await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
  const hub = page.url();
  const seen = {};
  for (const [tile, want] of [['#wq-h-ch', /\/c\//], ['#wq-h-lib', /\/lib\//]]) {
    if (!(await page.$(tile))) { seen[tile] = 'not offered'; continue; }
    await page.click(tile);
    await page.waitForURL(want, { timeout: WAIT });
    await page.waitForSelector('#wq-home, a#wq-home', { state: 'visible', timeout: WAIT });
    const href = await page.$eval('#wq-home', (e) => e.getAttribute('href') || e.getAttribute('data-href') || '');
    expect(/\/h\//.test(href), tile + ': Home points at ' + href);
    seen[tile] = href.replace(/\/h\/[^?]+/, '/h/<token>');
    await page.goto(hub, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
  }
  return seen;
});

// ── Back ──────────────────────────────────────────────────────────────────────────────────────────────────────────
on('WQ208', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_back_nav', 'true', (b) => b.nav && b.nav.back);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Backer');
  expect(!(await page.$('#wq-qback')), 'Back is shown on question 1 of a quiz with no video');
  await play(page, b.quiz.questions, 2, 1);                 // question 2 answered wrong
  const posted = []; page.on('request', (r) => { if (/\/api\/wq\/answers$/.test(r.url())) posted.push(1); });
  await page.click('#wq-qback');
  await page.waitForSelector(M('M6-review'), { state: 'attached', timeout: WAIT });
  const note = await inner(page, '.wq-revnote');
  expect(/You are looking at question 2 again\. Your first answer is the one that counts\./.test(note), 'the note reads "' + note + '"');
  const marks = await page.$$eval('.wq-review .wq-opt', (els) => ({ locked: els.every((e) => e.disabled && e.classList.contains('wq-locked')), picked: els.some((e) => e.classList.contains('wq-picked')), right: els.some((e) => e.classList.contains('wq-right')) }));
  expect(marks.locked && marks.picked && marks.right, 'the review does not show the pick and the right answer locked: ' + JSON.stringify(marks));
  expect(await page.$('.wq-fb .wq-why'), 'the reason the child saw is missing');
  expect((await inner(page, '#wq-revnext')) === 'Back to question 3', 'the return button reads "' + (await inner(page, '#wq-revnext')) + '"');
  await page.click('#wq-revnext');
  await page.waitForSelector(M('M6') + ' .wq-qof', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '.wq-qof')) === 'Question 3 of 5', 'did not return to question 3');
  expect(posted.length === 0, posted.length + ' answers were sent during the review');
  await play(page, b.quiz.questions, 3, -1); const got = await toResults(page);
  expect(got === 'You got 4 out of 5', 'the score changed: "' + got + '"');
  return { note, marks, score: got };
});

on('WQ209', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_back_nav', 'true', (b) => b.nav && b.nav.back);
  await L.setFlag(ctx, page, 'web_quiz_home_button', 'true', (b) => b.nav && b.nav.home);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Backer2');
  await play(page, b.quiz.questions, 2, -1);                 // on question 3
  await page.goBack(); await page.waitForSelector(M('M6-review'), { state: 'attached', timeout: WAIT });
  expect(/question 2 again/.test(await inner(page, '.wq-revnote')), 'the first Back did not show question 2');
  await page.goBack(); await sleep(800);
  expect(/question 1 again/.test(await inner(page, '.wq-revnote').catch(() => '')), 'the second Back did not show question 1');
  expect(/\/q\/AB12CD/.test(page.url()), 'the page closed');
  // on the results card, Back offers the home page
  await page.goForward().catch(() => {}); await page.goForward().catch(() => {});
  await page.waitForSelector(M('M6') + ' .wq-opt, ' + M('M6-review'), { state: 'attached', timeout: WAIT });
  if (await page.$('#wq-revnext')) await page.click('#wq-revnext');
  await play(page, b.quiz.questions, 3, -1); await toResults(page); await toCard(page);
  await page.goBack(); await page.waitForSelector('#wq-sheet', { state: 'visible', timeout: WAIT }).catch(() => {});
  const sheet = await page.$('#wq-sheet');
  expect(sheet, 'Back on the card did not offer the home page');
  return { steps: 'Q3 → Q2 → Q1 reviews', card: 'Go to your home page?' };
});

// ── the challenge panel ───────────────────────────────────────────────────────────────────────────────────────────
on('WQ210', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_invite_ask', '"on"', (b) => b.invite_ask === 'on');
  await noShareSheet(page);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Zara');
  await play(page, b.quiz.questions, 5, 2); await page.waitForSelector('#wq-fix', { state: 'visible', timeout: WAIT }); await page.click('#wq-later');
  await page.waitForSelector(M('M9') + ' h1', { state: 'visible', timeout: WAIT }); await toCard(page);
  const head = await inner(page, '.wq-ask h2');
  expect(head === '🏆 Who can beat your 4/5?', 'the panel asks "' + head + '"');
  const tiles = await page.$$eval('.wq-ask .wq-kid', (els) => els.map((e) => e.innerText.trim()));
  expect(tiles.join('|') === 'Someone at home|A cousin|A friend in my street', 'tiles: ' + tiles.join('|'));
  expect(!(await page.$('#wq-chal')), '"Challenge a friend" is still shown');
  const idx = await order(page, ['#wq-share', '.wq-ask', '#wq-hubdoor']);
  expect(idx[0] < idx[1] && (idx[2] === -1 || idx[1] < idx[2]), 'the panel is not right under Share (and before the door): ' + idx.join(','));
  await page.click('#wq-who-cousin');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const msg = await inner(page, M('M12-fallback') + ' .wq-card');
  expect(msg.includes('Zara here! I got 4/5 stars on ' + TOPIC + '. Can you beat me? 🏆 Tap the link to play:'), 'the share reads "' + msg + '"');
  expect(!/cousin|home|street/i.test(msg.replace(/Tap the link to play/, '')), 'the tile tapped shows in the words');
  await L.setFlag(ctx, page, 'web_quiz_invite_ask', '"split"', (b2) => b2.invite_ask === 'split');
  return { head, tiles, share: msg.split('\n')[0] };
});

on('WQ211', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_invite_ask', '"on"', (b) => b.invite_ask === 'on');
  await noShareSheet(page);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Lowy');
  // 2 of 5: three wrong
  for (let i = 0; i < 5; i++) { await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT }); const qq = await L.current(page, b.quiz.questions); await L.tapAndNext(page, i < 3 ? L.wrongSlot(qq) : qq.correct_slot); }
  await page.waitForSelector('#wq-fix', { state: 'visible', timeout: WAIT }); await page.click('#wq-later');
  await page.waitForSelector(M('M9') + ' h1', { state: 'visible', timeout: WAIT }); await toCard(page);
  const head = await inner(page, '.wq-ask h2');
  expect(head === '🏠 Play it with someone at home', 'the low-score panel says "' + head + '"');
  expect(!/\d\/\d/.test(head), 'a score is shown');
  await page.click('#wq-who-home');
  await page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
  const msg = await inner(page, M('M12-fallback') + ' .wq-card');
  expect(msg.includes('Lowy here! I played ' + TOPIC + '. Your turn! Tap the link to play:') && !/\d\/\d/.test(msg), 'the share reads "' + msg + '"');
  await L.setFlag(ctx, page, 'web_quiz_invite_ask', '"split"', (b2) => b2.invite_ask === 'split');
  return { head, share: msg.split('\n')[0] };
});

on('WQ212', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_invite_ask', '"split"', (b) => b.invite_ask === 'split');
  const ev = L.events(page);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Splitter'); await toCard(page);
  const arm1 = (await page.$('.wq-ask')) ? 'panel' : (await page.$('#wq-chal')) ? 'button' : 'neither';
  await ev.flush();                                             // card_view is sent once per finished session: catch it before the reload
  const views = ev.of('card_view');
  await openQuiz(page, ctx, CODES.OPEN); await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  const arm2 = (await page.$('.wq-ask')) ? 'panel' : (await page.$('#wq-chal')) ? 'button' : 'neither';
  expect(arm1 !== 'neither' && arm1 === arm2, 'the same phone saw ' + arm1 + ' then ' + arm2);
  expect(views.length && views.every((e) => e.band && e.v), 'card_view events do not say which arm (v) and band: ' + JSON.stringify(views.slice(0, 2)));
  expect(views.every((e) => (e.v === 'a1') === (arm1 === 'panel')), 'the event\'s arm ' + views[0].v + ' (a1 = panel, a0 = button) is not what the page showed (' + arm1 + ')');
  return { arm: arm1, band: views[0].band, v: views[0].v };
});

// ── the hub door ──────────────────────────────────────────────────────────────────────────────────────────────────
on('WQ177', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Doory'); await toCard(page);
  expect((await inner(page, '#wq-hubdoor')) === 'My quizzes, videos and challenges', 'no hub door on the card');
  await page.click('#wq-hubdoor');
  await page.waitForURL(/\/h\//, { timeout: WAIT });
  expect(/[?&]lang=en/.test(page.url()), 'the hub link carries no lang: ' + page.url());
  await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
  expect(await page.$('#wq-h-ch'), 'the hub has no challenge tile');
  expect(await page.$('#wq-h-lib, #wq-h-lib2'), 'the hub has no video library');
  const hubUrl = page.url();
  const B = await L.newPhone(page);
  try {
    await B.page.goto(hubUrl, { waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector(M('H-lock'), { state: 'attached', timeout: WAIT });
    const body = await text(B.page);
    expect(!/Doory/.test(body) && /This link was sent to another player/.test(body), 'the other phone saw: ' + body.slice(0, 120));
  } finally { await B.close(); }
  // a friend who played from a challenge link sees no door
  const chal = (await L.stored(page, 'wq_s_AB12CD')).result.challenge_code;
  await page.evaluate(() => localStorage.clear());
  await L.finishAsNew(page, ctx, chal, 'Guesty'); await toCard(page);
  expect(!(await page.$('#wq-hubdoor')), 'the friend\'s card has a hub door');
  return { hub: hubUrl.replace(/\/h\/[^?]+/, '/h/<token>'), otherPhone: 'locked', friend: 'no door' };
});

on('WQ179', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await page.setViewportSize({ width: 360, height: 740 });
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Doorb'); await toCard(page);
  const idx = await order(page, ['#wq-share', '#wq-hubdoor']);
  expect(idx[0] >= 0 && idx[1] > idx[0], 'the door is not right under Share: ' + idx.join(','));
  const door = await rect(page, '#wq-hubdoor'); const share = await rect(page, '#wq-share');
  expect(door.bottom <= 740 && share.bottom <= 740, 'the door needs scrolling: bottom at ' + door.bottom);
  const between = await page.evaluate(() => { const a = document.querySelector('#wq-share'), b = document.querySelector('#wq-hubdoor'); let n = 0; for (let e = a.nextElementSibling; e && e !== b; e = e.nextElementSibling) n++; return n; });
  expect(between === 0, between + ' element(s) sit between Share and the door');
  const stars = await page.$eval('.wq-scorecard .wq-stars', (e) => { const r = e.getBoundingClientRect(); const first = e.firstElementChild.getBoundingClientRect(); return r.height <= first.height * 1.5; });
  expect(stars, 'the stars wrap onto two rows');
  await page.click('#wq-hubdoor'); await page.waitForURL(/\/h\//, { timeout: WAIT });
  const hubUrl = page.url();
  const B = await L.newPhone(page);
  try {
    await B.page.goto(hubUrl, { waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector(M('H-lock'), { state: 'attached', timeout: WAIT });
    const body = await text(B.page);
    expect(/Finish your own quiz, then tap “My quizzes, videos and challenges”\./.test(body), 'the lock screen does not say how to get your own: ' + body.slice(0, 200));
    expect(/Send \/quiz on WhatsApp again for a new one\./.test(body), 'the lock screen does not say how to get a new link');
  } finally { await B.close(); }
  return { order: 'share, door', fits: true, note: 'the demo quiz has 5 questions; the 7-star row is checked as one row of stars' };
});

on('WQ182', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await page.setViewportSize({ width: 360, height: 740 });
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Doorc'); await toCard(page);
  const idx = await order(page, ['.wq-scorecard', 'p.wq-small.wq-center', '#wq-share', '#wq-hubdoor', '.wq-nth, .wq-banner']);
  expect(idx[0] < idx[1] && idx[1] < idx[2] && idx[2] < idx[3], 'first-screen order is ' + idx.join(','));
  expect(idx[4] === -1 || idx[4] > idx[3], 'a note comes before the door');
  expect((await inner(page, 'p.wq-small.wq-center')) === 'Only your first name goes on the card.', 'no name notice');
  const topic = await page.$eval('.wq-ctopic', (e) => e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) * 1.4);
  expect(topic, 'the topic wraps onto two lines');
  // with the door switched off the card is unchanged
  await L.setFlag(ctx, page, 'web_quiz_hub_door', 'false');
  await page.evaluate(() => localStorage.clear());
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Doord'); await toCard(page);
  expect(!(await page.$('#wq-hubdoor')), 'the door shows with the switch off');
  await L.setFlag(ctx, page, 'web_quiz_hub_door', 'true');
  return { order: 'card, notice, share, door, notes', note: 'the Urdu card and a video quiz card are not driven here' };
});

// ── the Jugnu card ────────────────────────────────────────────────────────────────────────────────────────────────
on('WQ226', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_card', 'true'); await L.setFlag(ctx, page, 'web_quiz_events_v2', 'true');
  const ev = L.events(page);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Jug1'); await toCard(page);
  const card = await inner(page, '.wq-jc').catch(() => '');
  if (!card) {
    const saved = await L.stored(page, 'wq_s_' + CODES.OPEN);
    const flags = await L.rows(ctx, "select key, value::text from app_settings where key in ('web_quiz_challenge_card', 'web_quiz_challenge', 'web_quiz_hub', 'web_quiz_events_v2')");
    expect(false, 'no Jugnu card on the scorecard (finish carried: ' + Object.keys((saved && saved.result) || {}).join(',') + '; settings: ' + flags.map((r) => r.join('=')).join(' ') + ')');
  }
  const idx = await order(page, ['.wq-scorecard', '.wq-jc', '#wq-share']);
  expect(idx[0] < idx[1] && idx[1] < idx[2], 'the Jugnu card is not first under the score: ' + idx.join(','));
  await ev.flush();
  const shown = ev.list.filter((e) => e.n === 'door_shown' && e.door === 'card');
  expect(shown.length === 1 && shown[0].surface === 'scorecard', 'door_shown {door: card} sent ' + shown.length + ' times: ' + JSON.stringify(shown));
  // grade 1 and a friend's run see no card
  await page.evaluate(() => localStorage.clear());
  await L.finishAsNew(page, ctx, CODES.G1, 'Jug2'); await toCard(page);
  expect(!(await page.$('.wq-jc')), 'a grade-1 child got the Jugnu card');
  const chal = (await L.stored(page, 'wq_s_GR1ABC')) && (await L.stored(page, 'wq_s_GR1ABC')).result.challenge_code;
  await L.setFlag(ctx, page, 'web_quiz_challenge_card', 'false'); await L.setFlag(ctx, page, 'web_quiz_events_v2', null);
  void chal;
  return { card: card.split('\n')[0], doorShown: shown.length };
});

on('WQ227', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_card', 'true');
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Zaraj'); await toCard(page);
  const calls = []; page.on('request', (r) => { if (/\/api\/wq\/hubdoor$/.test(r.url())) calls.push(JSON.parse(r.postData() || '{}')); });
  await page.click('#wq-jc-go');
  await page.waitForSelector(M('M10-jc'), { state: 'attached', timeout: WAIT });
  expect((await inner(page, M('M10-jc') + ' h2, ' + M('M10-jc') + ' h1')).includes("Zaraj's turn"), 'the screen does not say whose turn');
  expect((await inner(page, '#wq-jc-back')) === 'Not my turn? Go back', 'no "Not my turn? Go back"');
  await page.click('#wq-jc-back');
  await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  expect(calls.length === 0, 'Go back asked the server');
  await page.click('#wq-jc-go'); await page.waitForSelector('#wq-jc-play', { state: 'visible', timeout: WAIT });
  await page.click('#wq-jc-play');
  await page.waitForURL(/\/c\//, { timeout: WAIT });
  expect(calls.length === 1 && calls[0].jugnu === 1 && !calls[0].via, 'the server was asked ' + calls.length + ' times with ' + JSON.stringify(calls[0] || {}));
  expect(/via=quiz_card/.test(page.url()) && !/[?&]kid=$/.test(page.url()), 'opened ' + page.url());
  const cookie = (await page.context().cookies()).find((c) => c.name === 'wq_dv');
  expect(cookie && cookie.value.length === 22, 'the device cookie was not kept: ' + JSON.stringify(cookie || null));
  await page.waitForSelector('.wqc', { state: 'attached', timeout: WAIT });
  expect(!/other player|another player/.test(await text(page)), 'the child met the other-phone note');
  await L.setFlag(ctx, page, 'web_quiz_challenge_card', 'false');
  return { url: page.url().replace(/\/c\/[^?]+/, '/c/<token>').replace(/kid=[^&]+/, 'kid=<chip>') };
});

on('WQ228', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_card', 'false');
  let finishBody = null; page.on('response', async (r) => { if (/\/api\/wq\/finish$/.test(r.url())) { try { finishBody = await r.json(); } catch (_) { /* */ } } });
  const scripts = new Set(); page.on('request', (r) => { if (r.resourceType() === 'script') scripts.add(new URL(r.url()).pathname); });
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Nocard'); await toCard(page);
  expect(finishBody && !('jugnu_card' in finishBody), 'finish sent jugnu_card: ' + JSON.stringify(finishBody && finishBody.jugnu_card));
  expect(!(await page.$('.wq-jc')), 'the Jugnu card is drawn');
  expect(![...scripts].some((s) => /wq-card/.test(s)), 'the card script loaded: ' + [...scripts].join(', '));
  return { finishHasJugnu: false, scripts: [...scripts].map((s) => s.split('/').pop()) };
});

// ── the old link lands a finished child on their hub ──────────────────────────────────────────────────────────────
on('WQ229', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_link_home', 'true', (b) => b.link_home === true);
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Linky');
  const calls = []; page.on('request', (r) => { if (/\/api\/wq\/linkhome$/.test(r.url())) calls.push(1); });
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/h\/.*from=link/, { timeout: WAIT });
  expect(calls.length === 1, 'the page asked the server ' + calls.length + ' times');
  expect(/[?&]lang=en/.test(page.url()), 'the hub link carries no lang: ' + page.url());
  const hub = page.url();
  const B = await L.newPhone(page);
  try { await B.page.goto(hub, { waitUntil: 'domcontentloaded' }); await B.page.waitForSelector(M('H-lock'), { state: 'attached', timeout: WAIT }); expect(!/Linky/.test(await text(B.page)), 'the copy named the child'); } finally { await B.close(); }
  await sleep(1500);
  const log = L.botLog(ctx);
  expect(/"event":"web_quiz\.door_shown"[^\n]*"door":"link_home"/.test(log) || /door_shown[^\n]*link_home/.test(log), 'no door_shown link_home in the bot log');
  await L.setFlag(ctx, page, 'web_quiz_link_home', null, (b) => !b.link_home);
  return { hub: hub.replace(/\/h\/[^?]+/, '/h/<token>'), asked: calls.length };
});

on('WQ230', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_link_home', null, (b) => !b.link_home);
  const calls = []; page.on('request', (r) => { if (/\/api\/wq\/linkhome$/.test(r.url())) calls.push(1); });
  await L.finishAsNew(page, ctx, CODES.OPEN, 'Linkz');
  await openQuiz(page, ctx, CODES.OPEN);
  await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
  expect(calls.length === 0 && /\/q\//.test(page.url()), 'with the switch off the page asked or moved');
  // switch on, but two remembered children: no hub
  await L.setFlag(ctx, page, 'web_quiz_link_home', 'true', (b) => b.link_home === true);
  const kids = await L.stored(page, 'wq_kids');
  await page.evaluate((k) => localStorage.setItem('wq_kids', JSON.stringify([...k, { chip: 'feedfacefeedface', first: 'Other', animal: 'owl' }])), kids);
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wq-scorecard, #wq-play-as', { state: 'visible', timeout: WAIT });
  expect(calls.length === 0 && /\/q\//.test(page.url()), 'two remembered children still asked for the hub');
  await L.setFlag(ctx, page, 'web_quiz_link_home', null, (b) => !b.link_home);
  return { off: 'today\'s page', twoKids: 'today\'s page', note: 'the teacher\'s preview and a friend\'s code never carry link_home (server side, web-quiz-link-home.js field)' };
});

module.exports = { runs, modes };
