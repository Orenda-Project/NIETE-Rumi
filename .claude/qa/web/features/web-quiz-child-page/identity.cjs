// web-quiz-child-page/identity — who is playing. Three paths, chosen by app_settings on the run database:
//   today's path (no switch): Play → Whose turn → I'm new → a first name; remembered children as chips
//   the roll pad (web_quiz_roster_id): Play → What is your roll number? → Are you <first>? ; a name only as a fallback
//   name first / identity v2 (web_quiz_identity = v2): Play → What is your name? → one card, tiebreakers, Someone else
// The demo seed gives the science teacher class 4-A (AB12CD is its hand-out), a second grade-4 class 4-B (so the
// unbound SM34EF cannot tell), 3-B and 5-B, and the children the spec names (roll 12 Danish, two Alis, two Zains who
// differ only by father, Tooba, Yusra, Omar, Hina). Every scenario types a name of its own: the database is shared.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, count, boot, onScreen, screen, healthy, openQuiz, startAsNew, play, toResults, sleep, q } = L;

const M = (m) => onScreen(m);
async function tapPlay(page) { await page.click('#wq-play'); }
async function waitScreen(page, m) { await page.waitForSelector(M(m), { state: 'attached', timeout: WAIT }); }
async function padType(page, digits) { for (const d of String(digits)) await page.click('.wq-pad .wq-key[data-k="' + d + '"]'); }
async function padGo(page) { await page.click('.wq-pad .wq-key-go'); }
// Legacy "Are you X?" (one candidate at a time): the heading and the one green Yes
async function isYou(page) {
  await waitScreen(page, 'M4-isyou');
  return { h2: await inner(page, M('M4-isyou') + ' h2'), greens: await count(page, M('M4-isyou') + ' .wq-btn.wq-go'), body: await text(page) };
}
const sessionsOf = (ctx, code) => L.rows(ctx, "select coalesce(s.student_name, ''), q.status, coalesce(q.student_id::text,''), q.id from quiz_sessions q left join students s on s.id = q.student_id where q.share_code_id = (select id from quiz_share_codes where code = " + q(code) + ') order by q.created_at desc');

const modes = {};
const runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

// ── today's path ──────────────────────────────────────────────────────────────────────────────────────────────────
on('WQ011', 'off', async (page, ctx) => {
  // A child remembered on this phone is listed once: finish the first quiz, open the next, "Not <first>?" → Whose turn
  await L.setMode(ctx, page, 'off');
  await L.finishFast(page, ctx, CODES.OPEN, 'Nadia');
  await openQuiz(page, ctx, CODES.NEXT);
  expect((await inner(page, '#wq-play-as')) === 'Play as Nadia', 'the next quiz does not offer Play as Nadia');
  await page.click('#wq-notme');
  await page.waitForSelector('#wq-new', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '#wq h2')) === 'Whose turn is it?', 'no "Whose turn is it?" heading');
  const nadias = await page.$$eval('.wq-kid', (els) => els.map((e) => e.innerText.trim()).filter((t) => /Nadia/.test(t)).length);
  expect(nadias === 1, 'Nadia is listed ' + nadias + ' times');
  return { listed: nadias };
});

on('WQ058', 'roster', async (page, ctx) => {
  // T247: a remembered child the class list does not know → asked again, never an error screen
  await L.setMode(ctx, page, 'roster');
  await L.remember(page, ctx, [{ chip: 'deadbeefdeadbeef', first: 'Ghost', animal: 'owl' }]);
  const w = await openQuiz(page, ctx, CODES.OPEN);
  expect((await inner(page, '#wq-play-as')) === 'Play as Ghost', 'the landing does not offer the remembered child');
  await page.click('#wq-play-as');
  await waitScreen(page, 'M4-roll');
  expect(!/something went wrong|error/i.test(await text(page)), 'an error is shown');
  const kids = await L.stored(page, 'wq_kids');
  expect(Array.isArray(kids) && !kids.some((k) => k.chip === 'deadbeefdeadbeef'), 'the unknown chip was not forgotten');
  healthy(w, 'remembered-unknown');
  return { asked: 'roll pad', forgotten: true };
});

