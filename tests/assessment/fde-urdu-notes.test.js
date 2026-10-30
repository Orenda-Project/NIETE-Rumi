const { urduNote, BANK } = require('../../bot/shared/services/assessment/fde-urdu-notes');

describe('urduNote: an Urdu paper never prints a Latin-letter marking note', () => {
  test('Urdu text passes through untouched', () => {
    expect(urduNote('درست جواب', 'point', 'Opposites')).toBe('درست جواب');
  });
  test('an English note is swapped for the bank note of its slot type', () => {
    expect(urduNote('correct opposite word', 'point', 'Opposites')).toBe(BANK.Opposites.point[0]);
    expect(urduNote('keeping the same ending ا instead of changing to ے', 'error', 'Singular Plural')).toBe(BANK['Singular Plural'].error);
  });
  test('the second point of a two-point type takes its own note, and the last note repeats', () => {
    expect(urduNote('x', 'point', 'Picture Sentences', 1)).toBe(BANK['Picture Sentences'].point[1]);
    expect(urduNote('x', 'point', 'Picture Sentences', 5)).toBe(BANK['Picture Sentences'].point[1]);
  });
  test('an unknown slot type falls back to a generic Urdu note', () => {
    expect(urduNote('some english', 'point', 'Nope')).not.toMatch(/[A-Za-z]/);
    expect(urduNote('some english', 'error', 'Nope')).not.toMatch(/[A-Za-z]/);
  });
  test('every bank note is Latin-free', () => {
    Object.values(BANK).forEach((b) => [...b.point, b.error].forEach((n) => expect(n).not.toMatch(/[A-Za-z]/)));
  });
});

describe('urduNote keeps an Urdu note that quotes one Latin token', () => {
  test('K-2 and COVID-19 inside an Urdu sentence are left alone', () => {
    expect(urduNote('کلاس K-2 کا جواب', 'point', 'Opposites')).toBe('کلاس K-2 کا جواب');
    expect(urduNote('COVID-19 کا ذکر', 'error', 'Opposites')).toBe('COVID-19 کا ذکر');
  });

  test('a mixed note keeps its Urdu half rather than the generic note (v37r6 g2 Q9, bd-5jmnfj.4.58.9.3)', () => {
    const t = "turn 1: speaker's name (1) and a sentence that fits the plan (1) — 2 نمبر: نام اور درست جملہ؛ 1 نمبر: ان میں سے ایک؛ 0 نمبر: دونوں نہیں";
    expect(urduNote(t, 'point', 'Dialogue')).toBe('2 نمبر: نام اور درست جملہ؛ 1 نمبر: ان میں سے ایک؛ 0 نمبر: دونوں نہیں');
    expect(urduNote('correct word written correctly', 'point', 'Dialogue')).toBe('درست جواب');
  });
});
