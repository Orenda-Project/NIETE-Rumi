/**
 * The Urdu end screen of a replayed quiz fits a short phone too (web_quiz_end_short, beside end_fit; default off). A
 * replay shows a practice note under the card, and the card's own line «اسکور پہلی کوشش کا ہے۔» says the same thing,
 * which pushed the card button below a 360×640 phone's first screen. With end_short, on an Urdu page with a note (either
 * path: the name finished elsewhere, or the same phone's practice round): the card carries its first-try line as
 * wq-snote and the note as wq-pin (without «یہ باری مشق ہے», «گنا جائے گا» together), and the note's own box carries
 * wq-pban. wq.css shows wq-pin and hides wq-snote and wq-pban only at most 680 px tall; taller phones see today's card
 * and note. No new words. English, a first play, and end_short off: the page is today's, byte for byte.
 */
const fs = require('fs');
const path = require('path');
const { page, flush } = require('./wq-page-harness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const CHILD = { first: 'Zara', chip: 'c1' };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const RES = (counted, extra = {}) => ({ score: { correct: 1, total: 6 }, card: {}, ...(counted === false ? { counted: false } : {}), ...extra });
// the same phone's practice round: the finish card is on, and the round was already finished
const ROUND = { card_v3: true, reason: 'already_finished', card: { kept: { correct: 4, total: 7 } } };
const norm = (h) => h.replace(/(<div class="wq-say">)[\s\S]*?<\/div>/, '$1*</div>');
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/ /g, ' ');

async function end(lang, bootExtra, counted, { htmlClass = [], extra = {} } = {}) {
  const res = RES(counted, extra);
  const p = page({ lang, store: store(res), bootExtra, api: { '/finish': res }, htmlClass });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return norm(p.html());
}
const ON = { end_fit: true, end_short: true };
const banner = (h) => { const m = /<div class="wq-banner[^"]*">([\s\S]*?)<\/div>/.exec(h); return m ? m[1] : null; };
const pin = (h) => { const m = /<p class="wq-small wq-pin">([\s\S]*?)<\/p>/.exec(h); return m ? m[1] : null; };

describe('end_short on, Urdu, a replay: the card carries the note in place of its first-try line on a short phone', () => {
  test.each([
    ['the name finished elsewhere', {}, {}],
    ['the polished copy', { htmlClass: ['wq-ur2'] }, {}],
    ['the same phone\'s practice round', {}, ROUND],
  ])('%s: wq-snote + wq-pin in the card, wq-pban on the note, the note\'s words today\'s', async (_n, opts, extra) => {
    const today = await end('ur', { end_fit: true }, false, { ...opts, extra });
    const on = await end('ur', ON, false, { ...opts, extra });
    expect(on).toContain('<p class="wq-small wq-snote">اسکور پہلی کوشش کا ہے۔</p><p class="wq-small wq-pin">');
    expect(on).toContain('<div class="wq-banner wq-pban">');
    expect(banner(on)).toBe(banner(today));
    const p = pin(on);
    expect(p).not.toMatch(/یہ باری مشق ہے/);
    expect(strip(p).replace(/\s+/g, ' ').trim()).toBe(strip(banner(today)).replace(/یہ باری مشق ہے[۔؛] ?/, '').replace(/\s+/g, ' ').trim());
    if (strip(p).includes('گنا جائے گا')) expect(p).toContain('گنا جائے گا');
  });
  test('the stylesheet: wq-pin hidden by default; at most 680 px tall the card line and the note box hide and wq-pin shows', () => {
    expect(CSS).toMatch(/^html\[lang=ur\] \.wq-screen \.wq-small\.wq-pin\{display:none\}$/m);
    const m = /@media \(max-height:680px\)\{([^@]*\.wq-jshort[^@]*)\}\s*$/m.exec(CSS);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/html\[lang=ur\] \.wq-screen \.wq-small\.wq-snote\{display:none\}/);
    expect(m[1]).toMatch(/html\[lang=ur\] \.wq-screen \.wq-small\.wq-pin\{display:block\}/);
    expect(m[1]).toMatch(/html\[lang=ur\] \.wq-screen \.wq-banner\.wq-pban\{display:none\}/);
    expect(CSS.indexOf('.wq-small.wq-pin{display:none}')).toBeLessThan(CSS.indexOf('.wq-small.wq-pin{display:block}'));
  });
});

describe('everything else is unchanged', () => {
  test('Urdu, a first play (no note): the end_short page has none of the classes', async () => {
    expect(await end('ur', ON)).not.toMatch(/wq-snote|wq-pin|wq-pban/);
  });
  test.each([[{}], [ROUND]])('English replay with end_short %j: none of the classes', async (extra) => {
    expect(await end('en', ON, false, { extra })).not.toMatch(/wq-snote|wq-pin|wq-pban/);
  });
  test.each([['ur', {}], ['en', {}], ['ur', ROUND]])('%s replay %j, end_short off: today\'s page, byte for byte', async (lang, extra) => {
    const base = await end(lang, { end_fit: true }, false, { extra });
    const off = await end(lang, { end_fit: true, end_short: false }, false, { extra });
    expect(off).toBe(base);
    expect(base).not.toMatch(/wq-snote|wq-pin|wq-pban/);
  });
});
