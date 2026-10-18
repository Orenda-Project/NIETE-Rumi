/**
 * A reading's result opened on another phone carries the words attempted only as a coarse count
 * (bot web-quiz-read-coarse.js: >= the story's words -> all of them, >= a tenth (rounded up) -> that tenth, > 0 -> 1,
 * else 0). Every decision the reading page takes from that count must stay the same as with the raw count:
 *   - "nothing heard":  `attempted === 0` / `attempted > 0` (wq-challenge.js:1379, 1486, 1488; wq-trail.js:624)
 *   - the try card:     WQFC.unheard `n < 0.1 * len` (wq-finish-card.js:119-124), run here from the real script
 *   - read all / some:  wq-trail.js readEnd `n >= storyLen(d)` (wq-trail.js:617-635), run here from the real script
 * For each story length and every count 0..L+50, the screens drawn from the raw and the coarse count are the same.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { coarseAttempted } = require('../../bot/shared/services/quiz/web-quiz-read-coarse');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FC_SRC = fs.readFileSync(path.join(WQ, 'wq-finish-card.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(WQ, 'wq-trail.js'), 'utf8');
const SIZES = [1, 2, 5, 9, 10, 11, 19, 20, 21, 30, 70, 80, 200];

function fcAlone() {
  const ctx = { window: {}, document: {}, location: { origin: 'https://portal.example' }, navigator: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return ctx.WQFC;
}
const FC = fcAlone();

// The Trail page's end card with a small host (the page's helpers as wq-challenge.js hands them over); the screen as
// one HTML string. len: the story's tokens; cardV3: the menu's card_v3 (the try card through WQFC.unheard).
function readScreen(r, len, cardV3) {
  let screen = '';
  const ctx = {
    location: { origin: 'https://portal.example', hash: '', href: 'https://portal.example/c/tok' }, navigator: {}, URL,
    sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: () => new Promise(() => {}),
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ setAttribute() {} }), head: { appendChild() {} } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (cardV3) vm.runInContext(FC_SRC, ctx);
  vm.runInContext(TRAIL_SRC, ctx);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { data: { ct: 'CT1', ex: 'read', questions_on: true, story: { tokens: Array.from({ length: len }, (_, k) => `w${k}`) } } };
  const h = {
    L: 'en', t: { again: 'Again', later: 'Later', listening: 'Listening' }, tc: (k) => k, boot: { kid: 'k1', token: 'tok' }, S, esc,
    on: () => {}, q: () => null, show: (name, html) => { S.screen = name; screen = html; }, jug: (pose, line) => `<p class="wq-say" data-pose="${pose}">${esc(line)}</p>`,
    ev: () => {}, open() {}, refreshMenu() {}, md: () => (cardV3 ? { card_v3: true } : {}), read() {}, backLabel: () => '', qa: () => ({ open() {} }), qaButtons: () => '<button id="wqc-qa">Q</button>',
  };
  ctx.WQTRAIL.init(h).readEnd(r);
  return screen;
}

// a timer-ended reading's result as another phone gets it (no speed, no words right)
const result = (n) => ({ score: { attempted: n, stopped: false }, ended: 'timer' });

describe('the coarse count', () => {
  test('its steps, for an 80-word story', () => {
    expect([0, 1, 7, 8, 47, 79, 80, 130].map((n) => coarseAttempted(n, 80))).toEqual([0, 1, 1, 8, 8, 8, 80, 80]);
  });
  test('the story length unknown (0): only none or some', () => {
    expect([0, 1, 47, 130].map((n) => coarseAttempted(n, 0))).toEqual([0, 1, 1, 1]);
    expect([0, 1, 47].map((n) => coarseAttempted(n, undefined))).toEqual([0, 1, 1]);
  });
});

describe('every page decision is the same with the raw and the coarse count', () => {
  test.each(SIZES)('a %i-word story, counts 0..L+50', (L) => {
    for (let n = 0; n <= L + 50; n += 1) {
      const c = coarseAttempted(n, L);
      // the count never grows past what was read, and never past the story
      expect(c).toBeLessThanOrEqual(Math.min(n, L));
      // "nothing heard" (wq-challenge.js:1379 / 1486 / 1488; wq-trail.js:624)
      expect([n, c === 0, c > 0]).toEqual([n, n === 0, n > 0]);
      // the try card: under a tenth of the story's words (wq-finish-card.js:119-124, the real function)
      expect([n, FC.unheard(result(c), undefined, undefined, L)]).toEqual([n, FC.unheard(result(n), undefined, undefined, L)]);
      // read all / read some (wq-trail.js readEnd `n >= storyLen(d)`)
      expect([n, c >= L]).toEqual([n, n >= L]);
    }
  });

  test.each(SIZES)('a %i-word story: the Trail end card drawn from either count is the same screen (card_v3 off and on)', (L) => {
    for (const cardV3 of [false, true]) {
      const seen = new Set();
      for (let n = 0; n <= L + 50; n += 1) {
        const raw = readScreen(result(n), L, cardV3);
        expect([n, readScreen(result(coarseAttempted(n, L)), L, cardV3)]).toEqual([n, raw]);
        seen.add(raw);
      }
      // the table walks every card: none, (a try card under a tenth,) some, all
      expect(seen.size).toBeGreaterThanOrEqual(L > 1 ? 3 : 2);
    }
  });

  test('a page whose story has no tokens (storyLen 0) agrees with a server that could not count them (0 / 1)', () => {
    for (const n of [0, 1, 2, 47, 130]) {
      for (const cardV3 of [false, true]) expect([n, readScreen(result(coarseAttempted(n, 0)), 0, cardV3)]).toEqual([n, readScreen(result(n), 0, cardV3)]);
      expect(FC.unheard(result(coarseAttempted(n, 0)), undefined, undefined, 0)).toBe(FC.unheard(result(n), undefined, undefined, 0));
    }
  });
});