// ── the roll pad (legacy roster) ──────────────────────────────────────────────────────────────────────────────────
on('WQ005', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await openQuiz(page, ctx, CODES.OPEN);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  await page.click('#wq-noroll');
  await page.fill('#wq-name', 'Hina'); await page.click('#wq-start');
  const y = await isYou(page);
  expect(y.h2.startsWith('Are you Hina?'), 'the page asks "' + y.h2 + '"');
  expect(await screen(page) === 'M4-isyou', 'the quiz started before asking');
  return { asked: y.h2 };
});

on('WQ027', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  const w = await openQuiz(page, ctx, CODES.OPEN);
  const b = await boot(page);
  expect(b.cls && b.cls.roster, 'boot carries no roster');
  expect(Array.isArray(b.cls.chips) && b.cls.chips.length === 0, 'the page carries ' + b.cls.chips.length + ' classmates\' names');
  expect(!JSON.stringify(b).includes('Danish'), 'a classmate\'s name is in the boot data');
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  expect((await inner(page, M('M4-roll') + ' h2')) === 'What is your roll number?', 'no roll-number question');
  expect(await count(page, '.wq-pad .wq-key') === 12, 'the pad has not 12 keys');
  healthy(w, 'roll pad');
  return { keys: 12 };
});

on('WQ028', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await openQuiz(page, ctx, CODES.OPEN);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  await padType(page, '12'); await padGo(page);
  const y = await isYou(page);
  expect(y.h2.startsWith('Are you Danish?'), 'the page asks "' + y.h2 + '"');
  expect(/wq-ani/.test(await page.$eval(M('M4-isyou') + ' h2', (e) => e.innerHTML)), 'no animal on the card');
  expect(!y.body.includes('Testwala') && !y.body.includes('Khalid'), 'the card shows more than the first name');
  await page.click(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const [row] = await sessionsOf(ctx, CODES.OPEN);
  expect(row && row[0] === 'Danish Testwala', 'the session is for "' + (row && row[0]) + '", not the class-list child');
  return { card: y.h2, session: row[0] };
});

on('WQ029', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await openQuiz(page, ctx, CODES.OPEN);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  await padType(page, '99'); await padGo(page);
  await page.waitForFunction(() => /No one in this class has number 99/.test(document.body.innerText), null, { timeout: WAIT });
  expect(await screen(page) === 'M4-roll', 'the pad did not stay');
  await padType(page, '12'); await padGo(page);
  const y = await isYou(page);
  expect(y.h2.startsWith('Are you Danish?'), 'unexpected card ' + y.h2);
  expect((await inner(page, '#wq-diff')) === 'No, try again', 'the no button reads "' + (await inner(page, '#wq-diff')) + '"');
  await page.click('#wq-diff');
  await waitScreen(page, 'M4-roll');
  expect(await page.$('.wq-roll .wq-roll-ph'), 'the pad is not empty again');
  expect(await screen(page) !== 'M6', 'a quiz started as someone else');
  return { unknown: 99, emptied: true };
});

on('WQ030', 'roster', async (page, ctx) => {
  // grade-3 quiz: only 3-B is searched; roll 41 and the name Zoya exist only in 5-B
  await L.setMode(ctx, page, 'roster', CODES.G3);
  await openQuiz(page, ctx, CODES.G3);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  await padType(page, '41'); await padGo(page);
  await page.waitForFunction(() => /No one in this class has number 41\. Try again!/.test(document.body.innerText), null, { timeout: WAIT });
  await page.click('#wq-noroll');
  await page.fill('#wq-name', 'Zoya'); await page.click('#wq-start');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const [row] = await sessionsOf(ctx, CODES.G3);
  expect(row && row[0] === 'Zoya' && row[2] !== (await L.studentNamed(ctx, 'Zoya Testwala')), 'the typed name was matched to 5-B\'s Zoya');
  return { roll41: 'unknown', zoya: 'new child' };
});

