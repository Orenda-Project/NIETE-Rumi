/**
 * Web quiz page, the scorecard of a practice round (public/wq/wq.js card()).
 * A child who already finished (on this or another phone) plays for practice;
 * the shared card must not show a score the class league does not keep. Runs
 * the page's own card() cut from the shipped file, with the DOM faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(process.env.WQ_SRC || path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  function card() {');
const END = SRC.indexOf('  /* ---------------- M11 league table');
// The page's own M4 strings (TW) and digit helper live in the M4 block.
const M4 = SRC.slice(SRC.indexOf('  var TW = ('), SRC.indexOf('  function padNext('));

function page(result, lang = 'en') {
  const out = { screens: [], shared: [] };
  const ctx = {
    LANG: lang, CODE: 'AB12CD', N: 5, Q: { topic: 'Plants' }, CLS: { label: '3-B' }, IMG: '/wq/', S: { result, child: { first: 'Danish' } },
    T: { cardPriv: 'p', shareBtn: 'Share', challenge: 'Challenge', classBtn: 'Class', praise: () => 'Well played',
      shareLine: (f, c, t) => `${f} got ${c}/${t}`, sharePlayed: (f) => `${f} played` },
    esc: (s) => String(s == null ? '' : s), ani: (a) => `[${a}]`, bar: () => '', markHtml: () => '', BR: null, dotJoin: (a, b) => `${a} · ${b}`,
    stars: (n, t) => `<stars ${n}/${t}>`, render: (h, n) => out.screens.push({ h, n }), wireBar: () => {}, ev: () => {},
    on: (sel, fn) => { out[sel] = fn; }, share: (line) => out.shared.push(line), link: (p) => p, board: () => {}, warmArt: () => {}, B: {}, pickVideo: () => {}, sset: () => {}, flushEv: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${M4}\n${SRC.slice(START, END)}\nthis.card = card;`, ctx);
  ctx.card();
  return out;
}

test('the blocks are where this test cuts them from', () => {
  expect(START).toBeGreaterThan(0);
  expect(END).toBeGreaterThan(START);
});

test('a practice card says practice, shows the kept first-try score, and shares the kept score', () => {
  const o = page({ card: { first: 'Danish', animal: 'owl', correct: 0, total: 5, stars: 0, practice: true, kept: { correct: 4, total: 5 } } });
  const h = o.screens[0].h;
  expect(h).toContain('Practice round');
  expect(h).toContain('4/5');
  o['#wq-share']();
  expect(o.shared[0]).toBe('Danish got 4/5');
});

test('a counted card is unchanged', () => {
  const o = page({ card: { first: 'Danish', animal: 'owl', correct: 4, total: 5, stars: 4 } });
  expect(o.screens[0].h).not.toContain('Practice');
  o['#wq-share']();
  expect(o.shared[0]).toBe('Danish got 4/5');
});
