// web-quiz-child-page/items — how a question is drawn: option order and per-option feedback, figures instead of the
// WhatsApp card, picture tiles as drawings, sound items, named picture answers, match rows P/Q/R, Urdu letter tiles,
// stems that point at a picture they do not have, maths typeset, a column sum, a picture that does not arrive, label
// rings outside the drawing, an undrawable pictogram, long words. Played on the seed's item-shape quizzes IT12AB /
// IT34CD (bot/scripts/e2e/portal-demo-seed.js) and the Urdu quiz UR12AB. The engine's rules: web-quiz.service.js
// questionPayload / playable, web-quiz-figure.js, web-quiz-items.js; the page: dashboard/public/wq/wq.js (WQI).
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, text, inner, count, boot, onScreen, startAsNew, current, tapAndNext } = L;
const M = (m) => onScreen(m);
const A = 'IT12AB', B = 'IT34CD', UR = 'UR12AB';

const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

// Walk the quiz to the question whose stem contains `stem` (answering the earlier ones right), and return its payload.
async function reach(page, ctx, code, stem, name) {
  const b = await startAsNew(page, ctx, code, name || ('Item' + Math.floor(Math.random() * 1e6)));
  const qs = b.quiz.questions;
  const target = qs.find((x) => x.text.includes(stem));
  expect(target, 'the quiz serves no question with "' + stem + '" (served: ' + qs.map((x) => x.text.slice(0, 30)).join(' | ') + ')');
  for (;;) {
    await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT });
    const qq = await current(page, qs);
    if (qq === target) return { q: qq, qs, boot: b };
    await L.answerRight(page, qq); await L.nextQ(page);
  }
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

on('WQ013', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'Which of these is a fruit?');
  const shown = await page.$$eval('.wq-opt[data-slot]', (els) => els.map((e) => ({ slot: e.getAttribute('data-slot'), text: e.querySelector('.wq-lab') ? e.querySelector('.wq-lab').innerText.trim() : e.innerText.trim() })));
  // the stored display order 2,0,3,1 → Bus, Apple, Pencil, Chair; the page keeps the payload's order (data-slot, never position)
  expect(shown.map((o) => o.text).join(',') === 'Bus,Apple,Pencil,Chair', 'buttons in order: ' + shown.map((o) => o.text).join(','));
  expect(shown.map((o) => o.slot).join(',') === q.options.map((o) => o.slot).join(','), 'the page order differs from the payload order');
  // each wrong answer has its own feedback; the right one is marked right
  await page.click('.wq-opt[data-slot="B"]');                         // Chair
  await page.waitForSelector('#wq-fb .wq-no', { state: 'visible', timeout: WAIT });
  expect((await text(page)).includes('A chair is furniture, not food.'), 'the chair\'s own feedback is missing');
  return { order: shown.map((o) => o.text), feedback: 'per option' };
});

on('WQ014', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'fraction of the bar');
  expect(q.figure && !q.img, 'the payload carries a card image instead of a figure: ' + JSON.stringify({ figure: Boolean(q.figure), img: q.img }));
  expect(await page.$('.wq-fig .wq-svg svg'), 'no drawn figure');
  expect(!(await page.$('img[src*="question_card"], img[src*="fraction-card"]')), 'the WhatsApp card is shown');
  const stems = await page.$$eval('.wq-qtext', (els) => els.filter((e) => /fraction of the bar/.test(e.innerText)).length);
  expect(stems === 1, 'the stem appears ' + stems + ' times');
  expect(!/fraction of the bar/.test(await page.$eval('.wq-fig', (e) => e.innerText)), 'the stem is painted inside the figure');
  expect(await count(page, '.wq-opt .wq-lab') === 4, 'the options are not shown once as text');
  expect(q.figure.say === 'Look at the bars.', 'the figure pointer is "' + q.figure.say + '"');
  return { say: q.figure.say };
});

on('WQ015', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'water cycle');
  expect(!q.img && !q.figure, 'a card-only question got a picture');
  expect(!(await page.$('.wq-fig, .wq-item img')), 'a picture is shown');
  expect(await count(page, '.wq-opt .wq-lab') === 4 && await count(page, '.wq-qtext') === 1, 'stem and options are not plain text');
  return { picture: 'none' };
});

