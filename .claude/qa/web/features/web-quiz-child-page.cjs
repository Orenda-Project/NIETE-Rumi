// web-quiz-child-page — web-lane driver for tests/features/web/web-quiz-child-page.feature. Runs the @WQnn scenarios: the
// child's quiz page at /q/<code>, on the demo seed's quizzes (bot/scripts/e2e/portal-demo-seed.js): AB12CD and SM34EF are
// open in English, QZCLOSED is switched off in Urdu. The page is dashboard/public/wq/wq.js, served by
// dashboard/routes/web-quiz.routes.js and fed by the bot's /api/internal/wq/* (web-quiz.service.js) over the stack's
// internal key. No roster or identity switch is set on the run database, so a child plays today's path: Play → I'm new →
// a first name. Controls are the page's own ids and classes; what the child reads is asserted by its visible words
// (wq.js's T copy). Scenarios without a @WQ tag are not driven yet.
'use strict';
const { expect, watch } = require('../lib.cjs');

const OPEN = 'AB12CD';      // Parts of a Plant, 5 questions
const NEXT = 'SM34EF';      // States of Matter: "a new quiz" for the remembered-child scenario
const CLOSED = 'QZCLOSED';  // active = false, language ur
const TOPIC = 'Parts of a Plant';
const WAIT = 15000;

// The identity switches live in app_settings and ride in from the seed snapshot (the sandbox's values: identity v2 is ON
// there). The @WQ02–@WQ04 scenarios are written for today's path (Play → I'm new → a first name), so every scenario pins
// both switches OFF on this run's database before its first page load; the bot reads them on that load (30 s cache), so
// pinning first keeps every later scenario consistent too. The name-first (v2) and roll-number scenarios are their own
// @T360+ rows, not driven yet.
async function todaysPath(ctx) {
  await ctx.sql("delete from app_settings where key in ('web_quiz_identity', 'web_quiz_roster_id')");
}

const text = (page) => page.evaluate(() => document.body.innerText);
const inner = (page, sel) => page.$eval(sel, (el) => el.innerText.trim());
const boot = (page) => page.evaluate(() => JSON.parse(document.getElementById('boot').textContent));
// The page's screen marker: render(h, m) writes it on <main id="wq"> (M3 landing, M6 question, M7 feedback, M9 results …).
const onScreen = (sel) => '#wq[data-m="' + sel + '"]';

function healthy(w, where) {
  expect(!w.errors.length, where + ': uncaught page error — ' + w.errors[0]);
  expect(!w.fivexx.length, where + ': API returned ' + [...new Set(w.fivexx)].join(', '));
}

// Open /q/<code> and wait for whichever first screen the phone's state gives: the landing, the resume
// screen, the scorecard, or the closed page.
async function openQuiz(page, ctx, code) {
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + '/q/' + code, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-play, #wq-play-as, #wq-cont, .wq-scorecard, .wq-closed', { state: 'visible', timeout: WAIT });
  return w;
}

