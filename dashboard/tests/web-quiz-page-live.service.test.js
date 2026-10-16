/**
 * Web quiz page — "3 classmates are playing right now — join them!" on the landing (E2 live.now) and
 * how many children of the class finished today on the card (E5 card.nth; never a place). The whole shipped page
 * runs in the shared vm harness; only the boot data and fetch are faked.
 */
const { page } = require('./wq-page-harness');

describe('landing: classmates playing right now', () => {
  test('five or more: a line on the landing, EN and UR', () => {
    expect(page({ lang: 'en', live: { now: 5 } }).html()).toContain('5 classmates are playing right now — join them!');
    expect(page({ lang: 'ur', live: { now: 5 } }).html()).toContain('ابھی 5 ہم جماعت کھیل میں شامل ہیں — آپ بھی آئیں!');
  });
  // no class count under 5 on a child's page (the server sends none; an old payload still prints none)
  test.each([2, 4])('%i playing now: no line, EN and UR', (n) => {
    expect(page({ lang: 'en', live: { now: n } }).html()).not.toContain('playing right now');
    expect(page({ lang: 'ur', live: { now: n } }).html()).not.toContain('ہم جماعت کھیل میں');
  });
  test.each([1, 2, 4])('%i in the class played today: no line, EN and UR', (n) => {
    expect(page({ lang: 'en', live: { class_today: n } }).html()).not.toContain('in your class played today');
    expect(page({ lang: 'ur', live: { class_today: n } }).html()).not.toContain('نے کھیلا');
  });
  test('5 in the class played today: the line, EN and UR', () => {
    expect(page({ lang: 'en', live: { class_today: 5 } }).html()).toContain('5 in your class played today');
    expect(page({ lang: 'ur', live: { class_today: 5 } }).html()).toContain('آج آپ کی کلاس میں 5 نے کھیلا');
  });
  test('the Urdu line uses no gendered verb form (no رہے/رہی progressive)', () => {
    const line = /<p class="wq-proof">[^<]*ابھی[^<]*<\/p>/.exec(page({ lang: 'ur', live: { now: 5 } }).html())[0];
    expect(line).not.toMatch(/رہے|رہی|رہا/);
  });
  test('one (maybe the child themself) or none: no line', () => {
    expect(page({ lang: 'en', live: { now: 1 } }).html()).not.toContain('playing right now');
    expect(page({ lang: 'en', live: {} }).html()).not.toContain('playing right now');
  });
  test('grade 1 still shows it (a number, not a moving name)', () => {
    expect(page({ lang: 'en', grade: 1, live: { now: 6 } }).html()).toContain('6 classmates are playing right now');
  });
});

// The card says how many children of the class finished today (no place, no rank: a six-year-old is never told
// where they came). Every other card line is the base page's, string-equal (the golden, captured from the base code).
describe('card: how many children of the class finished today, never a place', () => {
  const fs = require('fs');
  const path = require('path');
  const GOLDEN = path.join(__dirname, 'fixtures', 'card-other-lines.golden.json');
  const cardWith = (lang, nth, grade) => {
    const p = page({ lang, ...(grade ? { grade } : {}) });
    p.wq.S.result = { score: { correct: 4, total: 5 }, card: { first: '<Name> Testwala', animal: 'cat', correct: 4, total: 5, stars: 4, ...(nth ? { nth } : {}) } };
    p.wq.card();
    return p.html();
  };
  const line = (h) => (/<p class="wq-proof wq-nth"><span>([\s\S]*?)<\/span><\/p>/.exec(h) || [])[1];
  const PLACE = /\b(first|\d+(st|nd|rd|th))\b in your class|in your class to finish|آپ کا نمبر|سب سے پہلے/;
  test('EN: one finisher → "You finished this quiz today!"; more → "N children in your class finished this quiz today."', () => {
    expect(line(cardWith('en', 1))).toBe('You finished this quiz today!');
    expect(line(cardWith('en', 6))).toBe('<bdi>6</bdi> children in your class finished this quiz today.');
    expect(line(cardWith('en', 22))).toBe('<bdi>22</bdi> children in your class finished this quiz today.');
  });
  test('UR: the count in Urdu digits, isolated; the sentence ends with «۔»', () => {
    expect(line(cardWith('ur', 1))).toBe('آج آپ نے یہ کوئز مکمل کر لیا۔');
    expect(line(cardWith('ur', 6))).toBe('آج آپ کی کلاس میں <bdi>۶</bdi> بچوں نے یہ کوئز مکمل کیا۔');
    expect(line(cardWith('ur', 12))).toBe('آج آپ کی کلاس میں <bdi>۱۲</bdi> بچوں نے یہ کوئز مکمل کیا۔');
  });
  // No class count under 5 (a "2 children finished" line tells a child exactly one classmate did): 2–4 say the
  // one-finisher line, 5 and up the count.
  test.each([2, 3, 4])('n = %i: the one-finisher line, EN + UR, no count', (n) => {
    expect(line(cardWith('en', n))).toBe('You finished this quiz today!');
    expect(line(cardWith('ur', n))).toBe('آج آپ نے یہ کوئز مکمل کر لیا۔');
  });
  test('done_today (the server\'s card under 5, no count): the one-finisher line, EN + UR', () => {
    const doneWith = (lang) => { const p = page({ lang }); p.wq.S.result = { score: { correct: 4, total: 5 }, card: { first: '<Name> Testwala', animal: 'cat', correct: 4, total: 5, stars: 4, done_today: true } }; p.wq.card(); return p.html(); };
    expect(line(doneWith('en'))).toBe('You finished this quiz today!');
    expect(line(doneWith('ur'))).toBe('آج آپ نے یہ کوئز مکمل کر لیا۔');
  });
  test('n = 5: the count, EN + UR', () => {
    expect(line(cardWith('en', 5))).toBe('<bdi>5</bdi> children in your class finished this quiz today.');
    expect(line(cardWith('ur', 5))).toBe('آج آپ کی کلاس میں <bdi>۵</bdi> بچوں نے یہ کوئز مکمل کیا۔');
  });
  test.each(['en', 'ur'])('%s: no place word on the card, any grade', (lang) => {
    for (const n of [1, 2, 3, 6, 11]) for (const g of [1, 3, 5]) expect(cardWith(lang, n, g)).not.toMatch(PLACE);
  });
  test('no count (practice, a friend, the preview): no line', () => {
    expect(cardWith('en', null)).not.toContain('wq-nth');
    expect(cardWith('ur', null)).not.toContain('wq-nth');
  });
  test('golden: every other card line is the base page\'s, string-equal (EN + UR, with and without a count)', () => {
    const strip = (h) => h.replace(/<p class="wq-proof wq-nth">[\s\S]*?<\/p>/, '');
    const now = { en6: strip(cardWith('en', 6)), ur6: strip(cardWith('ur', 6)), enNone: cardWith('en', null), urNone: cardWith('ur', null) };
    if (process.env.WRITE_CARD_GOLDEN === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
    expect(now).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
});
