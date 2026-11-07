const P = require('../../../shared/services/lp-v10-card/rules-patterns');

const hit = (re, s) => { re.lastIndex = 0; return re.test(s); };

describe('rules-patterns: Unicode-aware gate patterns', () => {
  test('caps and constants', () => {
    expect(P.TOTAL).toBe(40);
    expect(P.MAX_MOVES).toBe(8);
    expect(P.CAPS.do).toBe(70);
    expect(P.PIC_KINDS).toEqual(['faces', 'steps', 'svg']);
  });
  test('PAIR: English whole words only, Urdu join is not a pair', () => {
    expect(hit(P.PAIR, 'Tell your Partner.')).toBe(true);
    expect(hit(P.PAIR, 'repair the word')).toBe(false);
    expect(hit(P.PAIR, 'حروف جوڑیں')).toBe(false);
    expect(hit(P.PAIR, 'بچے جوڑیاں بنائیں')).toBe(true);
    expect(hit(P.PAIR, 'ساتھی سے پوچھیں')).toBe(true);
  });
  test('CONTENT_PAIRS strips lesson-content pairs globally', () => {
    expect('rhyming pairs and neighbour numbers and rhyming pair'.replace(P.CONTENT_PAIRS, '').trim()).toBe('and  and');
  });
  test('ANSWERED needs a question followed by a bracketed answer at the end', () => {
    expect(hit(P.ANSWERED, 'What is 40 + 20? (60)')).toBe(true);
    expect(hit(P.ANSWERED, 'What is 40 + 20? (60).')).toBe(true);
    expect(hit(P.ANSWERED, 'What is 40 + 20?')).toBe(false);
  });
  test('CLAUSE splits on sentence marks but not a decimal point', () => {
    expect('Write 54.32 now. Then say it; done'.split(P.CLAUSE)).toEqual(['Write 54.32 now', ' Then say it', ' done']);
  });
  test('WRITE, BOARD and MARK', () => {
    expect(hit(P.WRITE, 'Write one line')).toBe(true);
    expect(hit(P.WRITE, 'rewrite')).toBe(false);
    expect(hit(P.MARK, 'rewrite it')).toBe(true);
    expect(hit(P.BOARD, 'on the board')).toBe(true);
    expect(hit(P.SLATE, 'use slates')).toBe(true);
    expect(hit(P.PENDING, 'Design Pending')).toBe(true);
    expect(hit(P.HOME, 'at home')).toBe(true);
    expect(hit(P.HOME, 'ان کے گھر')).toBe(true);
  });
});