on('WQ031', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster', CODES.G2);
  await openQuiz(page, ctx, CODES.G2);
  await tapPlay(page); await waitScreen(page, 'M4-class');
  expect((await inner(page, M('M4-class') + ' h2')) === 'Which class are you in?', 'no class question');
  const labels = await page.$$eval('[data-cls]', (els) => els.map((e) => e.innerText.trim()));
  // legacy list labels come from student_lists (class_name + section): "Grade 3 B", "Grade 5 B"
  expect(labels.some((l) => /3[\s-]B$/.test(l)) && labels.some((l) => /5[\s-]B$/.test(l)), 'classes offered: ' + labels.join(', '));
  expect((await inner(page, '#wq-notmine')) === 'My class is not here', 'no "My class is not here"');
  await page.click('[data-cls]:has-text("5 B"), [data-cls]:has-text("5-B")');
  await waitScreen(page, 'M4-roll');
  await padType(page, '1'); await padGo(page);          // roll 1 exists in 4-A only
  await page.waitForFunction(() => /No one in this class has number 1\./.test(document.body.innerText), null, { timeout: WAIT });
  await padType(page, '41'); await padGo(page);         // Zoya, 5-B
  const y = await isYou(page);
  expect(y.h2.startsWith('Are you Zoya?'), 'searching 5-B found "' + y.h2 + '"');
  return { offered: labels };
});

on('WQ032', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await openQuiz(page, ctx, CODES.OPEN);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  await page.click('#wq-noroll');
  await page.fill('#wq-name', 'Zain'); await page.click('#wq-start');
  let y = await isYou(page);
  expect(y.greens === 1, y.greens + ' green Yes buttons on the first card');
  await page.click('#wq-diff');
  y = await isYou(page);
  expect(y.greens === 1, y.greens + ' green Yes buttons on the second card');
  return { greens: 1 };
});

on('WQ033', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await openQuiz(page, ctx, CODES.OPEN);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  await page.click('#wq-noroll');
  await page.fill('#wq-name', 'Zain'); await page.click('#wq-start');
  const first = await isYou(page);
  expect(first.h2.startsWith('Are you Zain?'), first.h2);
  await page.click('#wq-diff');
  const second = await isYou(page);
  expect(second.h2.startsWith('Are you Zain?'), second.h2);
  expect((await inner(page, '#wq-diff')) === "No, I'm someone else", 'last card\'s no reads "' + (await inner(page, '#wq-diff')) + '"');
  await page.click('#wq-diff');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const [row] = await sessionsOf(ctx, CODES.OPEN);
  expect(row[0] === 'Zain' && !(await L.rows(ctx, "select id from students where student_name = 'Zain Testwala'")).some((r) => r[0] === row[2]), 'the quiz started as one of the two class-list Zains');
  return { cards: 2, then: 'a new child' };
});

on('WQ034', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await openQuiz(page, ctx, CODES.OPEN);
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  expect((await inner(page, '#wq-noroll')) === "I don't know my number", 'no "I don\'t know my number"');
  await page.click('#wq-noroll');
  await page.fill('#wq-name', 'Danesh'); await page.click('#wq-start');
  const y = await isYou(page);
  expect(y.h2.startsWith('Are you Danish?'), 'the near name found "' + y.h2 + '"');
  return { typed: 'Danesh', found: 'Danish' };
});

on('WQ047', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  // phone A: Danish (roll 12) plays to the end
  const b = (await openQuiz(page, ctx, CODES.OPEN), await boot(page));
  await tapPlay(page); await waitScreen(page, 'M4-roll'); await padType(page, '12'); await padGo(page); await isYou(page);
  await page.click(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]');
  await play(page, b.quiz.questions, 5, -1);
  const first = await toResults(page);
  // phone B: the same roll number, the same child
  const B = await L.newPhone(page);
  try {
    await openQuiz(B.page, ctx, CODES.OPEN);
    await tapPlay(B.page); await waitScreen(B.page, 'M4-roll'); await padType(B.page, '12'); await padGo(B.page); await isYou(B.page);
    await B.page.click(M('M4-isyou') + ' .wq-btn.wq-go[data-chip]');
    await play(B.page, b.quiz.questions, 5, 0);
    const second = await toResults(B.page);
    const banner = await B.page.$eval(M('M9') + ' .wq-banner', (e) => e.innerText).catch(() => '');
    expect(/practice/i.test(banner), 'the second finish is not marked as practice: "' + banner + '"');
  } finally { await B.close(); }
  const done = await L.rows(ctx, "select q.correct_answers from quiz_sessions q join students s on s.id = q.student_id where s.student_name = 'Danish Testwala' and q.share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") and q.status = 'completed' order by q.completed_at");
  expect(done.length === 2 && done[0][0] === '5', 'completed sessions for Danish: ' + JSON.stringify(done));
  return { first, kept: 'the first finish (5/5)' };
});

