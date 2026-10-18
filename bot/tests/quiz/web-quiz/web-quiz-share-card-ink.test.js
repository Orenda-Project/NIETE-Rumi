'use strict';
/**
 * Urdu text on a share picture is never cut off.
 *
 * A child's share card printed «کشف» as «لشف»: the name's one-line box clips its overflow, and the ک's top stroke,
 * which overhangs the start of the line in Nastaliq, fell outside it. The class picture's own row lost the tops and
 * tails of the sharer's name the same way, and the school board its school names.
 *
 * Measured as ink, in the bot's own Chromium, on every picture a share sends, in Urdu:
 *   - the finish card (web-quiz-card-image.js): every kind and deed, with the one share's ribbon and without;
 *   - the score, invite, class and school pictures (web-quiz-art.template.js), wide and square, with the Urdu polish
 *     and without;
 *   - the class link's picture (web-quiz-class-pic.js).
 *
 *   cut:   every box that clips its overflow is photographed with only text showing, clipped and then un-clipped
 *          (its size does not change: the box is fixed by its own line). Any ink that differs is a cut letter.
 *   pill:  text on a filled ribbon or pill keeps its ink inside the coloured box (helpers/line-ink.js).
 *   lines: no two lines of one text block touch.
 *
 * The fix rides the one share (app_settings web_quiz_share_v4): a card minted with it on, and the pictures drawn
 * while it is on. With it off every picture's HTML is byte-identical to before (hashes recorded on the code before
 * the fix).
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const crypto = require('crypto');
const sharp = require('sharp');
const Card = require('../../../shared/services/quiz/web-quiz-card-image');
const ClassPic = require('../../../shared/services/quiz/web-quiz-class-pic');
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const { artInput } = require('../../../shared/services/quiz/web-quiz-art-input');
const { measureLines } = require('../helpers/line-ink');
const { renderOptOut } = require('../helpers/pdf-layout');
const { TALL_NAMES } = require('../fixtures/urdu-spacing-synthetic');

const run = renderOptOut() ? describe.skip : describe;
jest.setTimeout(900000);

const TOUCH = 0.05;
const TOPIC = 'کسریں اور گنتی کے سوال';
const SCHOOLS = ['گورنمنٹ گرلز اسکول', 'اسلام آباد ماڈل اسکول', 'گلشن کالونی اسکول'];

// ─── the pictures ───────────────────────────────────────────────────────────

function finishCards(v4) {
  const out = [];
  for (const kind of Object.keys(Card.DEEDS)) {
    for (const deed of Card.DEEDS[kind]) {
      for (const first of TALL_NAMES.slice(0, 2)) {
        const item = v4 && kind === 'video' ? { type: 'video', id: '00000000-0000-4000-8000-000000000001' } : null;
        out.push({ label: `card ${kind}/${deed} ${first}`, html: Card.renderCard({ kind, deed, lang: 'ur', first, ...(v4 ? { v4: true, item } : {}) }), w: 1200, h: 630 });
      }
    }
  }
  return out;
}

const FACTS = (first) => ({
  card: { first, animal: 'owl', correct: 8, total: 10, topic: TOPIC, cls: 'جماعت پنجم', school: SCHOOLS[0], added: 12 },
  invite: { first, correct: 8, total: 10, topic: TOPIC },
  class: {
    topic: TOPIC, cls: 'جماعت پنجم', played: 12, avgPct: 70, top: { correct: 9, total: 10 },
    rows: [{ place: 1, animal: 'owl', correct: 9, total: 10 }, { place: 2, animal: 'cat', correct: 8, total: 10, me: true, first }, { place: 3, animal: 'lion', correct: 7, total: 10 }],
  },
  school: { rows: SCHOOLS.map((name, i) => ({ rank: i + 1, name, sector: 'G-7', points: 120 - i * 10, kids: 30 - i, move: 1 - i, you: i === 1 })) },
});

function artPictures(ui) {
  const out = [];
  for (const kind of ['card', 'invite', 'class', 'school']) {
    for (const size of ['og', 'sq']) {
      for (const ur2 of [false, true]) {
        for (const first of TALL_NAMES.slice(0, 2)) {
          const f = { lang: 'ur', d: FACTS(first)[kind] };
          const input = artInput(kind, size, 'jugnu', f, { ...(ur2 ? { ur2: true } : {}), ...ui });
          const [w, h] = size === 'og' ? [1200, 630] : [1080, 1080];
          out.push({ label: `art ${kind}/${size}${ur2 ? '/ur2' : ''} ${first}`, html: renderArt(input), w, h });
        }
      }
    }
  }
  return out;
}

function classPics(ink) {
  return [
    { kind: 'quiz', lang: 'ur', label: '۳-A', topic: TOPIC },
    { kind: 'story', lang: 'ur', label: '۵-B', title: 'کنول اور گلہری کی کہانی' },
  ].map((f) => ({ label: `class link ${f.kind}`, html: ClassPic.renderClassPic(f, ink ? { ink: true } : {}), w: 1200, h: 630 }));
}

// ─── the measures ───────────────────────────────────────────────────────────

let browser;
beforeAll(async () => {
  if (renderOptOut()) return;
  const { chromium } = require('playwright-core');
  browser = await chromium.launch();
});
afterAll(async () => { if (browser) await browser.close(); });

const TEXT_ONLY = `html.__t *, html.__t *::before, html.__t *::after{color:transparent !important;background:transparent !important;
  border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;outline-color:transparent !important}
html.__t, html.__t body{background:#fff !important}
html.__t svg, html.__t img{visibility:hidden !important}
html.__t .__on, html.__t .__on *{color:#000 !important}
html.__t .__open, html.__t .__open *{overflow:visible !important}`;

async function open(p) {
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
  await page.setContent(p.html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
    await document.fonts.ready;
  });
  return page;
}

async function inkOf(page, clip) {
  const png = await page.screenshot({ clip, animations: 'disabled' });
  return sharp(png).greyscale().raw().toBuffer();
}

/** Every text box that clips (not the picture's own frame): how many pixels of its ink the clip hides. */
async function cuts(page, p) {
  const boxes = await page.evaluate(() => {
    const frame = new Set([document.documentElement, document.body, document.querySelector('.card, .art, .pic')]);
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (frame.has(el) || !/\S/.test(el.textContent)) return;
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') return;
      el.dataset.clipIx = String(out.length);
      const r = el.getBoundingClientRect();
      out.push({ ix: out.length, text: el.textContent.trim().slice(0, 30), fs: parseFloat(cs.fontSize), x: r.left, y: r.top, w: r.width, h: r.height });
    });
    return out;
  });
  await page.addStyleTag({ content: TEXT_ONLY });
  const found = [];
  for (const b of boxes) {
    const m = b.fs * 1.5;
    const x = Math.max(0, Math.floor(b.x - m));
    const y = Math.max(0, Math.floor(b.y - m));
    const clip = { x, y, width: Math.min(p.w, Math.ceil(b.x + b.w + m)) - x, height: Math.min(p.h, Math.ceil(b.y + b.h + m)) - y };
    await page.evaluate((ix) => {
      document.documentElement.classList.add('__t');
      document.querySelector(`[data-clip-ix="${ix}"]`).classList.add('__on');
    }, b.ix);
    const shut = await inkOf(page, clip);
    await page.evaluate((ix) => document.querySelector(`[data-clip-ix="${ix}"]`).classList.add('__open'), b.ix);
    const open_ = await inkOf(page, clip);
    await page.evaluate((ix) => {
      const el = document.querySelector(`[data-clip-ix="${ix}"]`);
      el.classList.remove('__on', '__open');
      document.documentElement.classList.remove('__t');
    }, b.ix);
    let px = 0;
    for (let i = 0; i < shut.length; i += 1) if (Math.abs(shut[i] - open_[i]) > 64) px += 1;
    if (px > 0) found.push(`${b.text}: ${px} px cut`);
    if (px > 0 && process.env.INK_DEBUG) {
      const dir = process.env.INK_DEBUG;
      const n = `${p.label}_${b.ix}`.replace(/[^A-Za-z0-9_-]+/g, '_');
      await sharp(shut, { raw: { width: clip.width, height: clip.height, channels: 1 } }).png().toFile(`${dir}/${n}_shut.png`);
      await sharp(open_, { raw: { width: clip.width, height: clip.height, channels: 1 } }).png().toFile(`${dir}/${n}_open.png`);
    }
  }
  return found;
}