on('WQ016', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await reach(page, ctx, A, 'Which one is an animal?');
  const tiles = await page.$$eval('.wq-ptile', (els) => els.map((e) => ({ svg: Boolean(e.querySelector('.wq-pic svg')), word: e.querySelector('.wq-pname') ? e.querySelector('.wq-pname').innerText.trim() : '' })));
  expect(tiles.length === 3 && tiles.every((t) => t.svg), 'tiles: ' + JSON.stringify(tiles));
  expect(tiles.map((t) => t.word).join(',') === 'Apple,Cat,Bus', 'words under the drawings: ' + tiles.map((t) => t.word).join(','));
  expect(!/[\u{1F300}-\u{1FAFF}]/u.test(await inner(page, '.wq-pgrid')), 'an emoji is drawn as an option');
  return { tiles: tiles.map((t) => t.word) };
});

on('WQ017', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ev = L.events(page);
  const { q } = await reach(page, ctx, A, 'Which animal do you hear?');
  expect(q.audio && q.audio.stim, 'the payload carries no sound for the item');
  expect((await inner(page, '#wq-stim')) === 'Play the sound' || /Play the sound/.test(await inner(page, '#wq-stim')), 'no "Play the sound" button');
  // before the child answers, no option clip plays (the question's words already ask it)
  await page.click('#wq-stim');
  await L.sleep(2500);
  await ev.flush();
  const fallback = ev.of('audio_fallback');
  expect(fallback.length >= 1, 'the unreachable clip did not fall back to the phone\'s voice (events: ' + [...new Set(ev.list.map((e) => e.n))].join(', ') + ')');
  const phone = await page.$eval('#wq', (e) => e.classList.contains('wq-phonevoice') || e.classList.contains('wq-novoice'));
  expect(phone || fallback.length, 'no phone-voice fallback shown');
  return { stim: q.audio.stim.slice(0, 40), fallback: fallback.map((e) => e.reason) };
});

on('WQ018', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'Which one do we sit on?');
  const names = q.options.map((o) => o.text);
  expect(names.join('|') === 'Table|House|Chair|', 'picture names: ' + names.join('|'));
  const tiles = await page.$$eval('.wq-ptile', (els) => els.map((e) => ({ img: Boolean(e.querySelector('img')), word: e.querySelector('.wq-pname') ? e.querySelector('.wq-pname').innerText.trim() : '' })));
  expect(tiles.length === 4 && tiles.every((t) => t.img), 'tiles: ' + JSON.stringify(tiles));
  expect(tiles.slice(0, 3).map((t) => t.word).join(',') === 'Table,House,Chair' && tiles[3].word === '', 'words under the pictures: ' + JSON.stringify(tiles.map((t) => t.word)));
  expect(!/Picture 1|Picture 4/.test(await text(page)), '"Picture N" is shown');
  return { words: tiles.map((t) => t.word) };
});

on('WQ019', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'Match each animal to its sound');
  const body = await text(page);
  expect(/\bP\b/.test(body) && /\bQ\b/.test(body) && /\bR\b/.test(body), 'rows are not named P, Q, R');
  expect(!/\bA-1\b/.test(body), 'the answer letters A-1 are still shown');
  expect(/P/.test(q.why || '') && !/\bA goes with/.test(q.why || ''), 'the explanation still says A: "' + q.why + '"');
  // the WhatsApp match becomes a page match: the right-hand answers keep their own A, B, C as data-slot
  const letters = await page.$$eval('.wq-mr[data-slot], .wq-opt[data-slot]', (els) => els.map((e) => e.getAttribute('data-slot')));
  expect(letters.includes('A') && letters.includes('B') && letters.includes('C'), 'the answer buttons lost their own A, B, C: ' + letters.join(','));
  return { rows: 'P Q R', buttons: 'A B C' };
});

on('WQ020', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await reach(page, ctx, UR, 'شدّ');
  const glyphs = await page.$$eval('.wq-glyph', (els) => els.map((e) => ({ text: e.innerText.trim(), size: parseFloat(getComputedStyle(e).fontSize), font: getComputedStyle(e).fontFamily, overflow: e.scrollHeight > e.clientHeight + 1 })));
  expect(glyphs.length === 3, glyphs.length + ' letter tiles');
  expect(glyphs.map((g) => g.text).join(' ') === 'بّ بِ بْ', 'tiles read ' + glyphs.map((g) => g.text).join(' '));
  expect(glyphs.every((g) => g.size >= 40), 'tiles are not large: ' + glyphs.map((g) => g.size).join(','));
  expect(glyphs.every((g) => /nastaliq|wq-ur|Noto/i.test(g.font)), 'not the page\'s Urdu face: ' + glyphs[0].font);
  expect(glyphs.every((g) => !g.overflow), 'a tile clips its marks');
  return { glyphs: glyphs.map((g) => g.text) };
});

