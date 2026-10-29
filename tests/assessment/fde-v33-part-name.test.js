/**
 * bd-5jmnfj.33.4 D1 — teacher note 3 lost the section name.
 *  G3 Urdu, G3 GK and G4 Urdu answer keys printed «کلاس کو بتائیں: ، مختصر جواب…» because
 *  partName stripped «معروضی» from the label «معروضی» and left ''.
 * Pure data in, data out; real section labels from the G3/G4 mid patterns and Grade 5.
 */

const { partName } = require('../../bot/shared/services/assessment/fde-part-name');
const Cover = require('../../bot/shared/services/assessment/fde-scheme-cover');

describe('partName keeps a label the strip would empty', () => {
  test('G3 Urdu section A «معروضی» stays «معروضی»', () => {
    expect(partName({ id: 'A', label_ur: 'معروضی' }, 'ur')).toBe('معروضی');
  });
  test('a bracketed lone label loses its brackets only', () => {
    expect(partName({ id: 'A', label_ur: '(معروضی)' }, 'ur')).toBe('معروضی');
  });
  test('no label falls back to the section id', () => {
    expect(partName({ id: 'B' }, 'ur')).toBe('B');
  });
  test('Grade 5 labels print as before', () => {
    expect(partName({ id: 'A', label_ur: 'حصہ الف معروضی' }, 'ur')).toBe('حصہ الف');
    expect(partName({ id: 'B', label_ur: 'حصہ ب موضوعی' }, 'ur')).toBe('حصہ ب');
    expect(partName({ id: 'A', label_ur: '(حصہ اول) معروضی' }, 'ur')).toBe('حصہ اول');
    expect(partName({ id: 'B', label_ur: '(حصہ دوم موضوعی)' }, 'ur')).toBe('حصہ دوم');
  });
  test('English is unchanged', () => {
    expect(partName({ id: 'A', label_en: 'Section A:' }, 'en')).toBe('A');
    expect(partName({ id: 'B', label_en: 'Short answers' }, 'en')).toBe('Short answers');
  });
});

describe('joinParts on the G3 Urdu sections', () => {
  const secs = [
    { id: 'A', label_ur: 'معروضی' },
    { id: 'B', label_ur: 'مختصر جواب اور قواعد' },
    { id: 'C', label_ur: 'تحریر' },
  ];
  test('names every part, no empty name and no leading «، »', () => {
    const out = Cover.joinParts(secs, 'ur');
    expect(out).toBe('معروضی، مختصر جواب اور قواعد اور تحریر');
    expect(out.startsWith('،')).toBe(false);
    expect(out).not.toMatch(/،\s*،/);
  });
  test('the single objective part reads «معروضی»', () => {
    expect(Cover.joinParts([secs[0]], 'ur')).toBe('معروضی');
  });
});