on('WQ048', 'roster', async (page, ctx) => {
  // The page renders Western digits on every pad (wq.js digitsFor is the identity), and the newer @T726 / @T727 rows say
  // Western digits are what an Urdu page shows: this scenario is proposed @obsolete in the spec; it is not driven.
  return { blocked: 'spec/code disagreement: wq.js digitsFor() renders Western digits and @T726/@T727 require Western digits in Urdu; @WQ048 is marked @obsolete in the spec as a deletion proposal' };
  // eslint-disable-next-line no-unreachable
  await L.setMode(ctx, page, 'roster', CODES.UR);
  await openQuiz(page, ctx, CODES.UR);
  expect((await page.$eval('html', (e) => e.lang)) === 'ur', 'not an Urdu page');
  await tapPlay(page); await waitScreen(page, 'M4-roll');
  const keys = await page.$$eval('.wq-pad .wq-key[data-k]', (els) => els.filter((e) => /^[0-9]$/.test(e.getAttribute('data-k'))).map((e) => e.innerText.trim()));
  const urduDigits = keys.filter((k) => /^[۰-۹]$/.test(k)).length;
  expect(urduDigits === keys.length, 'the keys read ' + keys.join(' ') + ' — ' + urduDigits + ' of ' + keys.length + ' in Urdu digits');
  await padType(page, '99'); await padGo(page);
  await page.waitForFunction(() => /نمبر/.test(document.body.innerText), null, { timeout: WAIT });
  const line = await inner(page, M('M4-roll') + ' .wq-say, ' + M('M4-roll') + ' .wq-jug');
  expect(/[۰-۹]/.test(line), 'the "no one has number" line uses no Urdu digits: "' + line + '"');
  return { keys };
});

// ── name first (identity v2) ─────────────────────────────────────────────────────────────────────────────────────
const v2Play = async (page) => { await tapPlay(page); await page.waitForSelector(M('M4-name') + ', ' + M('M4-class'), { state: 'attached', timeout: WAIT }); };
const typeName = async (page, name) => { await page.fill('#wq-name', name); await page.click('#wq-start'); };
const v2Card = async (page) => { await waitScreen(page, 'M4-isyou'); return { h2: await inner(page, M('M4-isyou') + ' h2'), greens: await count(page, M('M4-isyou') + ' .wq-btn.wq-go'), body: await text(page) }; };

on('WQ035', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  const w = await openQuiz(page, ctx, CODES.OPEN);
  await v2Play(page);
  expect(await screen(page) === 'M4-name', 'Play went to ' + (await screen(page)) + ', not the name screen');
  expect((await inner(page, '#wq h2')) === 'What is your name?', 'no "What is your name?"');
  expect(!(await page.$('.wq-pad')), 'a number pad is shown');
  await typeName(page, 'Hina');
  const c = await v2Card(page);
  expect(c.h2.startsWith('Are you Hina?') && c.greens === 1, 'card "' + c.h2 + '" with ' + c.greens + ' green buttons');
  expect(!c.body.includes('Testwala') && !c.body.includes('Imran') && !/\b9\b/.test(c.body.replace(/Are you Hina\?/, '')), 'the card shows more than the first name');
  await page.click('#wq-yes');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const [row] = await sessionsOf(ctx, CODES.OPEN);
  expect(row[0] === 'Hina Testwala', 'the session is for "' + row[0] + '"');
  healthy(w, 'v2 name first');
  return { card: c.h2 };
});

