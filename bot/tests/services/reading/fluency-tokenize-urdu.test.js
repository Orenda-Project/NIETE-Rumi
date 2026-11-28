/**
 * Port of the main bot's Urdu tokenizer fix. Urdu punctuation (، ۔ ؟ ؛) sits inside
 * U+0600–06FF, so the keep-filter left it glued to the word and every correctly read
 * Urdu word before a mark became a phantom substitution error.
 */
const FluencyService = require('../../../shared/services/reading/fluency.service');

describe('FluencyService.tokenize — Urdu punctuation', () => {
  test('a comma between words splits into two clean tokens', () => {
    expect(FluencyService.tokenize('کلاس، بچہ')).toEqual(['کلاس', 'بچہ']);
  });

  test('a comma with no space still splits the words', () => {
    expect(FluencyService.tokenize('کلاس،بچہ')).toEqual(['کلاس', 'بچہ']);
  });

  test('full stop and question mark are stripped from the word', () => {
    expect(FluencyService.tokenize('وہ اسکول گیا۔ کیا تم آئے؟')).toEqual(['وہ', 'اسکول', 'گیا', 'کیا', 'تم', 'آئے']);
  });

  test('English contractions are unchanged', () => {
    expect(FluencyService.tokenize("Ali's book.")).toEqual(['alis', 'book']);
  });
});
