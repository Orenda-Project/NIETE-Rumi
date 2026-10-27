// web-quiz-child-page/core — the spine of the child's quiz page on today's identity path: the link opens with its
// preview data, a new child plays to the league table and the scorecard, a returning child is offered "Play as",
// a reload resumes, a switched-off code closes in its language. WQ01–WQ05.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, TOPIC, text, inner, boot, onScreen, healthy, openQuiz, startAsNew, current, tapAndNext, play } = L;

const modes = { WQ01: 'off', WQ02: 'off', WQ03: 'off', WQ04: 'off', WQ05: 'off' };

const runs = {
  WQ01: async (page, ctx) => {
    await L.setMode(ctx, page, 'off');
    const r = await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN);
    expect(r.status() === 200, '/q/' + CODES.OPEN + ' answered ' + r.status());
    const h = r.headers();
    expect(/no-cache/.test(h['cache-control'] || ''), 'Cache-Control is "' + h['cache-control'] + '", not no-cache');
    expect(/noindex/.test(h['x-robots-tag'] || ''), 'X-Robots-Tag is "' + h['x-robots-tag'] + '", not noindex');
    const w = await openQuiz(page, ctx, CODES.OPEN);
    const b = await boot(page);
    expect(b && b.quiz && b.quiz.topic === TOPIC, 'boot data names topic "' + (b && b.quiz && b.quiz.topic) + '"');
    expect(b.code === CODES.OPEN && b.view === 'quiz', 'boot data is for ' + b.code + ' / ' + b.view);
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
  },

  WQ02: async (page, ctx) => {
    await L.setMode(ctx, page, 'off');
    const b = await startAsNew(page, ctx, CODES.OPEN, 'Zara');
    const w = L.watch(page);
    const qs = b.quiz.questions;
    expect(qs.length === 5, qs.length + ' questions');
    await play(page, qs, 5, 2);
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
    await openQuiz(page, ctx, CODES.OPEN);
    await page.waitForSelector('.wq-scorecard', { state: 'visible', timeout: WAIT });
    const card = await inner(page, '.wq-scorecard');
    expect(card.includes('Zara'), 'the scorecard does not name Zara');
    expect(card.includes(TOPIC), 'the scorecard does not name the topic');
    expect(/4\s*\/\s*5|4 out of 5/.test(card), 'the scorecard does not show 4/5');
    const cardStars = await page.$eval('.wq-scorecard .wq-stars', (el) => el.getAttribute('aria-label'));
    expect(cardStars === '4/5', 'the scorecard shows ' + cardStars + ' stars');
    healthy(w, 'play-through');
    return { result: got, stars, league: you.split('\n')[0] };
  },

  // Scenarios share the run's database (a fresh browser each, not a fresh DB): a name a scenario already created for
  // this teacher would be met with "Are you …?" on a second phone, so every scenario types a name of its own.
  WQ03: async (page, ctx) => {
    await L.setMode(ctx, page, 'off');
    const b = await startAsNew(page, ctx, CODES.OPEN, 'Hira');
    await play(page, b.quiz.questions, 5, -1);
    await page.waitForSelector(onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
    expect((await inner(page, onScreen('M9') + ' h1')) === 'You got 5 out of 5', 'the first quiz did not finish 5/5');
    const w = await openQuiz(page, ctx, CODES.NEXT);
    await page.waitForSelector('#wq-play-as', { state: 'visible', timeout: WAIT });
    const offer = await inner(page, '#wq-play-as');
    expect(offer === 'Play as Hira', 'the landing offers "' + offer + '"');
    expect(!(await page.$('#wq-play')), 'the landing also shows a plain Play');
    healthy(w, 'second landing');
    return { offer };
  },

  WQ04: async (page, ctx) => {
    await L.setMode(ctx, page, 'off');
    const b = await startAsNew(page, ctx, CODES.OPEN, 'Omar');
    const qs = b.quiz.questions;
    await play(page, qs, 3, -1);
    await page.waitForSelector(onScreen('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const w = L.watch(page);
    await page.waitForSelector('#wq-cont', { state: 'visible', timeout: WAIT });
    const cont = await inner(page, '#wq-cont');
    expect(cont === 'Go on: question 4 of 5', 'the resume button reads "' + cont + '"');
    expect((await text(page)).includes('Welcome back, Omar'), 'the resume screen does not welcome Omar back');
    await page.click('#wq-cont');
    await page.waitForSelector(onScreen('M6') + ' .wq-qof', { state: 'visible', timeout: WAIT });
    const qof = await inner(page, '.wq-qof');
    expect(qof === 'Question 4 of 5', 'after Continue the page shows "' + qof + '"');
    await play(page, qs, 2, -1);
    await page.waitForSelector(onScreen('M9') + ' h1', { state: 'visible', timeout: WAIT });
    const got = await inner(page, onScreen('M9') + ' h1');
    expect(got === 'You got 5 out of 5', 'after the resume the result says "' + got + '" — the saved answers were not kept');
    healthy(w, 'resume');
    return { cont, qof, result: got };
  },

  WQ05: async (page, ctx) => {
    await L.setMode(ctx, page, 'off');
    const r = await page.request.get(ctx.baseUrl + '/q/' + CODES.CLOSED);
    expect(r.status() === 410, '/q/' + CODES.CLOSED + ' answered ' + r.status() + ', not 410');
    const w = await openQuiz(page, ctx, CODES.CLOSED);
    const lang = await page.$eval('html', (el) => el.getAttribute('lang'));
    expect(lang === 'ur', 'the closed page is in "' + lang + '", not the quiz\'s Urdu');
    const h1 = await inner(page, '.wq-closed h1');
    expect(h1 === 'یہ کوئز بند ہو چکا ہے', 'the closed page heads with "' + h1 + '"');
    expect(!(await page.$('#boot')), 'a closed quiz still ships boot data');
    // The spec's Given says "expired": a code past its expires_at closes the same way, in English here.
    const r2 = await page.request.get(ctx.baseUrl + '/q/' + CODES.EXPIRED);
    expect(r2.status() === 410, 'the expired code answered ' + r2.status() + ', not 410');
    expect(/This quiz has closed/.test(await r2.text()), 'the expired code does not show the closed page');
    healthy(w, 'closed page');
    return { status: r.status(), lang, h1, expired: r2.status() };
  },
};

module.exports = { runs, modes };