on('WQ036', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  await openQuiz(page, ctx, CODES.OPEN); await v2Play(page);
  await typeName(page, 'Ali');
  await waitScreen(page, 'M4-ask');
  const h = await inner(page, M('M4-ask') + ' h2');
  expect(h === 'There is more than one Ali in 4-A. What is your full name?', 'the page asks "' + h + '"');
  expect((await page.$eval('#wq-more', (e) => e.value)) === 'Ali', 'the typed name is not carried over');
  const body = await text(page);
  for (const leak of ['Naveed', 'Raza', 'Testwala', 'Shahid']) expect(!body.includes(leak), 'a classmate\'s name part is on screen: ' + leak);
  await page.fill('#wq-more', 'Ali Raza Testwala'); await page.click('#wq-more-go');
  const c = await v2Card(page);
  expect(c.h2.startsWith('Are you Ali?') && c.greens === 1, 'card "' + c.h2 + '" with ' + c.greens + ' green buttons');
  return { asked: h };
});

on('WQ037', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  await openQuiz(page, ctx, CODES.OPEN); await v2Play(page);
  await typeName(page, 'Zain');                       // two "Zain Testwala"s: full name cannot split them
  await waitScreen(page, 'M4-ask');
  expect((await inner(page, M('M4-ask') + ' h2')) === "What is your father's name?", 'the first tiebreaker is not the father\'s name: "' + (await inner(page, M('M4-ask') + ' h2')) + '"');
  await page.click('#wq-dontknow');
  await waitScreen(page, 'M4-ask-number');
  await page.click('#wq-noroll');
  await waitScreen(page, 'M4-notfound');
  const body = await text(page);
  expect(body.includes('There are 2 children called Zain in 4-A.'), 'the shared-name line is missing');
  expect(body.includes('Tap Yes to play. Your teacher will check which one you are.'), 'the "teacher will check" line is missing');
  expect(!body.includes("I can't find"), 'the page says it cannot find a name the class list has');
  const before = await L.one(ctx, "select count(*) from students where student_name like 'Zain%'");
  await page.click('#wq-force');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const after = await L.one(ctx, "select count(*) from students where student_name like 'Zain%'");
  expect(Number(after) === Number(before) + 1, 'no new child was created (' + before + ' → ' + after + ')');
  return { created: 'a new Zain the teacher can place later' };
});

on('WQ038', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  const tooba = await L.chipFor(ctx, CODES.OPEN, 'Tooba Testwala'), yusra = await L.chipFor(ctx, CODES.OPEN, 'Yusra Testwala');
  await L.remember(page, ctx, [tooba, yusra].map(({ chip, first, animal }) => ({ chip, first, animal })));
  await openQuiz(page, ctx, CODES.OPEN);
  const b = await boot(page);
  await page.click('.wq-kid-big:has-text("Tooba")');
  await play(page, b.quiz.questions, 2, -1);
  const toobaSession = (await sessionsOf(ctx, CODES.OPEN)).find((r) => r[0] === 'Tooba Testwala');
  expect(toobaSession, 'no session for Tooba');
  // "Not Tooba?" floats over the first questions after a card tap
  await page.waitForSelector('.wq-undo', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '.wq-undo')) === 'Not Tooba?', 'the undo reads "' + (await inner(page, '.wq-undo')) + '"');
  await page.click('.wq-undo');
  await page.waitForSelector(M('M4-name') + ', ' + M('M4-class'), { state: 'attached', timeout: WAIT });
  if (await screen(page) === 'M4-class') await page.click('#wq-cls-0');
  await typeName(page, 'Yusra');
  const c = await v2Card(page); expect(c.h2.startsWith('Are you Yusra?'), c.h2);
  await page.click('#wq-yes');
  await page.waitForSelector(M('M6') + ' .wq-qof', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '.wq-qof')) === 'Question 1 of 5', 'Yusra did not start at question 1: ' + (await inner(page, '.wq-qof')));
  await play(page, b.quiz.questions, 1, -1);
  const toobaAnswers = await L.one(ctx, 'select count(*) from quiz_answers where session_id = ' + q(toobaSession[3]));
  expect(toobaAnswers === '2', 'Tooba\'s session now has ' + toobaAnswers + ' answers');
  // Tooba taps her own card again: her quiz continues from question 3
  await openQuiz(page, ctx, CODES.OPEN);
  await page.waitForSelector('.wq-kid-big:has-text("Tooba"), #wq-cont', { state: 'visible', timeout: WAIT });
  if (await page.$('.wq-kid-big:has-text("Tooba")')) await page.click('.wq-kid-big:has-text("Tooba")'); else await page.click('#wq-cont');
  await page.waitForSelector(M('M6') + ' .wq-qof', { state: 'visible', timeout: WAIT });
  const qof = await inner(page, '.wq-qof');
  const state = await sessionsOf(ctx, CODES.OPEN);
  const diag = await Promise.all(state.filter((r) => /Tooba|Yusra/.test(r[0])).map(async (r) => r[0].split(' ')[0] + ':' + r[1] + ':' + (await L.one(ctx, 'select count(*) from quiz_answers where session_id = ' + q(r[3]))) + ' answers'));
  expect(qof === 'Question 3 of 5', 'Tooba continues at "' + qof + '" (sessions: ' + diag.join(', ') + ')');
  return { tooba: 'kept 2 answers, continues at 3', yusra: 'own quiz from 1' };
});

