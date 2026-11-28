// web-quiz-item-types — web-lane driver for tests/features/web/web-quiz-item-types.feature: the child page (/q/<code>,
// dashboard/public/wq/wq.js WQI) drawing each question by its type — single, picture, multi, order, match, label, listen,
// figures and maths — in English and Urdu.
//
// The run-wide set-up (`before`) writes one small quiz per item shape on THIS run's database, owned by a teacher of its
// own, each with its own code (the question shapes are the seed's own: bot/scripts/e2e/portal-demo-seed.js itemsA/itemsB,
// plus the Urdu ones and a label whose rings sit on its drawing). A scenario opens its quiz as a new child (today's
// identity path) and checks the spec's Then steps on the page: tap-target sizes, direction, console errors, what the
// answer the page SENDS is (/api/wq/answers, read off the wire), and what the voice SAYS — every utterance the page hands
// to speechSynthesis is recorded (the run's voices are muted, not removed). Spec ids are @IT01–@IT10.
'use strict';
const L = require('./web-quiz-child-page/lib.cjs');
const F = require('./teacher-report/fixture.cjs');
const { expect, WAIT, onScreen } = L;
const M6 = onScreen('M6');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const web = (type, stem, key, why, options, extra) => ({ v: 2, type, wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'e2e' }, stem, key, why, options, ...(extra || {}) });
const picto = (slot, text, name) => ({ slot, text, name: text, pic: { kind: 'pictogram', name } });
// [text, [a,b,c,d], correct, why, media]
const ITEMS = {
  single_en: { lang: 'en', qs: [['Which part of a plant takes in water from the soil?', ['Root', 'Leaf', 'Flower', 'Stem'], 'A', 'Roots take in water.', { language: 'en' }]] },
  picture_ur: { lang: 'ur', qs: [['کون سا جانور ہے؟', ['سیب', 'بلی', 'بس', null], 'B', 'بلی ایک جانور ہے۔',
    { language: 'ur', web: web('picture', 'کون سا جانور ہے؟', 'B', 'بلی ایک جانور ہے۔', [picto('A', 'سیب', 'apple'), picto('B', 'بلی', 'cat'), picto('C', 'بس', 'bus')]) }]] },
  multi_en: { lang: 'en', qs: [['Which of these are living things?', ['Goat', 'Stone', 'Tree', 'Cup'], 'A,C', 'A goat and a tree are living.', { language: 'en' }]] },
  // four steps, served in a shuffled order: seed, plant, flower, fruit = C, D, A, B
  order_ur: { lang: 'ur', qs: [['مراحل کو ترتیب دیں۔', ['پھول', 'پھل', 'بیج', 'پودا'], 'C,D,A,B', 'بیج، پودا، پھول، پھر پھل۔',
    { language: 'ur', web: web('order', 'مراحل کو ترتیب دیں۔', 'C,D,A,B', 'بیج، پودا، پھول، پھر پھل۔', [{ slot: 'A', text: 'پھول' }, { slot: 'B', text: 'پھل' }, { slot: 'C', text: 'بیج' }, { slot: 'D', text: 'پودا' }]) }]] },
  order_en: { lang: 'en', qs: [['Put the stages in order.', ['Flower', 'Fruit', 'Seed', null], 'C,A,B', 'Seed, then flower, then fruit.',
    { language: 'en', web: web('order', 'Put the stages in order.', 'C,A,B', 'Seed, then flower, then fruit.', [{ slot: 'A', text: 'Flower' }, { slot: 'B', text: 'Fruit' }, { slot: 'C', text: 'Seed' }]) }]] },
  match_en: { lang: 'en', qs: [['Match each animal to its home.', ['Hive', 'Nest', 'Water', null], 'B,C,A', 'A bird lives in a nest, a fish in water, a bee in a hive.',
    { language: 'en', web: web('match', 'Match each animal to its home.', 'B,C,A', 'A bird lives in a nest, a fish in water, a bee in a hive.', [{ slot: 'A', text: 'Hive' }, { slot: 'B', text: 'Nest' }, { slot: 'C', text: 'Water' }], { left: [{ text: 'Bird' }, { text: 'Fish' }, { text: 'Bee' }] }) }]] },
  // three apples drawn 288 × 132 (web-quiz-figure count_objects); the rings sit on them
  label_ur: { lang: 'ur', qs: [['درمیان والے سیب پر ٹیپ کریں۔', ['بائیں', 'درمیان', 'دائیں', null], 'B', 'درمیان والا سیب۔',
    { language: 'ur', figure: { type: 'count_objects', count: 3, picto: 'apple' }, web: web('label', 'درمیان والے سیب پر ٹیپ کریں۔', 'B', 'درمیان والا سیب۔',
      [{ slot: 'A', text: 'بائیں' }, { slot: 'B', text: 'درمیان' }, { slot: 'C', text: 'دائیں' }],
      { figure: { spec: { type: 'count_objects', count: 3, picto: 'apple' }, hotspots: [{ slot: 'A', x: 48, y: 66, r: 30 }, { slot: 'B', x: 144, y: 66, r: 30 }, { slot: 'C', x: 240, y: 66, r: 30 }] } }) }]] },
  listen_en: { lang: 'en', qs: [['Listen. Which one is it?', ['Apple', 'Chair', 'Pencil', null], 'A', 'An apple.',
    { language: 'en', web: web('listen', 'Listen. Which one is it?', 'A', 'An apple.', [picto('A', 'Apple', 'apple'), picto('B', 'Chair', 'chair'), picto('C', 'Pencil', 'pencil')]) }]] },
  picture_en: { lang: 'en', qs: [['Which one is an animal?', ['Apple', 'Cat', 'Bus', null], 'B', 'A cat is an animal.',
    { language: 'en', web: web('picture', 'Which one is an animal?', 'B', 'A cat is an animal.', [picto('A', 'Apple', 'apple'), picto('B', 'Cat', 'cat'), picto('C', 'Bus', 'bus')]) }]] },
  maths_en: { lang: 'en', qs: [['What is $\\frac{3}{4}$ of 8?', ['6', '4', '3', '8'], 'A', 'Three quarters of eight is six: $\\frac{3}{4} \\times 8 = 6$.', { language: 'en' }]] },
  maths_ur: { lang: 'ur', qs: [['8 کا $\\frac{3}{4}$ کتنا ہے؟', ['6', '4', '3', '8'], 'A', '8 کا $\\frac{3}{4}$ چھ ہے۔', { language: 'ur' }]] },
  figure_en: { lang: 'en', qs: [['What fraction of the bar is shaded?', ['3/4', '1/4', '1/2', '4/3'], 'A', 'Three of the four parts are shaded.',
    { language: 'en', figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] } }]] },
  // a plain first question, then one with four picture files: the page fetches the second's pictures while the child answers
  slow_en: { lang: 'en', qs: [['Which part of a plant makes food?', ['Root', 'Leaf', 'Seed', 'Fruit'], 'B', 'Leaves make food.', { language: 'en' }],
    ['Which one do we sit on?', ['1. Table', '2. House', '3. Chair', 'Picture 4'], 'C', 'We sit on a chair.', { language: 'en', option_images: [{ b64: PNG }, { b64: PNG }, { b64: PNG }, { b64: PNG }] }]] },
  // the fourth picture has no word ("Picture 4" is not a name)
  noword_en: { lang: 'en', qs: [['Which one do we sit on?', ['1. Table', '2. House', '3. Chair', 'Picture 4'], 'C', 'We sit on a chair.', { language: 'en', option_images: [{ b64: PNG }, { b64: PNG }, { b64: PNG }, { b64: PNG }] }]] },
};
const CODES = {};