const PILLS = '.rib, .pill, .pts, .cta';

/** Text on a filled ribbon or pill: ink outside its coloured box, in em (negative = crosses it). */
async function pillsOut(page) {
  const has = await page.evaluate((s) => document.querySelectorAll(s).length, PILLS);
  if (!has) return [];
  const m = await measureLines(page, PILLS);
  return m.filter((e) => e.selfClearTop < 0 || e.selfClearBottom < 0).map((e) => `${e.text}: top ${e.selfClearTop} / bottom ${e.selfClearBottom} em`);
}

async function linesTouch(page) {
  const m = await measureLines(page, '.deed, .sub, .head, .name, .kind');
  return m.filter((e) => e.gaps.some((g) => g < TOUCH)).map((e) => `${e.text}: gaps ${e.gaps.join(', ')}`);
}

/** Every line of text sits inside the picture, with its ink (a pill that grew must not push the last line off). */
async function offFrame(page) {
  const m = await measureLines(page, '.name, .deed, .st, .rib, .kick, .head, .sub, .pts, .cta, .crow li, .row, .pill, .kind, .brand', { boxSelector: '.card, .art, .pic' });
  return m.filter((e) => e.boxClearTop < 0 || e.boxClearBottom < 0).map((e) => `${e.text}: off the picture (top ${e.boxClearTop} / bottom ${e.boxClearBottom} em)`);
}