on('WQ039', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  // this phone has played as Hina (so the device may name her), then a hub link with her chip plays straight through
  await openQuiz(page, ctx, CODES.OPEN); await v2Play(page); await typeName(page, 'Hina'); await v2Card(page); await page.click('#wq-yes');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const hina = await L.chipFor(ctx, CODES.OPEN, 'Hina Testwala');
  await page.evaluate(() => localStorage.removeItem('wq_s_' + 'AB12CD'));
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '?k=' + hina.chip, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const [row] = await sessionsOf(ctx, CODES.OPEN);
  expect(row[0] === 'Hina Testwala', 'the hub link started as "' + row[0] + '"');
  // an unknown chip: forgotten, and the page asks the name
  await page.evaluate(() => localStorage.removeItem('wq_s_' + 'AB12CD'));
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '?k=0123456789abcdef', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M4-name') + ', ' + M('M4-who-v2') + ', #wq-play', { state: 'attached', timeout: WAIT });
  if (await page.$('#wq-play')) { await v2Play(page); }
  expect(await screen(page) === 'M4-name' || await screen(page) === 'M4-class', 'an unknown chip landed on ' + (await screen(page)));
  return { straight: true, unknown: 'asked' };
});

on('WQ040', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  await openQuiz(page, ctx, CODES.OPEN); await v2Play(page); await typeName(page, 'Omar'); await v2Card(page); await page.click('#wq-yes');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const omar = await L.chipFor(ctx, CODES.OPEN, 'Omar Testwala');
  await page.evaluate(() => localStorage.removeItem('wq_s_AB12CD'));
  // record every screen marker between navigation and question 1
  await page.addInitScript(() => { window.__seen = []; new MutationObserver(() => { const el = document.getElementById('wq'); const m = el && el.getAttribute('data-m'); if (m && window.__seen[window.__seen.length - 1] !== m) window.__seen.push(m); }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['data-m'] }); });
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '?k=' + omar.chip, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const seen = await page.evaluate(() => window.__seen);
  expect(seen.includes('M4-opening'), 'no "Opening your quiz…" screen: ' + seen.join(' → '));
  expect(!seen.some((m) => /^M4-(who|name|class)/.test(m)), '"Who is playing?" appeared before question 1: ' + seen.join(' → '));
  // when the session cannot start, the page waits for a tap
  await page.evaluate(() => localStorage.removeItem('wq_s_AB12CD'));
  await page.goto(ctx.baseUrl + '/q/' + CODES.OPEN + '?k=0123456789abcdef', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(M('M4-who-v2') + ', #wq-play, ' + M('M4-name'), { state: 'attached', timeout: WAIT });
  expect(await screen(page) !== 'M6', 'a quiz started for an unknown chip');
  return { screens: seen };
});