async function before(ctx) {
  const T = await F.teacher(ctx, { lists: [], quiz: false });
  for (const [key, it] of Object.entries(ITEMS)) {
    const quizId = F.uuid(), sc = F.uuid(), code = 'IT' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
    await ctx.sql('insert into quizzes (id, teacher_id, quiz_source, topic, grade, subject, status, language, total_students_sent, created_at) values ('
      + [F.q(quizId), F.q(T.teacherId), F.q('lesson_plan'), F.q('Item ' + key), F.q('4'), F.q('science'), F.q('sent'), F.q(it.lang), '0', "now() - interval '1 hour'"].join(', ') + ')');
    let k = 0;
    for (const [text, o, correct, why, media] of it.qs) {
      k += 1;
      await ctx.sql('insert into quiz_questions (id, quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty_level, sort_order, media) values ('
        + [F.q(F.uuid()), F.q(quizId), F.q(text), F.q(o[0]), F.q(o[1]), F.q(o[2]), F.q(o[3]), F.q(correct), F.q(why), '3', String(k), F.q(JSON.stringify(media)) + '::jsonb'].join(', ') + ')');
    }
    await ctx.sql('insert into quiz_share_codes (id, code, quiz_id, teacher_user_id, teacher_name, topic, language, active, uses_count, expires_at, created_at) values ('
      + [F.q(sc), F.q(code), F.q(quizId), F.q(T.teacherId), F.q('Item Teacher'), F.q('Item ' + key), F.q(it.lang), 'true', '0', 'null', "now() - interval '1 hour'"].join(', ') + ')');
    CODES[key] = code;
  }
}