// A child this phone has never seen: Play → I'm new → a first name → Start. Resolves on question 1 with the boot payload.
async function startAsNew(page, ctx, code, name) {
  await todaysPath(ctx);
  await openQuiz(page, ctx, code);
  const b = await boot(page);
  await page.click('#wq-play');
  await page.waitForSelector('#wq-new', { state: 'visible', timeout: WAIT });
  await page.click('#wq-new');
  await page.fill('#wq-name', name);
  await page.click('#wq-start');
  await page.waitForSelector(onScreen('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  return b;
}

// The question on screen, found by its stem among the boot questions (works on the first pass and the retry pass).
async function current(page, questions) {
  const item = await inner(page, '.wq-item');
  const q = questions.find((x) => item.includes(x.text));
  expect(q, 'the question on screen matches none of the quiz: "' + item.slice(0, 80) + '"');
  return q;
}
const wrongSlot = (q) => q.options.map((o) => o.slot).find((s) => s !== q.correct_slot);
// Tap an option, wait for Jugnu's feedback, tap Next.
async function tapAndNext(page, slot) {
  await page.click('.wq-opt[data-slot="' + slot + '"]');
  await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
  await page.click('#wq-next');
}
// Answer `count` questions of the first pass, all right except the one at `wrongAt` (an index into the quiz, or -1).
async function play(page, questions, count, wrongAt) {
  for (let n = 0; n < count; n++) {
    await page.waitForSelector(onScreen('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
    const q = await current(page, questions);
    await tapAndNext(page, questions.indexOf(q) === wrongAt ? wrongSlot(q) : q.correct_slot);
  }
}

const scenarios = [
  { id: 'WQ01', title: 'The link opens the quiz page with a link preview', run: async (page, ctx) => {
    await todaysPath(ctx);
    const r = await page.request.get(ctx.baseUrl + '/q/' + OPEN);
    expect(r.status() === 200, '/q/' + OPEN + ' answered ' + r.status());
    const h = r.headers();
    expect(/no-cache/.test(h['cache-control'] || ''), 'Cache-Control is "' + h['cache-control'] + '", not no-cache');
    expect(/noindex/.test(h['x-robots-tag'] || ''), 'X-Robots-Tag is "' + h['x-robots-tag'] + '", not noindex');
    const w = await openQuiz(page, ctx, OPEN);
    const b = await boot(page);
    expect(b && b.quiz && b.quiz.topic === TOPIC, 'boot data names topic "' + (b && b.quiz && b.quiz.topic) + '"');
    expect(b.code === OPEN && b.view === 'quiz', 'boot data is for ' + b.code + ' / ' + b.view);
    expect(Array.isArray(b.quiz.questions) && b.quiz.questions.length === 5, 'boot carries ' + (b.quiz.questions || []).length + ' questions, not 5');
    const meta = await page.evaluate(() => Object.fromEntries(['og:title', 'og:description', 'og:image'].map((p) => {
      const m = document.querySelector('meta[property="' + p + '"]'); return [p, m ? m.getAttribute('content') : null];
    })));
    for (const k of Object.keys(meta)) expect(meta[k], 'no ' + k + ' tag');
    expect(/^https?:\/\/.+\.jpg/.test(meta['og:image']), 'og:image is not a picture URL: ' + meta['og:image']);
    const robots = await page.$eval('meta[name="robots"]', (m) => m.getAttribute('content'));
    expect(/noindex/.test(robots || ''), 'meta robots is "' + robots + '"');
    expect((await inner(page, '#wq h1')) === TOPIC, 'the landing does not head with the topic');
    healthy(w, 'landing');
    return { status: r.status(), og: meta, questions: b.quiz.questions.length };
  } },

  { id: 'WQ02', title: 'A new child plays to the class league table', run: async (page, ctx) => {
    const b = await startAsNew(page, ctx, OPEN, 'Zara');
    const w = watch(page);
    const qs = b.quiz.questions;
    expect(qs.length === 5, qs.length + ' questions');
    await play(page, qs, 5, 2);                                  // one wrong: the third
    await page.waitForSelector('#wq-fix', { state: 'visible', timeout: WAIT });
    expect((await text(page)).includes('1 tricky one'), 'the tricky screen does not count 1 tricky one');
    await page.click('#wq-fix');
    await page.waitForSelector(onScreen('M9-fix') + ' .wq-opt', { state: 'visible', timeout: WAIT });
    const again = await current(page, qs);
    expect(qs.indexOf(again) === 2, 'the retry shows question ' + (qs.indexOf(again) + 1) + ', not the one got wrong');
    await tapAndNext(page, again.correct_slot);
    await page.waitForSelector(onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
    const got = await inner(page, onScreen('M9') + ' h1');
    expect(got === 'You got 4 out of 5', 'the result says "' + got + '"');
    const stars = await page.$eval(onScreen('M9') + ' .wq-stars', (el) => el.getAttribute('aria-label'));
    expect(stars === '4/5', stars + ' stars, not 4/5');
    expect((await text(page)).includes('fixed 1 tricky one'), 'the result does not say the tricky one was fixed');
    await page.click('#wq-class');
    await page.waitForSelector('tr.wq-you', { state: 'visible', timeout: WAIT });
    const you = await inner(page, 'tr.wq-you');
    expect(you.includes('YOU') && you.includes('Zara'), 'the league table\'s own row reads "' + you + '"');
    expect(/league table/.test(await inner(page, '#wq h2')), 'no league table heading');
    // This phone has finished: opening the link again lands on the scorecard.
    await openQuiz(page, ctx, OPEN);
    await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
    const card = await inner(page, '.wq-scorecard');
    expect(card.includes('Zara'), 'the scorecard does not name Zara');
    expect(card.includes(TOPIC), 'the scorecard does not name the topic');
    expect(/4\s*\/\s*5|4 out of 5/.test(card), 'the scorecard does not show 4/5');
    const cardStars = await page.$eval('.wq-scorecard .wq-stars', (el) => el.getAttribute('aria-label'));
    expect(cardStars === '4/5', 'the scorecard shows ' + cardStars + ' stars');
    healthy(w, 'play-through');
    return { result: got, stars, league: you.split('\n')[0] };
  } },

  // Scenarios share the run's database (a fresh browser each, not a fresh DB): a name a scenario already created for this
  // teacher would be met with "Are you …?" on a second phone, so every scenario types a name of its own.
  { id: 'WQ03', title: 'A returning child is remembered on this phone', run: async (page, ctx) => {
    const b = await startAsNew(page, ctx, OPEN, 'Hira');
    await play(page, b.quiz.questions, 5, -1);                   // all right: straight to the result
    await page.waitForSelector(onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
    expect((await inner(page, onScreen('M9') + ' h1')) === 'You got 5 out of 5', 'the first quiz did not finish 5/5');
    const w = await openQuiz(page, ctx, NEXT);                   // a new quiz, same phone
    await page.waitForSelector('#wq-play-as', { state: 'visible', timeout: WAIT });
    const offer = await inner(page, '#wq-play-as');
    expect(offer === 'Play as Hira', 'the landing offers "' + offer + '"');
    expect(!(await page.$('#wq-play')), 'the landing also shows a plain Play');
    healthy(w, 'second landing');
    return { offer };
  } },

  { id: 'WQ04', title: 'A reload mid-quiz resumes', run: async (page, ctx) => {
    const b = await startAsNew(page, ctx, OPEN, 'Omar');
    const qs = b.quiz.questions;
    await play(page, qs, 3, -1);                                 // 3 of 5 answered, question 4 on screen
    await page.waitForSelector(onScreen('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const w = watch(page);
    await page.waitForSelector('#wq-cont', { state: 'visible', timeout: WAIT });
    const cont = await inner(page, '#wq-cont');
    expect(cont === 'Go on: question 4 of 5', 'the resume button reads "' + cont + '"');
    expect((await text(page)).includes('Welcome back, Omar'), 'the resume screen does not welcome Omar back');
    await page.click('#wq-cont');
    await page.waitForSelector(onScreen('M6') + ' .wq-qof', { state: 'visible', timeout: WAIT });
    const qof = await inner(page, '.wq-qof');
    expect(qof === 'Question 4 of 5', 'after Continue the page shows "' + qof + '"');
    // The saved answers are kept: finishing the last two scores all five.
    await play(page, qs, 2, -1);
    await page.waitForSelector(onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
    const got = await inner(page, onScreen('M9') + ' h1');
    expect(got === 'You got 5 out of 5', 'after the resume the result says "' + got + '" — the saved answers were not kept');
    healthy(w, 'resume');
    return { cont, qof, result: got };
  } },

  { id: 'WQ05', title: 'A closed quiz explains itself in the quiz language', run: async (page, ctx) => {
    await todaysPath(ctx);
    const r = await page.request.get(ctx.baseUrl + '/q/' + CLOSED);
    expect(r.status() === 410, '/q/' + CLOSED + ' answered ' + r.status() + ', not 410');
    const w = await openQuiz(page, ctx, CLOSED);
    const lang = await page.$eval('html', (el) => el.getAttribute('lang'));
    expect(lang === 'ur', 'the closed page is in "' + lang + '", not the quiz\'s Urdu');
    const h1 = await inner(page, '.wq-closed h1');
    expect(h1 === 'یہ کوئز بند ہو چکا ہے', 'the closed page heads with "' + h1 + '"');
    expect(!(await page.$('#boot')), 'a closed quiz still ships boot data');
    healthy(w, 'closed page');
    return { status: r.status(), lang, h1 };
  } },
];

module.exports = { feature: 'web-quiz-child-page', spec: 'tests/features/web/web-quiz-child-page.feature', scenarios };