on('WQ041', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  const before = Number(await L.one(ctx, "select count(*) from students where student_name = 'Usman Testwala'"));
  const run = async (p) => {
    await openQuiz(p, ctx, CODES.OPEN);
    if (await p.$('#wq-someone')) { await p.click('#wq-someone'); await p.waitForSelector(M('M4-name') + ', ' + M('M4-class'), { state: 'attached', timeout: WAIT }); if (await screen(p) === 'M4-class') await p.click('#wq-cls-0'); } else await v2Play(p);
    await typeName(p, 'Usman Testwala');
    await waitScreen(p, 'M4-notfound'); await p.click('#wq-force');
    const b = await boot(p); await play(p, b.quiz.questions, 5, -1); return toResults(p);
  };
  await run(page);
  await page.evaluate(() => localStorage.removeItem('wq_s_AB12CD'));
  await run(page);
  const banner = await page.$eval(M('M9') + ' .wq-banner', (e) => e.innerText).catch(() => '');
  expect(/practice/i.test(banner), 'the replay is not practice: "' + banner + '"');
  const same = Number(await L.one(ctx, "select count(*) from students where student_name = 'Usman Testwala'"));
  expect(same === before + 1, 'the same phone made ' + (same - before) + ' children named Usman Testwala');
  const B = await L.newPhone(page);
  try { await run(B.page); } finally { await B.close(); }
  const other = Number(await L.one(ctx, "select count(*) from students where student_name = 'Usman Testwala'"));
  expect(other === before + 2, 'a different phone did not make a different child (' + other + ')');
  return { samePhone: 'one child, practice', otherPhone: 'another child' };
});

on('WQ042', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  // a class child finishes, then a friend opens the challenge code the finish minted
  await openQuiz(page, ctx, CODES.OPEN); await v2Play(page); await typeName(page, 'Hina'); await v2Card(page); await page.click('#wq-yes');
  const b = await boot(page); await play(page, b.quiz.questions, 5, -1); await toResults(page);
  const result = (await L.stored(page, 'wq_s_AB12CD')) || {};
  const chal = result.result && result.result.challenge_code;
  expect(chal, 'the finish minted no challenge code');
  const F = await L.newPhone(page);
  try {
    await openQuiz(F.page, ctx, chal);
    await F.page.click('#wq-play');
    await waitScreen(F.page, 'M4-name');
    expect(!(await F.page.$('.wq-pad')) && !(await F.page.$('[data-cls], #wq-cls-0')), 'the friend sees a pad or class names');
    expect(!(await text(F.page)).includes('4-A'), 'the friend sees the class');
    await typeName(F.page, 'Faris');
    await F.page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  } finally { await F.close(); }
  // the friend's session is stored under the class code (resolveCode: shareCodeId = the parent's) with the inviter set
  const [row] = await L.rows(ctx, "select coalesce(invited_by_student_id::text, ''), source from quiz_sessions where share_code_id = (select id from quiz_share_codes where code = " + q(CODES.OPEN) + ") and student_id = (select id from students where student_name = 'Faris' order by created_at desc limit 1) order by created_at desc limit 1");
  expect(row && row[0], 'the friend\'s session carries no inviter: ' + JSON.stringify(row));
  return { challenge: chal, friend: 'name only, invited' };
});

on('WQ043', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  await openQuiz(page, ctx, CODES.NEXT); await v2Play(page);
  expect(await screen(page) === 'M4-class', 'the unbound hand-out went to ' + (await screen(page)));
  expect((await inner(page, '#wq h2')) === 'Which class are you in?', 'no class question');
  const labels = await page.$$eval('.wq-cls', (els) => els.map((e) => e.innerText.trim()));
  expect(labels.includes('4-A') && labels.includes('4-B'), 'classes offered: ' + labels.join(', '));
  expect((await inner(page, '#wq-notmine')) === 'My class is not here', 'no "My class is not here"');
  await page.click('.wq-cls:has-text("4-B")');
  await waitScreen(page, 'M4-name');
  await typeName(page, 'Sara');
  const c = await v2Card(page);
  expect(c.h2.startsWith('Are you Sara?'), c.h2);
  expect((await inner(page, M('M4-isyou') + ' .wq-sub')) === '4-B', 'the card does not show 4-B');
  // the bound hand-out goes straight to the name
  await openQuiz(page, ctx, CODES.OPEN); await v2Play(page);
  expect(await screen(page) === 'M4-name', 'the bound hand-out went to ' + (await screen(page)));
  return { offered: labels };
});