// ── on the page ───────────────────────────────────────────────────────────────────────────────────────────────────
// Every utterance the page hands to the phone's voice, in order (installed before the page's own script runs).
const RECORD_SPEECH = () => {
  window.__said = [];
  const s = window.speechSynthesis;
  if (!s || typeof s.speak !== 'function') return;
  const speak = s.speak.bind(s);
  s.speak = function (u) { try { window.__said.push(String(u.text || '')); } catch (_) { /* keep going */ } return speak(u); };
};
const consoleErrors = (page) => {
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).split('\n')[0].slice(0, 160)));
  return errs;
};
// The answers the page sends (POST /api/wq/answers), as { qid: slot }.
const sentAnswers = (page) => {
  const got = {};
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !/\/api\/wq\/answers$/.test(new URL(r.url()).pathname)) return;
    try { for (const a of JSON.parse(r.postData() || '{}').a || []) got[a.qid] = a.slot; } catch (_) { /* not JSON */ }
  });
  return got;
};
async function waitFor(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) throw new Error(what); await L.sleep(250); }
}
let modeSet = false;
// Open the item's quiz as a new child (today's identity path) and land on its first question.
async function reach(page, ctx, key) {
  if (!modeSet) { await L.setMode(ctx, page, 'off'); modeSet = true; }
  await page.addInitScript(RECORD_SPEECH);
  // today's path: Play → I'm new → a first name → Start → question 1 (as lib.startAsNew, but waiting for the item itself:
  // a match or label question has no .wq-opt)
  await L.openQuiz(page, ctx, CODES[key]);
  const b = await L.boot(page);
  await page.waitForSelector('#wq-play, #wq-new, #wq-name', { state: 'visible', timeout: WAIT });
  if (!(await page.$('#wq-new')) && !(await page.$('#wq-name'))) { await page.click('#wq-play'); await page.waitForSelector('#wq-new, #wq-name', { state: 'visible', timeout: WAIT }); }
  if (await page.$('#wq-new')) await page.click('#wq-new');
  await page.fill('#wq-name', 'Kid' + Math.floor(Math.random() * 1e6));
  await page.click('#wq-start');
  await page.waitForSelector(M6 + ' .wq-item', { state: 'visible', timeout: WAIT });
  return { boot: b, q: b.quiz.questions[0], qs: b.quiz.questions };
}
// What the voice says for the question on screen: tap its speaker and read what was spoken.
async function voiceOf(page) {
  await page.evaluate(() => { window.__said = []; });
  const spk = await page.$('#wq-spk');
  if (spk) await spk.click();
  await L.sleep(1500);
  // the page speaks part by part, each after the last ends (a muted voice still ends): read until nothing new has been
  // said for 2 s and the voice is quiet, at most 20 s
  let said = [], still = 0;
  for (let i = 0; i < 40 && still < 4; i++) {
    await L.sleep(500);
    const now = await page.evaluate(() => ({ said: window.__said.slice(), busy: Boolean(window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) }));
    still = now.said.length === said.length && !now.busy ? still + 1 : 0;
    said = now.said;
  }
  return said;
}
const SMALL = 48;
async function smallTargets(page) {
  return page.evaluate((min) => [...document.querySelectorAll('button, a[href], [role="button"], input, .wq-opt, .wq-hot, .wq-ml, .wq-mr, .wq-place')]
    .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.disabled; })
    .map((e) => { const r = e.getBoundingClientRect(); return { el: (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]), w: Math.round(r.width), h: Math.round(r.height), t: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 20) }; })
    .filter((x) => x.w < min - 0.5 || x.h < min - 0.5), SMALL);
}

