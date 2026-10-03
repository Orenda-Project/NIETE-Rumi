'use strict';
/**
 * bd-s1oo0.46.3 (L27) — oral maths, card part: cut the maths voice note into compare / sums / word
 * problems by the script's cue lines, then find each item's answer in card order. Pure functions over a
 * Soniox word list (the real bank, the real number grammar); nothing to mock.
 */
const bank = require('../../../bot/shared/services/child-test/item-bank');
const { findOralWindows, scoreOralCard } = require('../../../bot/shared/services/child-test/scoring/maths-oral');
const T = require('./oral-transcripts');

const oral = bank.getOral(3, 'A');
const cue = bank.cue.maths;
const card = (script, opts) => {
  const words = T.words(script);
  const cut = findOralWindows({ words, cue, oral, durationSec: 100 });
  return { cut, ...scoreOralCard({ words, cut, oral, ...opts }) };
};
const verdicts = (rows) => rows.map((r) => r.verdict);

describe('findOralWindows', () => {
  test('the card runs from the start cue to the word-problem intro; each problem is answered after its question', () => {
    const { cut } = card(T.G3A_MIXED);
    expect(cut.coachSpeaker).toBe('1');
    expect(cut.windows.card.start).toBeGreaterThanOrEqual(1.5);
    expect(cut.windows.card.end).toBeCloseTo(48, 0);
    const [w1, w2] = cut.windows.word_problems;
    expect(w1.start).toBeGreaterThan(60);           // after «… کتنے بسکٹ ہیں»
    expect(w1.end).toBeCloseTo(67, 0);              // problem 2 starts
    expect(w2.start).toBeGreaterThan(78);
    expect(w2.end).toBeCloseTo(85, 0);              // the stop cue
    expect(cut.flags).toEqual([]);
  });

  test('no start cue: the card starts at the beginning of the note and the miss is flagged', () => {
    const { cut } = card(T.G3A_MIXED.slice(1));
    expect(cut.windows.card.start).toBe(0);
    expect(cut.flags).toContain('no_cue_phrase');
  });
});

describe('scoreOralCard', () => {
  test('compare A–D and sums 1–4 in card order: right, read-aloud, and «اگلا» = no answer', () => {
    const { compare, sums } = card(T.G3A_MIXED);
    expect(compare.map((r) => r.id)).toEqual(['m3A-oc1', 'm3A-oc2', 'm3A-oc3', 'm3A-oc4']);
    expect(verdicts(compare)).toEqual(['correct', 'correct', 'correct', 'correct']);
    expect(compare.map((r) => r.heard)).toEqual(['16', '93', '638', '3826']);
    expect(verdicts(sums)).toEqual(['correct', 'correct', 'correct', 'none']);
    expect(sums[0].heard).toBe('15');                    // «چودہ جمع ایک پندرہ»: the sum read aloud, then 15
    expect(sums[3]).toMatchObject({ verdict: 'none', heard: '' });
    expect(sums[3].confidence).toBeGreaterThanOrEqual(0.8);   // the coach moved on: sure it was not answered
    for (const r of [...compare, ...sums]) expect(r.confidence).toBeGreaterThan(0);
  });

  test('the smaller number is wrong; the bigger said aloud is right even when the child reads both', () => {
    const s = [[1, 0, T.COACH.start], [1, 2.5, T.COACH.compare],
      [2, 7, 'گیارہ'],                 // A: 11 of 11/16 → wrong
      [2, 11, 'ترانوے ستتر'],           // B: reads 93 77 → the bigger (93) was said → correct
      [2, 15, 'چھ سو پچیس'],            // C: 625 of 625/638 → wrong
      [2, 19, 'دو ہزار آٹھ سو تریسٹھ'],  // D: 2863 of 3826/2863 → wrong
      [1, 30, T.COACH.wp]];
    const { compare } = card(s);
    expect(verdicts(compare)).toEqual(['wrong', 'correct', 'wrong', 'wrong']);
    expect(compare.map((r) => r.heard)).toEqual(['11', '93', '625', '2863']);
    expect(compare[1].confidence).toBeLessThan(compare[0].confidence);   // both said: less sure
  });

  test('a wrong sum keeps what was heard; a stray number from the coach («نمبر ایک») is not an answer', () => {
    const s = [[1, 0, T.COACH.start],
      [1, 3, 'نمبر ایک'], [2, 5, 'سولہ'], [2, 8, 'ترانوے'], [2, 11, '638'], [2, 14, '3826'],
      [1, 17, T.COACH.sum], [2, 20, 'سولہ'], [2, 24, 'تیرہ'], [2, 28, 'اکاون'], [2, 32, 'ایک سو بائیس'],
      [1, 40, T.COACH.wp]];
    const { compare, sums } = card(s, { coachSpeaker: null });
    expect(verdicts(compare)).toEqual(['correct', 'correct', 'correct', 'correct']);
    expect(verdicts(sums)).toEqual(['wrong', 'correct', 'correct', 'correct']);
    expect(sums[0].heard).toBe('16');
    expect(sums[3].heard).toBe('122');
  });

  test('all silent: every item is no answer, nothing is heard', () => {
    const { compare, sums } = card(T.G3A_SILENT);
    expect(verdicts([...compare, ...sums])).toEqual(Array(8).fill('none'));
    expect([...compare, ...sums].every((r) => r.heard === '')).toBe(true);
  });

  test('a note with no words at all: every item is no answer, at low confidence', () => {
    const cut = findOralWindows({ words: [], cue, oral, durationSec: 30 });
    const { compare, sums } = scoreOralCard({ words: [], cut, oral });
    expect(verdicts([...compare, ...sums])).toEqual(Array(8).fill('none'));
    expect(Math.max(...[...compare, ...sums].map((r) => r.confidence))).toBeLessThan(0.7);
  });
});

