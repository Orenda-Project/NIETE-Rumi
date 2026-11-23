/**
 * "Whose turn?" on the standing link (/j/<code>): the badge on a chip ("Done for tonight!", «آج شام کا کوئز ہو گیا!»,
 * and "Quiz ready") stays inside its chip at 360 px. It used to be held on one line (`.wq-cl-ready{white-space:nowrap}`),
 * so the English words were cut at the chip's edge ("Done for tonig…") and the Urdu ones ran past it. The badge now
 * wraps inside the chip, under the name; the words are the deck's, unchanged.
 *
 * Layout: the real page from the real edge router (its own head, wq.css, fonts and class-link.js) in a real browser
 * at 360 x 740; the bot is faked at the network boundary. Needs playwright-core (PWCORE=<path> or installed) and its
 * chromium; skipped without one. The shipped rule itself is checked without a browser below, so a run with no browser
 * still holds the badge to wrapping.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const postcss = require('postcss');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

const DECK = require('../../../bot/shared/config/copy.v2.json');
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.css'), 'utf8');
const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CODE = 'KZ7QW3MNPX';
const VIEW = { width: 360, height: 740 };

let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const maybe = chromium ? describe : describe.skip;

// "Whose turn?" with every badge form: done for tonight, quiz ready, and a chip with none; names as long as a child's
// first name gets on this step
const KIDS = [
  { chip: 'ch-ali', first: 'Ali', animal: 'dog', round_done: true },
  { chip: 'ch-zara', first: 'Zara', animal: 'cat', round: true },
  { chip: 'ch-muhammad', first: 'Muhammad', animal: 'owl', round_done: true },
  { chip: 'ch-sana', first: 'Sana', animal: 'bee' },
];
const KIDS_UR = [
  { chip: 'ch-ali', first: 'علی', animal: 'dog', round_done: true },
  { chip: 'ch-zara', first: 'زارا', animal: 'cat', round: true },
  { chip: 'ch-muhammad', first: 'محمد عبداللہ', animal: 'owl', round_done: true },
  { chip: 'ch-sana', first: 'ثنا', animal: 'bee' },
];

function edge({ lang, kids }) {
  const fetchImpl = async (url) => {
    const json = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
    if (url.startsWith(`${BOT}/api/internal/wq/cl/${CODE}`)) return json(200, { lang });
    if (url === `${BOT}/api/internal/wq/cl/arrive`) return json(200, { ok: true, step: 'who', s: 'st', kids, other: null });
    return json(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  return new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
}

maybe('the "Whose turn?" badge at 360 x 740, in a real browser: inside its chip, EN and UR', () => {
  let browser;
  beforeAll(async () => {
    browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  });
  afterAll(async () => { if (browser) await browser.close(); });

  async function measure(lang, kids) {
    const srv = await edge({ lang, kids });
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    try {
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${srv.address().port}/j/${CODE}`);
      await page.waitForSelector('.wq-cl-ready');
      await page.evaluate(() => document.fonts.ready);
      return await page.evaluate(() => [...document.querySelectorAll('[data-chip]')].map((chip) => {
        const c = chip.getBoundingClientRect();
        const b = chip.querySelector('.wq-cl-ready');
        const r = b && b.getBoundingClientRect();
        return {
          chip: chip.getAttribute('data-chip'),
          box: { left: c.left, right: c.right, top: c.top, bottom: c.bottom },
          badge: b ? { text: b.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollW: b.scrollWidth, clientW: b.clientWidth } : null,
          vw: document.documentElement.clientWidth,
        };
      }));
    } finally {
      await ctx.close();
      await new Promise((r) => srv.close(r));
    }
  }

  test.each([['en', KIDS], ['ur', KIDS_UR]])('%s: every badge sits wholly inside its chip, its words whole; every chip on the screen', async (lang, kids) => {
    const chips = await measure(lang, kids);
    expect(chips.map((c) => c.chip)).toEqual(kids.map((k) => k.chip));
    const words = (k) => (k.round_done ? DECK['qfix_class_link.done_tonight'][lang] : k.round ? DECK['qfix_class_link.quiz_ready'][lang] : null);
    // the words are the deck's, unchanged
    expect(chips.map((c) => c.badge && c.badge.text)).toEqual(kids.map(words));
    const px = (n) => Math.round(n);
    const off = [];
    for (const c of chips) {
      // the chip itself is on the 360 px screen
      if (c.box.left < -0.5 || c.box.right > c.vw + 0.5) off.push(`${c.chip}: chip ${px(c.box.left)}..${px(c.box.right)} on a ${c.vw} px screen`);
      if (!c.badge) continue;
      const b = c.badge;
      // the badge is inside its chip (the chip clips anything past its edge), and nothing inside the badge is cut
      if (b.left < c.box.left - 0.5 || b.right > c.box.right + 0.5 || b.bottom > c.box.bottom + 0.5) {
        off.push(`${c.chip}: badge ${px(b.left)}..${px(b.right)} (bottom ${px(b.bottom)}) in chip ${px(c.box.left)}..${px(c.box.right)} (bottom ${px(c.box.bottom)})`);
      }
      if (b.scrollW > b.clientW + 1) off.push(`${c.chip}: badge content ${b.scrollW} px in ${b.clientW} px`);
    }
    expect(off).toEqual([]);
  });
});

describe('the shipped rule (no browser): the badge may wrap inside its chip', () => {
  const rules = [];
  postcss.parse(CSS).walkRules((rule) => { if (/\.wq-cl-ready\b/.test(rule.selector)) rules.push(rule); });
  const decl = (rule, prop) => { let v = null; rule.walkDecls(prop, (d) => { v = d.value; }); return v; };

  test('no rule for the badge holds it on one line or keeps it from shrinking', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect([rule.selector, decl(rule, 'white-space')]).not.toEqual([rule.selector, 'nowrap']);
      const flex = decl(rule, 'flex');
      expect([rule.selector, flex && /^\s*\S+\s+0(\s|$)/.test(flex)]).not.toEqual([rule.selector, true]);
      expect([rule.selector, decl(rule, 'flex-shrink')]).not.toEqual([rule.selector, '0']);
    }
  });

  test('the badge is never wider than its column (max-width: 100%) and wraps like prose (white-space: normal)', () => {
    const own = rules.find((r) => r.selector.trim() === '.wq-cl-ready');
    expect(own).toBeDefined();
    expect(decl(own, 'max-width')).toBe('100%');
    expect(decl(own, 'white-space')).toBe('normal');
  });
});