const S = [];
const add = ({ id }, title, run) => S.push({ id, title, run });   // ids as an object key: the form validate_specs reads

add({ id: 'IT01' }, 'Every web item type renders with large tap targets in both languages', async (page, ctx) => {
  const EX = [['single', 'en', 'ltr', 'single_en'], ['picture', 'ur', 'rtl', 'picture_ur'], ['multi', 'en', 'ltr', 'multi_en'], ['order', 'ur', 'rtl', 'order_ur'],
    ['match', 'en', 'ltr', 'match_en'], ['label', 'ur', 'rtl', 'label_ur'], ['listen', 'en', 'ltr', 'listen_en']];
  const out = [], fails = [];
  for (const [type, lang, dir, key] of EX) {
    const ctx2 = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
    const p = await ctx2.newPage();
    const errs = consoleErrors(p);
    try {
      await reach(p, ctx, key);
      const kind = await p.$eval('.wq-item', (e) => e.getAttribute('data-kind'));
      const html = await p.$eval('html', (e) => e.getAttribute('dir'));
      await L.sleep(800);
      const small = await smallTargets(p);
      const row = { type, lang, kind, dir: html, small: small.slice(0, 4), errors: errs.slice(0, 3) };
      out.push(row);
      if (kind !== type) fails.push(type + ': drawn as "' + kind + '"');
      if (html !== dir) fails.push(type + '/' + lang + ': page direction ' + html);
      if (small.length) fails.push(type + '/' + lang + ': ' + small.length + ' control(s) under 48×48 — ' + small.slice(0, 3).map((s) => s.el + ' "' + s.t + '" ' + s.w + '×' + s.h).join(', '));
      if (errs.length) fails.push(type + '/' + lang + ': console errors — ' + errs.slice(0, 2).join(' | '));
    } catch (e) {
      fails.push(type + '/' + lang + ': ' + String(e.message).split('\n')[0]);
    } finally { await ctx2.close(); }
  }
  expect(!fails.length, fails.join(' · '));
  return { examples: out };
});

