/** A-into-B merge (bd-5jmnfj.33.8): an accept that is a shorter answer or a reordering is real marking guidance. */

const { acceptText } = require('../../bot/shared/services/assessment/fde-accept-line');

describe('accept line keeps real alternatives made of the key\'s words', () => {
  test('G3 Urdu Q2 iii: a shorter answer «مفت کھانا» is printed', () => {
    expect(acceptText('دونوں عیدوں پر خاندان کو مفت کھانا ملے گا۔', ['مفت کھانا'], 'ur')).toBe('مفت کھانا');
  });

  test('G4 English: «a group» under a full-sentence key is printed', () => {
    expect(acceptText('A group of children came to the beach for a cleanup.', ['a group'], 'en')).toBe('a group');
  });

  test('G3 Maths: the turned-round fact «5 x 6 = 30» is printed', () => {
    expect(acceptText('6 x 5 = 30', ['6 x 5 = 30', '5 x 6 = 30'], 'en')).toBe('5 x 6 = 30');
  });

  test('G4 Urdu Q2 ii: a reordered sentence is printed', () => {
    expect(acceptText('عطارد سورج کے سب سے قریب سیارہ ہے۔', ['سورج کے سب سے قریب عطارد ہے۔'], 'ur'))
      .toBe('سورج کے سب سے قریب عطارد ہے۔');
  });

  test('G5 Urdu Q4: the key\'s pieces without their «word:» labels are still dropped', () => {
    expect(acceptText('جھکڑ: جھ ۔ کڑ\nسانحہ: سا ۔ ن ۔ حہ', ['جھ ۔ کڑ، سا ۔ ن ۔ حہ'], 'ur')).toBe('');
  });
});

test('G5 Urdu Q5: «؛»-joined labelled items, repeated without labels, are dropped', () => {
  expect(acceptText('دامن: دا – من؛ غلاظت: غ – لا – ظت', ['دا – من، غ – لا – ظت'], 'ur')).toBe('');
});

test('G5 Urdu Q3: an accept that is one of the key\'s own items is dropped', () => {
  expect(acceptText('شاطر: چالاک؛ حریص: لالچی', ['شاطر: چالاک', 'حریص : لالچی'], 'ur')).toBe('');
});
