/**
 * The class-quiz end screen fits a short phone (app_settings web_quiz_end_short, the answer's `end_short`, only beside
 * `end_fit`; default off): Jugnu on the end screen carries wq-jshort, which wq.css draws smaller in Urdu on a screen at
 * most 680 px tall, so the "See my card" button stays on a 360×640 phone's first screen in Urdu too. The Urdu score headline
 * keeps «۷ میں سے» and «۳ درست کیے» whole, so its one break falls after «سے». The same on the offline end screen.
 * Off (no `end_short`, or `end_short` without `end_fit`): both end screens are today's, byte for byte. The geometry is
 * checked in a real browser on the shots.
 */
const { page, flush } = require('./wq-page-harness');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const CHILD = { first: 'Zara', chip: 'c1' };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const RES = (n) => ({ score: { correct: 3, total: n }, card: {} });
// Jugnu's done line is drawn at random from the recorded set: masked, the rest must match exactly
const norm = (h) => h.replace(/(<div class="wq-say">)[\s\S]*?<\/div>/, '$1*</div>');
const NB = ' ';

async function end(lang, n, bootExtra) {
  const p = page({ lang, store: store(RES(n)), bootExtra, api: { '/finish': RES(n) } });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return norm(p.html());
}
// no internet at the end, all three answered on this phone: the offline end screen (M9-pending)
const Q3 = [1, 2, 3].map((k) => ({ qid: `q${k}`, text: `Q${k}?`, options: [{ slot: 'A', text: 'x' }, { slot: 'B', text: 'y' }], correct_slot: 'A' }));
const PLAYED = { st: 'ST1', child: CHILD, seq: 3, result: null, answers: { q1: { slot: 'A', ok: true }, q2: { slot: 'B', ok: false }, q3: { slot: 'A', ok: true } }, queue: [] };
const OFFLINE = { __offline: true };
async function offEnd(lang, bootExtra) {
  const p = page({ lang, questions: Q3, store: { wq_s_TEST: PLAYED }, bootExtra, api: { '/api/wq/answers': OFFLINE, '/api/wq/finish': OFFLINE, '/api/wq/session': OFFLINE } });
  p.wq.results(0);
  for (let k = 0; k < 8; k += 1) await flush();
  expect(p.moment()).toBe('M9-pending');
  return p.html();
}

describe('web_quiz_end_short on (beside end_fit): a smaller Jugnu on a short screen, the Urdu headline breaks after «سے»', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: Jugnu carries wq-jshort; everything else is end_fit's page`, async () => {
      const fit = await end(lang, 7, { end_fit: true });
      const on = await end(lang, 7, { end_fit: true, end_short: true });
      expect(on).toContain('<div class="wq-jug wq-big wq-jshort">');
      const back = on.replace('<div class="wq-jug wq-big wq-jshort">', '<div class="wq-jug wq-big">');
      if (lang === 'en') expect(back).toBe(fit);
      else expect(back.replace(/ /g, ' ')).toBe(fit);
    });
    test(`${lang}: the offline end screen too`, async () => {
      const on = await offEnd(lang, { end_fit: true, end_short: true });
      expect(on).toContain('<div class="wq-jug wq-big wq-jshort">');
      expect(await offEnd(lang, { end_short: true })).toBe(await offEnd(lang, {}));
    });
  }
  test('ur: «آپ نے ۷ میں سے» and «۳ درست کیے» each held whole, one plain space between them', async () => {
    const on = await end('ur', 7, { end_fit: true, end_short: true });
    const h1 = /<h1 class="wq-endh">([^<]+)<\/h1>/.exec(on)[1];
    expect(h1).toBe(['آپ', 'نے', '۷', 'میں', 'سے'].join(NB) + ' ' + ['۳', 'درست', 'کیے'].join(NB));
  });
  test('en: the headline is unchanged', async () => {
    const on = await end('en', 7, { end_fit: true, end_short: true });
    expect(on).toContain('<h1 class="wq-endh">You got 3 out of 7</h1>');
  });
  test('the stylesheet: at most 680 px tall, the Urdu end screen\'s Jugnu is 96 px and the bubble a little tighter; English untouched', () => {
    const m = /@media \(max-height:680px\)\{([^@]*\.wq-jshort[^@]*)\}\s*$/m.exec(CSS);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/html\[lang=ur\] \.wq-screen \.wq-jug\.wq-big\.wq-jshort \.wq-jimg\{width:96px;height:96px\}/);
    expect(m[1]).toMatch(/html\[lang=ur\] \.wq-screen \.wq-jug\.wq-big\.wq-jshort>\.wq-say\{margin-bottom:6px;padding-top:8px;padding-bottom:6px\}/);
    expect(m[1]).not.toMatch(/html\[lang\] /);
  });
});

describe('web_quiz_end_short off: today\'s end screens, byte for byte', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: end_short without end_fit is today's page`, async () => {
      const base = await end(lang, 7, {});
      const off = await end(lang, 7, { end_short: true });
      expect(off).toBe(base);
      expect(base).not.toMatch(/wq-jshort/);
    });
    test(`${lang}: end_fit with end_short absent or false is end_fit's page`, async () => {
      const fit = await end(lang, 7, { end_fit: true });
      const off = await end(lang, 7, { end_fit: true, end_short: false });
      expect(off).toBe(fit);
      expect(fit).not.toMatch(/wq-jshort| /);
    });
  }
});