on('WQ044', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  const kids = await Promise.all(['Hina Testwala', 'Omar Testwala'].map((n) => L.chipFor(ctx, CODES.OPEN, n)));
  await L.remember(page, ctx, kids.map(({ chip, first, animal }) => ({ chip, first, animal })));
  await openQuiz(page, ctx, CODES.OPEN);
  const cards = await page.$$eval('.wq-kid-big', (els) => els.map((e) => ({ text: e.innerText.trim(), animal: Boolean(e.querySelector('.wq-ani')) })));
  expect(cards.length === 2 && cards.every((c) => c.animal), 'cards: ' + JSON.stringify(cards));
  expect((await inner(page, '#wq-someone')) === 'Someone else', 'no "Someone else" button');
  await page.click('.wq-kid-big:has-text("Omar")');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const [row] = await sessionsOf(ctx, CODES.OPEN);
  expect(row[0] === 'Omar Testwala', 'started as "' + row[0] + '"');
  return { cards: cards.map((c) => c.text) };
});

on('WQ045', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  const kids = await Promise.all(['Hina Testwala', 'Omar Testwala', 'Tooba Testwala', 'Yusra Testwala'].map((n) => L.chipFor(ctx, CODES.OPEN, n)));
  await L.remember(page, ctx, kids.map(({ chip, first, animal }) => ({ chip, first, animal })));
  const ev = L.events(page);
  await openQuiz(page, ctx, CODES.OPEN);
  const order = await page.$$eval('#wq-someone, .wq-kid-big', (els) => els.map((e) => e.id || 'card'));
  expect(order[0] === 'wq-someone', '"Someone else" is not first: ' + order.join(', '));
  expect(await page.$('.wq-kids-small'), 'the cards are not the smaller kind');
  await page.click('.wq-kid-big:has-text("Hina")');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  await page.waitForSelector('.wq-undo', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '.wq-undo')) === 'Not Hina?', 'undo reads "' + (await inner(page, '.wq-undo')) + '"');
  await page.click('.wq-undo');
  await page.waitForSelector(M('M4-name') + ', ' + M('M4-class'), { state: 'attached', timeout: WAIT });
  await ev.flush();
  const logged = ev.of('identity_pick').filter((e) => e.src === 'wrong_card');
  expect(logged.length && typeof logged[0].ms === 'number', 'no identity_pick {src: wrong_card, ms} event (seen: ' + JSON.stringify(ev.of('identity_pick').map((e) => e.src)) + ')');
  return { first: 'Someone else', undo: 'identity_pick wrong_card after ' + logged[0].ms + ' ms' };
});

on('WQ046', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  const kids = await Promise.all(['Tooba Testwala', 'Yusra Testwala'].map((n) => L.chipFor(ctx, CODES.OPEN, n)));
  await L.remember(page, ctx, kids.map(({ chip, first, animal }) => ({ chip, first, animal })));
  await openQuiz(page, ctx, CODES.OPEN);
  const b = await boot(page);
  await page.click('.wq-kid-big:has-text("Tooba")');
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  const toobaSession = (await sessionsOf(ctx, CODES.OPEN)).find((r) => r[0] === 'Tooba Testwala');
  await page.waitForSelector('.wq-undo', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '.wq-undo')) === 'Not Tooba?', 'undo reads "' + (await inner(page, '.wq-undo')) + '"');
  await page.click('.wq-undo');
  await page.waitForSelector(M('M4-name') + ', ' + M('M4-class'), { state: 'attached', timeout: WAIT });
  if (await screen(page) === 'M4-class') await page.click('#wq-cls-0');
  await typeName(page, 'Yusra'); await v2Card(page); await page.click('#wq-yes');
  await play(page, b.quiz.questions, 2, -1);
  const toobaAnswers = await L.one(ctx, 'select count(*) from quiz_answers where session_id = ' + q(toobaSession[3]));
  expect(toobaAnswers === '0', 'Yusra\'s answers went on Tooba\'s quiz (' + toobaAnswers + ')');
  return { toobaAnswers: 0 };
});

module.exports = { runs, modes };