async function check(pictures) {
  const bad = [];
  for (const p of pictures) {
    const page = await open(p);
    try {
      const pills = await pillsOut(page);
      const touch = await linesTouch(page);
      const off = await offFrame(page);
      const cut = await cuts(page, p);
      for (const s of [...cut, ...pills, ...touch, ...off]) bad.push(`${p.label} — ${s}`);
    } finally { await page.close(); }
  }
  return bad;
}

// ─── the rows ───────────────────────────────────────────────────────────────

run('an Urdu share picture never cuts its own text', () => {
  test('the finish card with the one share: no letter cut, the ribbon\'s word inside the ribbon, no lines touching', async () => {
    expect(await check(finishCards(true))).toEqual([]);
  });

  test('the score, invite, class and school pictures with the one share: no letter cut, every pill\'s word inside it', async () => {
    expect(await check(artPictures({ ink: true }))).toEqual([]);
  });

  test('the class link\'s picture with the one share: no letter cut', async () => {
    expect(await check(classPics(true))).toEqual([]);
  });
});

describe('with the one share off, every picture is exactly as before', () => {
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  test('finish card and share pictures: HTML byte-identical to the code before the fix', () => {
    const got = {
      card: h(finishCards(false).map((p) => p.html).join('\n')),
      art: h(artPictures({}).map((p) => p.html).join('\n')),
      classPic: h(classPics(false).map((p) => p.html).join('\n')),
      input: h(JSON.stringify(artInput('card', 'og', 'jugnu', { lang: 'ur', d: {} }, null))),
    };
    expect(got).toEqual(OFF_GOLDEN);
  });
});

// Recorded on origin/sandbox 9bf205b80, before the fix.
const OFF_GOLDEN = { card: '0bd552c814eb7682', art: '22cee5b423a1598e', classPic: 'f19c99dfb374bffa', input: 'c0d04c8f2bb36982' };
