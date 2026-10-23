// web-quiz-child-page/teacher — the teacher's own link (?p=<preview token>): a page for the teacher, "Who played?",
// fixing a child who typed a name instead of a roll number; and the practice round a child plays after a finish.
// The preview token is minted with the bot's own token module from this run's bot tree (lib.tokens), as the bot
// does when it sends the teacher their link.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, count, boot, onScreen, screen, openQuiz, play, toResults, q } = L;
const M = (m) => onScreen(m);

const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

async function previewUrl(ctx, code) {
  const T = L.tokens(ctx);
  const sc = await L.codeRow(ctx, code), t = await L.teacherOf(ctx, code);
  const p = T.signPreview({ shareCodeId: sc, teacherUserId: t });
  expect(p, 'could not sign a preview token');
  return ctx.baseUrl + '/q/' + code + '?p=' + encodeURIComponent(p);
}
async function openTeacher(page, ctx, code) {
  // a phone that holds a finished child's session shows that child's card before anything else: the teacher's link is
  // opened on a clean phone
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(await previewUrl(ctx, code), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M3-teacher'), { state: 'attached', timeout: WAIT });
}
// A roster child (roll 12, Danish) plays the open quiz on `page` through to the results screen.
async function playAsRoll12(page, ctx, wrongAt) {
  await openQuiz(page, ctx, CODES.OPEN);
  const b = await boot(page);
  await page.click('#wq-play'); await page.waitForSelector(M('M4-roll'), { state: 'attached', timeout: WAIT });
  for (const d of '12') await page.click('.wq-pad .wq-key[data-k="' + d + '"]');
  await page.click('.wq-pad .wq-key-go');
  await page.waitForSelector(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]', { state: 'visible', timeout: WAIT });
  await page.click(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]');
  await play(page, b.quiz.questions, 5, wrongAt);
  return toResults(page);
}
// A child not on the class list plays (roll pad → "I don't know my number" → a typed name).
async function playOffList(page, ctx, name) {
  await openQuiz(page, ctx, CODES.OPEN);
  const b = await boot(page);
  await page.click('#wq-play'); await page.waitForSelector('#wq-noroll', { state: 'visible', timeout: WAIT });
  await page.click('#wq-noroll'); await page.fill('#wq-name', name); await page.click('#wq-start');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  await play(page, b.quiz.questions, 5, 1);
  return toResults(page);
}

on('WQ050', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  const w = L.watch(page);
  await openTeacher(page, ctx, CODES.OPEN);
  const header = await inner(page, '.wq-teach .wq-small');
  expect(/teacher/i.test(header), 'the header does not address the teacher: "' + header + '"');
  expect(!(await page.$('.wq-jug')), 'a mascot greets the teacher like a child');
  expect(!/Assalam o Alaikum|Let's play/.test(await text(page)), 'the child greeting is on the teacher\'s page');
  const main = await page.$eval('#wq-whoplayed', (e) => ({ text: e.innerText.trim(), go: e.classList.contains('wq-go') }));
  expect(main.text === 'Who played?' && main.go, '"Who played?" is not the main button: ' + JSON.stringify(main));
  expect((await inner(page, '#wq-preview')) === 'Try it as a child', 'no "Try it as a child"');
  L.healthy(w, 'teacher landing');
  return { header, main: main.text };
});

