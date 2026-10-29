/**
 * fde-g5-key-fixes-2 (bd-5jmnfj.4.58.4), required directly:
 *   G5 Urdu Q3: «مثالی» is not a meaning of تمثیلی.
 *   G5 Science Q3(b): one battery and one bulb, so the key does not pay for polarity.
 */

const { moreKeyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes-2');

const urdu = (over = {}) => ({
  slot: 'urdu.C.Q3',
  answer: 'حریص: لالچی\nتمثیلی: مثالی، علامتی\nرائج: جاری',
  scheme: { accept: ['حریص: لالچی', 'تمثیلی: مثالی', 'رائج: جاری'] },
  ...over,
});
const battery = (over = {}) => ({
  slot: 'science.C.Q3b',
  question: 'Ali has a battery and a bulb. The bulb does not light. Give 2 things he should check.',
  answer: 'Check the wires are joined. The battery is connected correctly (positive and negative terminals) and is not dead.',
  scheme: { points: [{ text: 'The battery is connected correctly (positive and negative terminals) and is not dead', marks: 2 }, { text: 'Wires joined', marks: 1 }] },
  ...over,
});

describe('urdu.C.Q3: «مثالی» removal', () => {
  test('answer line and accept entries lose «مثالی»; an emptied entry goes; other lines stay', () => {
    const notes = [];
    const out = moreKeyFixes(urdu(), notes);
    expect(out.answer.split('\n')).toEqual(['حریص: لالچی', 'تمثیلی: علامتی', 'رائج: جاری']);
    expect(out.scheme.accept).toEqual(['حریص: لالچی', 'رائج: جاری']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/urdu\.C\.Q3/);
  });

  test('an accept entry with other meanings keeps them', () => {
    const out = moreKeyFixes(urdu({ scheme: { accept: ['تمثیلی: مثالی، علامتی'] } }), []);
    expect(out.scheme.accept).toEqual(['تمثیلی: علامتی']);
  });

  test('a key without «مثالی» comes back unchanged with no note', () => {
    const q = urdu({ answer: 'تمثیلی: علامتی', scheme: { accept: ['تمثیلی: علامتی'] } });
    const notes = [];
    expect(moreKeyFixes(q, notes)).toBe(q);
    expect(notes).toEqual([]);
  });
});

describe('science.C.Q3b: battery polarity point', () => {
  test('the point and the answer keep «not dead» only; marks unchanged', () => {
    const notes = [];
    const out = moreKeyFixes(battery(), notes);
    expect(out.scheme.points[0]).toEqual({ text: 'Check the battery is not dead', marks: 2 });
    expect(out.scheme.points[1]).toEqual({ text: 'Wires joined', marks: 1 });
    expect(out.answer).toBe('Check the wires are joined. They should also check that the battery is not dead.');
    expect(notes).toHaveLength(1);
  });

  test('two batteries or a cell: polarity matters, the item is left alone', () => {
    for (const question of ['Ali has two batteries and a bulb.', 'Ali has a battery cell and a bulb.']) {
      const q = battery({ question });
      expect(moreKeyFixes(q, [])).toBe(q);
    }
  });

  test('another slot is left alone', () => {
    const q = battery({ slot: 'science.C.Q3a' });
    expect(moreKeyFixes(q, [])).toBe(q);
  });

  test('an item with no scheme does not throw', () => {
    const q = battery({ scheme: undefined });
    expect(() => moreKeyFixes(q, [])).not.toThrow();
  });
});
