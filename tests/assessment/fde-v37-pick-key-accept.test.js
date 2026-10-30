const { pickKeyText, pickKeyError } = require('../../bot/shared/services/assessment/fde-pick-key');

// v37f G5 Urdu Q2 part ب (bd-5jmnfj.4.58.9.3). The key's open rule («یا پیراگراف کا کوئی اور اسم معرفہ»)
// let a marker accept اسکول as معرفہ because the item's common error never printed. A closed list
// (loop 6c first try) refused most correct nouns and verbs (verify4 panel), so the open rule stays
// and the common error prints under the pick rows.
const scheme = {
  accept: ['اسم معرفہ: عمر، بلال یا لاہور میں سے کوئی دو'],
  common_error: 'اسکول کو اسم معرفہ لکھنا؛ پیار کو اسم صفت لکھنا',
};

describe('pick key keeps the open rule', () => {
  test('Urdu: the model words plus «یا پیراگراف کا کوئی اور …», even with an accept line', () => {
    expect(pickKeyText('اسم معرفہ', ['عمر', 'بلال'], scheme, 'ur')).toBe('عمر، بلال، یا پیراگراف کا کوئی اور اسم معرفہ');
  });
  test('English: the model words plus «or any other noun in the passage»', () => {
    expect(pickKeyText('Nouns', ['bread', 'market'], undefined, 'en')).toBe('bread, market, or any other noun in the passage');
  });
});

describe('pick key prints the item common error', () => {
  test('a scheme common error is returned for the error row', () => {
    expect(pickKeyError(scheme)).toBe(scheme.common_error);
    expect(pickKeyError({ common_error: 'Changing the form of a verb.' })).toBe('Changing the form of a verb.');
  });
  test('no scheme or no common error: no row', () => {
    expect(pickKeyError(undefined)).toBe('');
    expect(pickKeyError({ common_error: '  ' })).toBe('');
  });
});

describe('renderer wires the pick key to the scheme', () => {
  test('comprehensionRows uses pickKeyText and pickKeyError', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/assessment/assessment-paper-fde.renderer.js'), 'utf8');
    expect(src).toMatch(/pickKeyText\(/);
    expect(src).toMatch(/pickKeyError\(/);
  });
});
