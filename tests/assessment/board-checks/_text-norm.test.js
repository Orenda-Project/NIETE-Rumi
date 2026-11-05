const { fold, stripLabel, tokens, wordCount, str } = require('../../../bot/shared/services/assessment/board-checks/_text-norm');

describe('_text-norm', () => {
  test('fold: NFKC, lower case, Arabic marks and ي ى ك folded', () => {
    expect(fold('  ABC   Def ')).toBe('abc def');
    expect(fold('كيا')).toBe(fold('کیا'));
    expect(fold('ىك')).toBe('یک');
    expect(fold('عَلَم')).toBe(fold('علم'));
  });
  test('stripLabel removes A) (a) and Urdu letter labels', () => {
    expect(stripLabel('A) twelve')).toBe('twelve');
    expect(stripLabel('(b) 5 cm')).toBe('5 cm');
    expect(stripLabel('الف) پانچ')).toBe('پانچ');
    expect(stripLabel('plain')).toBe('plain');
  });
  test('tokens split on non letters/digits', () => {
    expect(tokens('Rs 1,80!')).toEqual(['rs', '1', '80']);
    expect(tokens('')).toEqual([]);
  });
  test('wordCount and str', () => {
    expect(wordCount('one two  three')).toBe(3);
    expect(wordCount(null)).toBe(0);
    expect(str(null)).toBe('');
    expect(str(5)).toBe('5');
    expect(str({ text: 'x' })).toBe('x');
  });
});