on('WQ051', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  // two class-list children finish (one of them misses question 2), one off-list child too
  await playAsRoll12(page, ctx, 1);
  const B = await L.newPhone(page);
  try {
    await openQuiz(B.page, ctx, CODES.OPEN);
    const b = await boot(B.page);
    await B.page.click('#wq-play'); await B.page.waitForSelector(M('M4-roll'), { state: 'attached', timeout: WAIT });
    await B.page.click('.wq-pad .wq-key[data-k="9"]'); await B.page.click('.wq-pad .wq-key-go');          // roll 9: Hina
    await B.page.waitForSelector(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]', { state: 'visible', timeout: WAIT });
    await B.page.click(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]');
    await play(B.page, b.quiz.questions, 5, 1); await toResults(B.page);
    await B.page.evaluate(() => localStorage.clear());
    await playOffList(B.page, ctx, 'Danny');
  } finally { await B.close(); }
  await openTeacher(page, ctx, CODES.OPEN);
  await page.click('#wq-whoplayed');
  await page.waitForSelector(M('M4-who-played'), { state: 'attached', timeout: WAIT });
  const body = await text(page);
  const listSize = Number(await L.one(ctx, "select count(*) from students s join class_enrollments e on e.student_id = s.id where e.class_id = (select class_id from quiz_share_codes where code = " + q(CODES.OPEN) + ') and e.is_active'));
  // scenarios share the run database: the counts are whatever has finished on this code so far
  // the server's count (web-quiz.service whoPlayed): ONE attempt per child, class-list and off-list children alike
  const played = Number(await L.one(ctx, "select count(distinct student_id) from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") and status = 'completed' and invited_by_student_id is null and student_id is not null and user_id is null"));
  const onList = Number(await L.one(ctx, "select count(distinct q.student_id) from quiz_sessions q join class_enrollments e on e.student_id = q.student_id where q.share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") and q.status = 'completed' and e.is_active"));
  const top = await inner(page, '.wq-who-sum h2');
  expect(top === played + ' of ' + listSize + ' played', 'the top line reads "' + top + '" (' + played + ' children finished, list of ' + listSize + ')');
  const note = played > listSize ? 'the header counts every child who played (off-list ones too) over the list size, so it reads ' + top + ' here — a product question, not a lane one' : null;
  expect(/Average\s+\d/.test(body), 'no average line');
  expect(/Q2 was the hardest \(\d+ missed it\)/.test(body), 'no hardest-question line (question 2 was missed twice)');
  expect(new RegExp('Not played yet \\(' + (listSize - onList) + '\\)').test(body), 'the not-played list is not ' + (listSize - onList) + ' children: ' + (body.match(/Not played yet \(\d+\)/) || [''])[0]);
  const np = await page.$$eval('.wq-who-np', (els) => els.map((e) => e.innerText.trim()));
  expect(np.length === listSize - onList && np.every((t) => /Roll \d+/.test(t)) && !np.some((t) => /Testwala|Naveed|Khalid/.test(t)), 'not-played rows: ' + np.slice(0, 3).join(' | '));
  const rowsShown = await page.$$eval('.wq-who:not(.wq-who-not) .wq-who-row', (els) => els.map((e) => e.innerText.trim()));
  expect(rowsShown.some((r) => /^Danish\s+Roll 12\s+\d\/5$/.test(r.replace(/\n/g, ' ').replace(/\s+/g, ' '))), 'no compact row for Danish: ' + rowsShown.join(' | '));
  expect(rowsShown.some((r) => /Danny/.test(r) && /Not on your class list/.test(r)), 'the off-list child is not marked: ' + rowsShown.join(' | '));
  return { top, rows: rowsShown.length, ...(note ? { note } : {}) };
});

on('WQ049', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await playOffList(page, ctx, 'Qudrat');          // a name no class-list child is near, so no "Are you …?"
  await openTeacher(page, ctx, CODES.OPEN);
  await page.click('#wq-whoplayed');
  await page.waitForSelector(M('M4-who-played'), { state: 'attached', timeout: WAIT });
  const rows = await page.$$eval('.wq-who:not(.wq-who-not) .wq-who-row', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), off: Boolean(e.querySelector('.wq-tag-off')), fix: e.querySelector('.wq-who-fix') ? e.querySelector('.wq-who-fix').innerText.trim() : null })));
  expect(rows.length && rows[0].off, 'children not on the class list do not come first: ' + JSON.stringify(rows[0]));
  const danesh = rows.find((r) => /Qudrat/.test(r.text));
  expect(danesh && danesh.fix === 'Set roll', 'no small "Set roll" link on the off-list row: ' + JSON.stringify(danesh));
  await page.click('.wq-who-row:has-text("Qudrat") .wq-who-fix');
  await page.waitForSelector(M('M4-who-fix'), { state: 'attached', timeout: WAIT });
  for (const d of '12') await page.click('.wq-pad .wq-key[data-k="' + d + '"]');
  await page.click('.wq-pad .wq-key-go');
  await page.waitForFunction(() => /Is this Danish\?/.test(document.body.innerText), null, { timeout: WAIT });
  await page.click('.wq-btn.wq-go[data-chip]');
  await page.waitForSelector(M('M4-who-played'), { state: 'attached', timeout: WAIT });
  await page.waitForFunction(() => /Danish/.test(document.body.innerText), null, { timeout: WAIT });
  const after = await page.$$eval('.wq-who:not(.wq-who-not) .wq-who-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  expect(after.some((r) => /^Danish\s+Roll 12/.test(r)), 'the list did not reload with Danish at Roll 12: ' + after.join(' | '));
  expect(!after.some((r) => /Qudrat/.test(r)), 'the typed name still has its own row');
  return { fixed: 'Danish · Roll 12' };
});

on('WQ052', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  const first = await playAsRoll12(page, ctx, -1);        // 5/5 on phone A
  const B = await L.newPhone(page);
  try {
    const second = await playAsRoll12(B.page, ctx, 0);    // 4/5 on phone B: practice
    await B.page.click('#wq-card');
    await B.page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
    const banner = await B.page.$eval('.wq-banner', (e) => e.innerText).catch(() => '');
    expect(banner === 'Practice round · your first score 5/5 is the one that counts', 'the card says "' + banner + '"');
    const ev = L.events(B.page);
    // the share text carries the kept first score: read what Share would send (no navigator.share → the fallback screen)
    await B.page.evaluate(() => { try { delete navigator.share; } catch (_) { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } });
    await B.page.click('#wq-share');
    await B.page.waitForSelector(M('M12-fallback'), { state: 'attached', timeout: WAIT });
    const msg = await inner(B.page, M('M12-fallback') + ' .wq-card');
    expect(/5\/5|5 out of 5|5 stars/.test(msg) && !/4\/5|4 out of 5/.test(msg), 'the shared message does not carry the first score: "' + msg + '"');
    return { first, second, banner, shared: msg.split('\n')[0] };
  } finally { await B.close(); }
});

on('WQ012', 'off', async () => ({ blocked: 'the teacher\'s class report is a scheduled worker job (quizzes.report_scheduled_at → quiz_report → a PDF sent on WhatsApp); the first-finish rule it reads (video-quiz-report loadClassRows) is proved through the league table and "Who played" in WQ047 and WQ052 on this lane' }));

module.exports = { runs, modes };