add({ id: 'IT02' }, 'Order the steps by tapping, no dragging', async (page, ctx) => {
  const sent = sentAnswers(page);
  const { q } = await reach(page, ctx, 'order_ur');
  expect(await page.$$eval('.wq-place', (els) => els.length) === 4, 'not four numbered places');
  const placeText = () => page.$$eval('.wq-place span', (els) => els.map((e) => e.innerText.trim()));
  const label = (slot) => page.$eval('.wq-pool .wq-opt[data-slot="' + slot + '"] .wq-lab', (e) => e.innerText.trim());
  const L1 = await label('A'), L2 = await label('C');
  await page.click('.wq-pool .wq-opt[data-slot="A"]');
  await page.click('.wq-pool .wq-opt[data-slot="C"]');
  let pl = await placeText();
  expect(pl[0] === L1 && pl[1] === L2 && !pl[2], 'places after A then C: ' + JSON.stringify(pl));
  await page.click('.wq-place[data-i="0"]');                              // take A back
  pl = await placeText();
  expect(!pl.includes(L1) && pl.includes(L2), 'tapping a filled place did not take its step back: ' + JSON.stringify(pl));
  for (const s of ['B', 'A', 'D']) await page.click('.wq-pool .wq-opt[data-slot="' + s + '"]');
  pl = await placeText();
  const chosen = [];
  for (const t of pl) for (const s of ['A', 'B', 'C', 'D']) if (await label(s) === t) chosen.push(s);
  await page.click('#wq-check');
  const slot = await waitFor(() => sent[q.qid], 15000, 'the order was not sent within 15 s');
  expect(slot === chosen.join(','), '"Check" sent ' + slot + ', the child chose ' + chosen.join(','));
  expect(!(await page.$('.wq-pool [draggable="true"]')), 'a step is draggable');
  return { places: pl, sent: slot };
});

add({ id: 'IT03' }, 'A quick second tap on an order step always lands', async (page, ctx) => {
  // a phone: touch, a mobile viewport, real taps
  const c = await page.context().browser().newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await c.newPage();
  try {
    await reach(p, ctx, 'order_en');
    const lab = (s) => p.$eval('.wq-pool .wq-opt[data-slot="' + s + '"] .wq-lab', (e) => e.innerText.trim());
    const B = await lab('B'), A = await lab('A');
    const box = async (s) => { const r = await (await p.$('.wq-pool .wq-opt[data-slot="' + s + '"]')).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const b = await box('B'), a = await box('A');
    await p.touchscreen.tap(b.x, b.y);
    await p.touchscreen.tap(a.x, a.y);                                     // no pause
    await L.sleep(400);
    const pl = await p.$$eval('.wq-place span', (els) => els.map((e) => e.innerText.trim()));
    const scale = await p.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1));
    // touch-action is not inherited but it applies to everything inside the element that sets it: the step or any ancestor
    const ta = await p.$eval('.wq-pool .wq-opt', (e) => { for (let n = e; n; n = n.parentElement) { const t = getComputedStyle(n).touchAction; if (t !== 'auto') return t + ' (' + n.tagName.toLowerCase() + ')'; } return 'auto'; });
    expect(pl[0] === B && pl[1] === A, 'after B then A: ' + JSON.stringify(pl));
    expect(scale === 1, 'the page zoomed (scale ' + scale + ')');
    expect(/manipulation|none/.test(ta), 'the steps allow double-tap zoom (touch-action ' + ta + ')');
    return { places: pl.slice(0, 2), scale, touchAction: ta };
  } finally { await c.close(); }
});

add({ id: 'IT04' }, 'Match pairs by tapping a left item and then its partner', async (page, ctx) => {
  const sent = sentAnswers(page);
  const { q } = await reach(page, ctx, 'match_en');
  const rights = ['C', 'A', 'B'];                                           // Bird→Water, Fish→Hive, Bee→Nest: a child's own (wrong) choice
  for (let i = 0; i < 3; i++) {
    await page.click('.wq-ml[data-i="' + i + '"]');
    await page.click('.wq-mr[data-slot="' + rights[i] + '"]');
  }
  const colours = await page.evaluate(() => [...document.querySelectorAll('.wq-ml')].map((l) => ({ l: getComputedStyle(l).backgroundColor + '|' + getComputedStyle(l).borderColor })));
  const distinct = new Set(colours.map((c) => c.l)).size;
  expect(distinct === 3, 'the three pairs do not each show their own colour: ' + JSON.stringify(colours));
  const pairOf = await page.evaluate(() => [...document.querySelectorAll('.wq-mr')].map((r) => getComputedStyle(r).backgroundColor + '|' + getComputedStyle(r).borderColor));
  expect(new Set(pairOf).size === 3, 'the partners do not carry their pair\'s colour: ' + JSON.stringify(pairOf));
  await page.click('#wq-check');
  const slot = await waitFor(() => sent[q.qid], 15000, 'the match was not sent within 15 s');
  expect(slot === rights.join(','), '"Check" sent ' + slot + ', the child chose ' + rights.join(','));
  return { sent: slot, colours: distinct };
});