on('WQ021', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.openQuiz(page, ctx, A);
  const b = await boot(page);
  const served = b.quiz.questions.map((x) => x.text);
  expect(!served.some((t) => /Look at the pictures\. Which one is a leaf\?/.test(t)), 'the pictureless "look at the pictures" stem is served');
  const stored = Number(await L.one(ctx, "select count(*) from quiz_questions where quiz_id = (select quiz_id from quiz_share_codes where code = 'IT12AB')"));
  expect(served.length === stored - 1, 'served ' + served.length + ' of ' + stored + ' (one should be left out)');
  expect(b.quiz.n === undefined || b.quiz.n === served.length, 'quiz.n is ' + b.quiz.n);
  return { stored, served: served.length };
});

on('WQ022', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'Which part takes in water?');
  expect(q.img, 'the row\'s own picture is not in the payload');
  const img = await page.$('.wq-fig img, .wq-item img');
  expect(img, 'no picture on screen');
  const ok = await page.evaluate(() => { const i = document.querySelector('.wq-fig img, .wq-item img'); const o = document.querySelector('.wq-opts, .wq-opt'); return i && o && i.getBoundingClientRect().bottom <= o.getBoundingClientRect().top + 1 && i.naturalWidth > 0; });
  expect(ok, 'the picture is not above the options (or did not load)');
  return { picture: 'above the options' };
});

on('WQ090', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await reach(page, ctx, A, 'of 8?');
  const body = (await text(page)).replace(/\s+/g, ' ');                 // MathML's own spacing varies: compare without it
  for (const [want, rx] of [['60 Ω', /60\s*Ω/], ['9 ÷ 3 ≠ 3 ÷ 9', /9\s*÷\s*3\s*≠\s*3\s*÷\s*9/], ['Rs 40', /Rs\s*40/]]) expect(rx.test(body), 'the page does not show "' + want + '": ' + body.slice(0, 160));
  for (const no of ['Omega', 'neq', 'frac', '\\', '$']) expect(!body.includes(no), 'the page shows "' + no + '"');
  expect(await count(page, '.wq-item math') >= 4, 'maths is not typeset as MathML');
  expect(await noOverflow(page), 'the page scrolls sideways');
  return { typeset: true };
});

on('WQ091', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await reach(page, ctx, A, 'column sum');
  const col = await page.$eval('.wq-opt[data-slot="A"] math', (m) => {
    const rows = [...m.querySelectorAll('mtr')].map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim());   // MathML nodes have no innerText
    const ruled = [...m.querySelectorAll('mtd')].some((d) => /border-top/.test(d.getAttribute('style') || ''));
    const right = [...m.querySelectorAll('mtd')].every((d) => /right/.test(d.getAttribute('columnalign') || getComputedStyle(d).textAlign));
    return { rows, ruled, right };
  });
  expect(col.rows[0].includes('712') && /-\s*460/.test(col.rows[1] || ''), 'the column sum rows read ' + JSON.stringify(col.rows));
  expect(col.ruled, 'no rule under the numbers');
  return col;
});

on('WQ092', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { q } = await reach(page, ctx, A, 'two plus two');
  expect(q.img, 'the payload carries no picture url');
  await page.waitForFunction(() => { const f = document.querySelector('.wq-fig'); return !f || getComputedStyle(f).display === 'none'; }, null, { timeout: WAIT });
  const broken = await page.$$eval('.wq-item img', (els) => els.filter((i) => i.complete && i.naturalWidth === 0 && getComputedStyle(i.closest('figure') || i).display !== 'none').length);
  expect(broken === 0, broken + ' broken picture icon(s) remain');
  expect(!(await page.$('figcaption')), 'a picture caption remains');
  expect(await count(page, '.wq-opt') === 4, 'the question does not play on its words');
  return { figure: 'hidden' };
});

on('WQ093', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await reach(page, ctx, A, 'apple in the middle');
  expect(!(await page.$('.wq-hot')), 'rings are drawn although one lies outside the picture');
  expect(await count(page, '.wq-opts .wq-opt[data-slot]') === 3, 'the parts are not offered as ordinary buttons');
  const kind = await page.$eval('.wq-item', (e) => e.getAttribute('data-kind'));
  expect(kind === 'single', 'the item kind is ' + kind);
  return { kind };
});

