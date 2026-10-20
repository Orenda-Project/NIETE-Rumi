'use strict';
/** Task 3 — skill type -> teacher heading + order, and part-label -> skill type, per language. */
const { headingFor, skillFromLabel } = require('../../../bot/shared/services/assessment/topics/headings');

describe('headingFor', () => {
  test.each([
    ['phonics', 'Phonics', 1],
    ['reading_comprehension', 'Reading', 2],
    ['pre_reading', 'Reading', 2],
    ['vocabulary_grammar', 'Vocabulary & grammar', 3],
    ['oral_communication', 'Oral communication', 4],
    ['writing', 'Writing', 5],
  ])('english %s -> %s (%i)', (skill, heading, headingOrder) => {
    expect(headingFor('english', skill)).toEqual({ heading, headingOrder });
  });

  test.each([
    ['arkaan_saazi', 'ارکان سازی', 1],
    ['qawaid', 'قواعد', 2],
    ['buland_khwani', 'بلند خوانی', 3],
    ['tafheem', 'تفہیم', 4],
    ['alfaaz_maani', 'الفاظ و معانی', 5],
    ['takhleeqi_likhai', 'تخلیقی لکھائی', 6],
  ])('urdu %s -> %s (%i)', (skill, heading, headingOrder) => {
    expect(headingFor('urdu', skill)).toEqual({ heading, headingOrder });
  });

  test('an unknown skill type fails loudly rather than inventing a heading', () => {
    expect(() => headingFor('english', 'qawaid')).toThrow(/no heading for skill type "qawaid" in english/);
    expect(() => headingFor('urdu', 'duhrai')).toThrow(/duhrai/);
  });

  test('a subject with no headings fails loudly', () => {
    expect(() => headingFor('maths', 'concrete')).toThrow(/maths/);
  });
});

describe('skillFromLabel', () => {
  test.each([
    ['ارکان سازی', 'arkaan_saazi'],
    ['قواعد کا میدان', 'qawaid'],
    ['بلند خوانی', 'buland_khwani'],
    ['تفہیم', 'tafheem'],
    ['نئے الفاظ', 'alfaaz_maani'],
    ['الفاظ و معانی', 'alfaaz_maani'],
    ['تخلیقی پروجیکٹ', 'takhleeqi_likhai'],
    ['تخیل کی تختی', 'takhleeqi_likhai'],
  ])('urdu label "%s" -> %s', (label, skill) => {
    expect(skillFromLabel('urdu', label)).toBe(skill);
  });

  test.each([
    ['Phonics', 'phonics'],
    ['Reading', 'reading_comprehension'],
    ['Grammar', 'vocabulary_grammar'],
    ['Vocabulary', 'vocabulary_grammar'],
    ['Oral', 'oral_communication'],
    ['Speaking', 'oral_communication'],
    ['Writing', 'writing'],
  ])('english label "%s" -> %s (case-insensitive)', (label, skill) => {
    expect(skillFromLabel('english', label)).toBe(skill);
    expect(skillFromLabel('english', label.toUpperCase())).toBe(skill);
  });

  test('an unrecognised or missing label gives null (the row keeps its own skill type)', () => {
    expect(skillFromLabel('urdu', 'مل کر سوچیں اور بولیں')).toBeNull();
    expect(skillFromLabel('urdu', null)).toBeNull();
    expect(skillFromLabel('maths', 'Reading')).toBeNull();
  });
});