add({ id: 'IT05' }, 'Label the diagram', async (page, ctx) => {
  const sent = sentAnswers(page);
  const { q } = await reach(page, ctx, 'label_ur');
  const hots = await page.$$eval('.wq-hot', (els) => els.map((e) => e.getAttribute('data-slot')));
  expect(hots.join(',') === 'A,B,C', 'numbered hotspots: ' + hots.join(','));
  const said = await voiceOf(page);
  await page.click('.wq-hot[data-slot="C"]');
  const slot = await waitFor(() => sent[q.qid], 15000, 'the tap was not sent within 15 s');
  expect(slot === 'C', 'the tapped hotspot C was sent as ' + slot);
  expect(said.length >= 1, 'the voice said nothing');
  const names = ['بائیں', 'درمیان', 'دائیں'];
  expect(said.join(' ').includes('درمیان والے سیب پر ٹیپ کریں') && !said.some((s) => names.some((n) => s.trim() === n)), 'the voice said: ' + JSON.stringify(said));
  return { sent: slot, said };
});

add({ id: 'IT06' }, 'Maths is typeset, not printed as code', async (page, ctx) => {
  const out = {};
  for (const [key, want] of [['maths_en', '3 over 4'], ['maths_ur', '4 میں سے 3']]) {
    const c = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
    const p = await c.newPage();
    try {
      await reach(p, ctx, key);
      const frac = await p.$$eval('.wq-qtext math mfrac', (els) => els.map((e) => [...e.children].map((x) => x.textContent.trim())));
      expect(frac.length && frac[0].join('/') === '3/4', key + ': no stacked fraction 3 over 4 in the question: ' + JSON.stringify(frac));
      const shown = await p.$eval('.wq-qtext', (e) => e.innerText);
      expect(!/\\frac|\$/.test(shown), key + ': the question shows maths code: ' + shown);
      const said = await voiceOf(p);
      expect(said.some((s) => s.includes(want)) && !said.some((s) => /\\frac|\$/.test(s)), key + ': the voice said ' + JSON.stringify(said));
      out[key] = { said: said[0] };
    } finally { await c.close(); }
  }
  return out;
});

add({ id: 'IT07' }, 'A figure can be made bigger', async (page, ctx) => {
  await reach(page, ctx, 'figure_en');
  const vw = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const big = async () => page.$eval('.wq-zoomed', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, svg: Boolean(e.querySelector('svg, img')) }; }).catch(() => null);
  await page.click('.wq-fig .wq-figbox');                                   // the figure itself
  let z = await big();
  expect(z && z.svg && z.w >= vw.w - 1 && z.h >= vw.h - 1, 'tapping the figure did not open it full screen: ' + JSON.stringify(z));
  await page.click('.wq-zoomed');
  expect(!(await page.$('.wq-zoomed')), 'a tap did not close the full-screen figure');
  const zoom = await page.$('.wq-zoom');
  const label = zoom ? await zoom.getAttribute('aria-label') : null;
  await zoom.click();                                                       // "Make the picture bigger"
  z = await big();
  expect(z && z.w >= vw.w - 1, 'the zoom button did not open the figure full screen');
  await page.click('.wq-zoomed');
  expect(!(await page.$('.wq-zoomed')), 'a tap did not close it');
  expect(/bigger/i.test(label || ''), 'the zoom button is not "Make the picture bigger": ' + label);
  return { viewport: vw, zoomLabel: label };
});