describe('what the synthetic notes taught (golive/lanes/L27/REPORT.md §4)', () => {
  test('a child\'s answer that speech-to-text gives to the coach\'s speaker is still the child\'s answer', () => {
    // o-g5A-struggling: «گیارہ» and «ترانوے» came back as speaker 1, the coach
    const s = [[1, 0, T.COACH.start], [1, 2.5, T.COACH.compare], [1, 8, 'گیارہ'],
      [1, 10, T.COACH.compare], [1, 15, 'ترانوے'], [1, 17, T.COACH.compare], [2, 22, 'چھ سو اڑتیس'],
      [1, 26, T.COACH.compare], [2, 31, '3826'], [1, 35, T.COACH.wp]];
    const { compare } = card(s);
    expect(verdicts(compare)).toEqual(['wrong', 'correct', 'correct', 'correct']);
  });

  test('the coach echoing the child\'s answer is one answer, not two', () => {
    const s = [[1, 0, T.COACH.start], [1, 2.5, T.COACH.compare], [2, 7, 'سولہ'], [1, 8.5, 'سولہ'],
      [1, 10, T.COACH.compare], [2, 14, 'ترانوے'], [1, 16, T.COACH.compare], [2, 20, '638'], [1, 22, T.COACH.compare], [2, 26, '3826'],
      [1, 29, T.COACH.sum], [2, 32, 'پندرہ'], [1, 33.5, 'پندرہ'], [2, 37, 'تیرہ'], [2, 41, 'اکاون'], [2, 45, '122'], [1, 50, T.COACH.wp]];
    const { compare, sums } = card(s);
    expect(verdicts([...compare, ...sums])).toEqual(Array(8).fill('correct'));
  });

  test('a lost answer does not drag the next item\'s numbers onto it', () => {
    // o-g3B-average: the child's «اٹھارہ» for A was not transcribed; B was read as «69، 84»
    const o = bank.getOral(3, 'B');
    const s = [[1, 0, T.COACH.start], [1, 2.5, T.COACH.compare], [1, 9, T.COACH.compare], [2, 14, 'انہتر چوراسی'],
      [1, 16, T.COACH.compare], [2, 21, '547'], [1, 24, T.COACH.compare], [2, 28, '5913'], [1, 31, T.COACH.wp]];
    const words = T.words(s);
    const cut = findOralWindows({ words, cue, oral: o, durationSec: 40 });
    const { compare } = scoreOralCard({ words, cut, oral: o });
    expect(compare[0]).toMatchObject({ verdict: 'none' });
    expect(compare[1]).toMatchObject({ verdict: 'correct', heard: '84' });
    expect(verdicts(compare.slice(2))).toEqual(['wrong', 'correct']);
  });

  test('a wrong answer that is a known speech-to-text confusion of the right one («سات» → 60) is left for the coach', () => {
    const { confusable, CONF } = require('../../../bot/shared/services/child-test/scoring/maths-oral');
    expect(confusable(60, 7)).toBe(true);
    expect(confusable(70, 17)).toBe(true);
    expect(confusable(12, 7)).toBe(false);
    const s = [[1, 0, T.COACH.start], [1, 2.5, T.COACH.compare], [2, 7, 'سولہ'], [2, 10, 'ترانوے'], [2, 13, '638'], [2, 16, '3826'],
      [1, 20, T.COACH.sum], [2, 23, 'پندرہ'], [2, 26, 'تیرہ'], [2, 29, 'اکاون'], [2, 32, '622'], [1, 40, T.COACH.wp]];
    const { sums } = card(s);
    expect(sums[3]).toMatchObject({ verdict: 'wrong', heard: '622' });      // 122 heard as 622: also a confusion (ایک سو / چھ سو)
    expect(sums[3].confidence).toBeLessThan(CONF.sumWrong);
  });
});

test('counting up to an answer is recognised (its confidence is capped for the coach to check)', () => {
  const { countedTo } = require('../../../bot/shared/services/child-test/scoring/maths-oral');
  expect(countedTo([3, 4, 5, 6])).toBe(true);
  expect(countedTo([6])).toBe(false);
  expect(countedTo([12, 5, 6])).toBe(false);
});
