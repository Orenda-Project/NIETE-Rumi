/**
 * Web quiz page: the scorecard header never shows a dangling separator ("NIETE ·").
 */
const { page, flush } = require('./wq-page-harness');
const Brand = require('../../bot/shared/config/web-quiz-brand');

describe('the scorecard header', () => {
  const kid = { chip: 'c1', first: 'Zara', animal: 'owl' };
  const store = { wq_s_TEST: { st: 'st1', child: kid, answers: {}, queue: [], result: { card: { first: 'Zara', animal: 'owl', correct: 4, total: 5 } } } };
  const niete = Brand.publicBrand('niete');
  test('a class with no label shows the brand name with no dangling separator', () => {
    const p = page({ cls: { label: '', chips: [] }, store, brand: niete });
    expect(p.html()).toMatch(/<header><span class="wq-mark wq-tile" aria-hidden="true"><svg [^]*?<\/svg><\/span>NIETE<\/header>/);
  });
  test('a class with a label keeps "brand · label"', () => {
    const p = page({ store, brand: niete });
    expect(p.html()).toMatch(/<\/svg><\/span>NIETE · Class 3-B<\/header>/);
  });
  test('another brand names itself, and NIETE is nowhere on the card', () => {
    const p = page({ store, brand: Brand.publicBrand('rumi') });
    expect(p.html()).toMatch(/<span class="wq-mark wq-bare" aria-hidden="true"><svg [^]*?<\/svg><\/span>Rumi · Class 3-B<\/header>/);
    expect(p.html()).not.toMatch(/NIETE/);
  });
});

describe('the brand bar, the city and the mascot come from the brand config', () => {
  test('NIETE: the monogram tile over FOR STUDENTS, and Islamabad in the count', () => {
    const p = page({ lang: 'en', brand: Brand.publicBrand('niete'), live: { ict_today_floor: 40 } });
    expect(p.html()).toMatch(/<span class="wq-brand" aria-label="NIETE"><span class="wq-mark wq-tile"[^>]*><svg /);
    expect(p.html()).toContain('<b>NIETE</b><small>FOR STUDENTS</small>');
    expect(p.html()).toContain('40 children in Islamabad played today');
  });
  test('Rumi: the bare dots-and-smile mark, no city, no NIETE, in Urdu too', () => {
    const p = page({ lang: 'ur', brand: Brand.publicBrand('rumi'), live: { ict_today_floor: 40 } });
    expect(p.html()).toMatch(/<span class="wq-mark wq-bare"[^>]*><svg /);
    expect(p.html()).toContain('آج 40 بچوں نے کھیلا');
    expect(p.html()).not.toMatch(/NIETE|اسلام آباد/);
  });
  test('a brand that renames the mascot renames it in the copy', () => {
    const b = { ...Brand.publicBrand('rumi'), mascot: { en: 'Tara', ur: 'تارا' } };
    const p = page({ lang: 'en', brand: b, store: { wq_s_TEST: { st: 'st1', child: { chip: 'c1', first: 'Zara' }, answers: { q1: { slot: 'B', ok: false } }, queue: [], wrong: ['q1'] } } });
    p.wq.finishFirstPass();
    expect(p.html()).toContain('Fix it with Tara');
  });
});

describe('no dangling separator elsewhere', () => {
  test('the league table subtitle with no topic shows only the count', async () => {
    const p = page({ topic: '', board: { finishers_n: 3, class_avg_pct: 50, rows: [], more_n: 0 } });
    p.wq.board();
    await flush(); await flush();
    expect(p.html()).toMatch(/<p class="wq-sub">[^<·]+<\/p>/);
    expect(p.html()).not.toMatch(/<p class="wq-sub"> · /);
  });
  test('a friend row with no topic shows only the name', async () => {
    const p = page({ store: { wq_kids: [{ chip: 'c1', first: 'Zara', animal: 'owl' }] }, me: { history: [], friends_finished: [{ first: 'Omar', topic: '', correct: 3, total: 5 }] } });
    p.wq.history();
    await flush(); await flush();
    expect(p.html()).toContain('<li><span>Omar</span>');
  });
});
