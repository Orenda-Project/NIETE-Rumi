/**
 * v35 supplication terms in Urdu model text (bd-5jmnfj.4.58). Fixture: the v34 G2 Topic Sentences
 * sentence 5, plus names that must not match. The service exports no testable surface for
 * _authoredReligiousOf (not in module.exports), the service test below uses the export added in v35.
 */
const R = require('../../bot/shared/services/assessment/fde-religious-terms');

const V34 = 'اللہ ہمارے وطن کو سلامت رکھے۔';
const SLOT = 'g2.urdu.q4';
const P = { key: 'urdu', sections: [{ slots: [{ slot: SLOT, type: 'Topic Sentences' }] }] };
const paperOf = (answer, slot = SLOT) => ({ unseen: { subjective: { 'Topic Sentences': [{ slot, question: 'لکھیں', answer }] } } });

describe('supplicationOf', () => {
  test('v34 sentence is flagged with the اللہ term', () => {
    const t = R.supplicationOf(V34);
    expect(t).toBeTruthy();
    expect(t.term || t).toContain('اللہ');
  });
  test('names are not flagged', () => {
    expect(R.supplicationOf('عبداللہ نے کتاب پڑھی۔')).toBeNull();
    expect(R.supplicationOf('اللہ دتہ بازار گیا۔')).toBeNull();
    expect(R.supplicationOf('ثناء اللہ سکول گیا۔')).toBeNull();
  });
  test('آمین alone is flagged', () => {
    expect(R.supplicationOf('آمین')).toBeTruthy();
  });
  test('دعا forms and Latin forms are flagged', () => {
    ['میری دعا ہے', 'وہ دعائیں مانگتے ہیں', 'الحمد للہ', 'خدا حافظ', 'Ameen', 'Inshallah', 'may Allah help', 'prayer'].forEach((s) => {
      expect(R.supplicationOf(s)).toBeTruthy();
    });
  });
  test('خدا بخش is a name, plain text is clean', () => {
    expect(R.supplicationOf('خدا بخش گھر گیا۔')).toBeNull();
    expect(R.supplicationOf('بچہ سکول جاتا ہے۔')).toBeNull();
  });
});

describe('SUPPLICATION_TERMS shape', () => {
  test('entries carry term and a unicode pattern', () => {
    expect(R.SUPPLICATION_TERMS.length).toBeGreaterThan(10);
    R.SUPPLICATION_TERMS.forEach((e) => { expect(typeof e.term).toBe('string'); expect(e.pattern).toBeTruthy(); });
  });
});

describe('supplicationShortfall', () => {
  test('flags the v34 item as an answer shortfall naming the term', () => {
    const r = R.supplicationShortfall(paperOf(V34), P);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ slot: SLOT, reason: 'answer' });
    expect(r[0].items[0]).toContain('اللہ');
  });
  test('reads scheme points and accept entries', () => {
    const ex = { unseen: { subjective: { G: [{ slot: SLOT, question: 'q', answer: 'ٹھیک', scheme: { points: [{ text: 'آمین' }] } }] } } };
    expect(R.supplicationShortfall(ex, P)).toHaveLength(1);
  });
  test('clean text gives no shortfall', () => {
    expect(R.supplicationShortfall(paperOf('عبداللہ نے کتاب پڑھی۔'), P)).toEqual([]);
  });
  test('an Islamiat paper is skipped by key', () => {
    expect(R.supplicationShortfall(paperOf(V34), { ...P, key: 'islamiat' })).toEqual([]);
  });
  test('an Islamiat slot id is skipped', () => {
    expect(R.supplicationShortfall(paperOf(V34, 'g2.islamiat.q1'), P)).toEqual([]);
  });
});

describe('service _authoredReligiousOf (Grade 3-5 path)', () => {
  const { _authoredReligiousOf } = require('../../bot/shared/services/assessment/assessment-generation.service');
  test('catches the v34 sentence as model text', () => {
    expect(_authoredReligiousOf({ answer: V34 }, '')).toBeTruthy();
  });
  test('عبداللہ does not hit', () => {
    expect(_authoredReligiousOf({ answer: 'عبداللہ نے کتاب پڑھی۔' }, '')).toBeNull();
  });
});