add({ id: 'IT08' }, 'Picture options say their names', async (page, ctx) => {
  const out = {};
  for (const [key, stem, names] of [['picture_en', 'Which one is an animal?', ['Apple', 'Cat', 'Bus']], ['listen_en', 'Listen. Which one is it?', ['Apple', 'Chair', 'Pencil']]]) {
    const c = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
    const p = await c.newPage();
    try {
      await reach(p, ctx, key);
      const said = await voiceOf(p);
      const joined = said.join(' | ');
      const iStem = joined.indexOf(stem);
      const at = names.map((n) => joined.indexOf(n, iStem + stem.length));
      expect(iStem >= 0 && at.every((x, i) => x > iStem && (i === 0 || x > at[i - 1])), key + ': the voice said ' + JSON.stringify(said));
      out[key] = said;
    } finally { await c.close(); }
  }
  return out;
});

add({ id: 'IT09' }, 'Pictures on slow data', async (page, ctx) => {
  // slow data: every picture file of this quiz takes 4 s to arrive
  const seen = [];
  await page.route(/\/api\/wq\/media\//, async (route) => { seen.push({ url: route.request().url(), at: Date.now() }); await L.sleep(4000); route.continue().catch(() => {}); });
  const { qs } = await reach(page, ctx, 'slow_en');
  const onFirst = Date.now();
  const next = qs[1];
  const urls = (next.options || []).map((o) => o.img).filter(Boolean);
  expect(urls.length === 4, 'the second question carries ' + urls.length + ' picture files');
  await L.sleep(1500);
  const early = seen.filter((s) => urls.some((u) => s.url.includes(u.split('?')[0].split('/').pop())));
  expect(early.length >= 1, 'the next question\'s pictures were not fetched while the child answered question 1 (fetched: ' + seen.length + ')');
  await L.answerRight(page, qs[0]); await L.nextQ(page);
  await page.waitForSelector('.wq-ptile img', { state: 'attached', timeout: WAIT });
  const pulse = await page.$$eval('.wq-ptile img', (els) => els.map((e) => ({ ld: e.classList.contains('wq-ld'), anim: getComputedStyle(e).animationName, done: e.complete && e.naturalWidth > 0 })));
  const pending = pulse.filter((x) => !x.done);
  expect(pending.length === 0 || pending.every((x) => x.ld && x.anim && x.anim !== 'none'), 'a picture still on its way shows no loading pulse: ' + JSON.stringify(pulse));
  const tiles = await page.$$eval('.wq-ptile', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40; }));
  expect(tiles.length === 4 && tiles.every(Boolean), 'an empty tile: ' + JSON.stringify(tiles));
  return { prefetchedAfterMs: early.length ? early[0].at - onFirst : null, pulse: pending.length ? 'shown on ' + pending.length + ' tile(s)' : 'pictures had already arrived (fetched ahead)', tiles: tiles.length };
});

add({ id: 'IT10' }, 'A picture option with no word', async (page, ctx) => {
  const { q } = await reach(page, ctx, 'noword_en');
  const tiles = await page.$$eval('.wq-ptile', (els) => els.map((e) => ({ slot: e.getAttribute('data-slot'), aria: e.getAttribute('aria-label'), word: e.querySelector('.wq-pname') ? e.querySelector('.wq-pname').innerText.trim() : '' })));
  const bare = tiles.find((t) => !t.word);
  expect(bare, 'no picture without a word: ' + JSON.stringify(tiles));
  const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
  expect(SHAPES.includes(bare.aria), 'the wordless picture is labelled "' + bare.aria + '" for screen readers, not its shape\'s name');
  const said = await voiceOf(page);
  expect(said.length && !said.some((s) => SHAPES.some((sh) => new RegExp('\\b' + sh + '\\b', 'i').test(s))), 'the voice says a shape\'s name: ' + JSON.stringify(said));
  void q;
  return { tile: bare, said };
});

module.exports = { feature: 'web-quiz-item-types', spec: 'tests/features/web/web-quiz-item-types.feature', scenarios: S, before };