on('WQ088', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await reach(page, ctx, A, 'Which one can you ride?');
  expect(!(await page.$('.wq-pgrid')), 'a picture grid is shown although one picture cannot be drawn');
  const words = await page.$$eval('.wq-opts .wq-opt .wq-lab', (els) => els.map((e) => e.innerText.trim()));
  expect(words.join(',') === 'Zorblax,Bus,Chair', 'options read ' + words.join(','));
  const overlap = await page.$$eval('.wq-opts .wq-opt', (els) => { const r = els.map((e) => e.getBoundingClientRect()); return r.some((a, i) => r.some((b, j) => i < j && a.bottom > b.top + 1 && b.bottom > a.top + 1 && a.right > b.left + 1 && b.right > a.left + 1)); });
  expect(!overlap, 'option words are painted over one another');
  return { words };
});

on('WQ191', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await page.setViewportSize({ width: 360, height: 740 });
  await reach(page, ctx, A, 'quantity,quality');
  expect(await noOverflow(page), 'the page scrolls sideways');
  const fits = await page.evaluate(() => [...document.querySelectorAll('.wq-qtext, .wq-opt .wq-lab')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1 && e.scrollWidth <= e.clientWidth + 2));
  expect(fits, 'a long word runs off its card');
  const spk = await page.$eval('#wq-spk', (e) => { const r = e.getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0 && r.width > 0; });
  expect(spk, 'the question\'s speaker is off the screen');
  return { viewport: '360x740', fits: true };
});

// Every item shape renders and answers on a 360×740 phone, in English (IT34CD: multi, true/false, order, match,
// listen, word blank, two options) — and the Urdu quiz for the Nastaliq face. The render matrix tool
// (scripts/qa/render-matrix) is the exhaustive version of this; here each kind is played for real.
on('WQ089', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await page.setViewportSize({ width: 360, height: 740 });
  const b = await startAsNew(page, ctx, B, 'Shapes' + Math.floor(Math.random() * 1e6));
  const kinds = [];
  for (const qq of b.quiz.questions) {
    await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT });
    const cur = await current(page, b.quiz.questions);
    const kind = await page.$eval('.wq-item', (e) => e.getAttribute('data-kind'));
    kinds.push(kind);
    expect(await noOverflow(page), kind + ': the page scrolls sideways');
    const empty = await page.$$eval('.wq-opt, .wq-ml, .wq-mr, .wq-place', (els) => els.filter((e) => !e.innerText.trim() && !e.querySelector('svg, img, .wq-glyph')).length);
    expect(empty === 0, kind + ': ' + empty + ' option(s) show neither a word nor a picture');
    expect(!/[$\\]/.test(await text(page)), kind + ': a maths command shows as text');
    // answer it, right, by kind
    if (kind === 'multi') { for (const s of cur.correct_slot.split(',')) await page.click('.wq-opt[data-slot="' + s + '"]'); await page.click('#wq-check'); }
    else if (kind === 'order') { for (const s of cur.correct_slot.split(',')) await page.click('.wq-pool .wq-opt[data-slot="' + s + '"]'); await page.click('#wq-check'); }
    else if (kind === 'match') { for (const s of cur.correct_slot.split(',')) await page.click('.wq-mr[data-slot="' + s + '"]'); await page.click('#wq-check'); }
    else await page.click('.wq-opt[data-slot="' + cur.correct_slot.split(',')[0] + '"]');
    await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
    expect(await page.$('#wq-fb .wq-ok'), kind + ': the right answer was not marked right');
    await page.click('#wq-next');
    void qq;
  }
  await L.toResults(page);
  // the Urdu quiz: Nastaliq face, RTL
  await L.openQuiz(page, ctx, UR);
  const dir = await page.$eval('html', (e) => e.getAttribute('dir'));
  const font = await page.$eval('#wq h1', (e) => getComputedStyle(e).fontFamily);
  expect(dir === 'rtl' && /nastaliq|wq-ur|Noto/i.test(font), 'Urdu page: dir ' + dir + ', font ' + font);
  return { kinds, urdu: { dir, font: font.split(',')[0] } };
});

on('WQ094', 'off', async () => ({ blocked: 'the render check is its own tool (scripts/qa/render-matrix: build_matrix.js + run_matrix.py over every shape the engine can emit, EN + UR, a wrong and a right pick); it is not a browser scenario of the child page. WQ089 plays every shape here instead.' }));

on('WQ069', 'off', async () => ({ blocked: 'word-blank filtering runs at authoring under the quiz-author gates v2 (web-quiz.service wrongWordBlank → quiz-author-gates-v2 WORD_BLANK_NOT_ASKED / NOT_A_WORD), which needs the gate\'s LLM verdict — no cassette for it on this lane' }));

module.exports = { runs, modes };
