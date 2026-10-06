/**
 * Web quiz page — "3 classmates are playing right now — join them!" on the landing (E2 live.now) and
 * "You're the 6th in your class to finish today" on the card (E5 card.nth). The whole shipped page
 * runs in the shared vm harness; only the boot data and fetch are faked.
 */
const { page } = require('./wq-page-harness');

describe('landing: classmates playing right now', () => {
  test('two or more: a line on the landing, EN and UR', () => {
    expect(page({ lang: 'en', live: { now: 3 } }).html()).toContain('3 classmates are playing right now — join them!');
    expect(page({ lang: 'ur', live: { now: 3 } }).html()).toContain('ابھی 3 ہم جماعت کھیل رہے ہیں — شامل ہوں!');
  });
  test('one (maybe the child themself) or none: no line', () => {
    expect(page({ lang: 'en', live: { now: 1 } }).html()).not.toContain('playing right now');
    expect(page({ lang: 'en', live: {} }).html()).not.toContain('playing right now');
  });
  test('grade 1 still shows it (a number, not a moving name)', () => {
    expect(page({ lang: 'en', grade: 1, live: { now: 4 } }).html()).toContain('4 classmates are playing right now');
  });
});

describe("card: the child's place among today's class finishers", () => {
  const cardWith = (lang, nth) => {
    const p = page({ lang });
    p.wq.S.result = { score: { correct: 4, total: 5 }, card: { first: 'Sara', animal: 'cat', correct: 4, total: 5, stars: 4, ...(nth ? { nth } : {}) } };
    p.wq.card();
    return p.html();
  };
  test.each([[1, "You're the first in your class to finish today!"], [2, "You're the 2nd in your class to finish today"], [3, "You're the 3rd in your class to finish today"], [6, "You're the 6th in your class to finish today"], [11, "You're the 11th in your class to finish today"], [22, "You're the 22nd in your class to finish today"]])('EN %i', (n, line) => {
    expect(cardWith('en', n).replace(/<\/?bdi>/g, '')).toContain(line.replace("'", '&#39;'));
  });
  test('UR, neutral forms', () => {
    expect(cardWith('ur', 1)).toContain('آج آپ کی کلاس میں سب سے پہلے آپ نے مکمل کیا!');
    expect(cardWith('ur', 6)).toContain('آج آپ کی کلاس میں مکمل کرنے والوں میں آپ کا نمبر');
    expect(cardWith('ur', 6)).toMatch(/<bdi>6<\/bdi>/);
  });
  test('no place (practice, a friend, the preview): no line', () => {
    expect(cardWith('en', null)).not.toContain('in your class to finish today');
  });
});
