'use strict';
/**
 * Scripted Soniox transcripts of the v2 maths voice note (bd-s1oo0.46.3). No real child, no names:
 * speaker 1 is the coach reading the item bank's script, speaker 2 the child. Lines are
 * [speaker, startSec, text]; tokensFrom (L5) spaces words 0.5 s apart.
 */
const { tokensFrom } = require('../L5/fixtures/transcripts');
const { wordsFromTokens } = require('../../../bot/shared/services/child-test/scoring/text-norm');

const COACH = {
  start: 'اب سوال شروع کریں',
  compare: 'ان دونوں میں سے بڑا نمبر کون سا ہے',
  sum: 'اس کا جواب بتائیں',
  next: 'اگلا',
  wp: 'اب کہانی والے دو سوال غور سے سنیں',
  wp1: 'آپ کے پاس تین بسکٹ ہیں ثنا آپ کو تین بسکٹ اور دیتی ہے اب آپ کے پاس کتنے بسکٹ ہیں',
  wp2: 'عائشہ کے پاس پندرہ سیب ہیں ان میں سے تین سیب لال ہیں باقی سب ہرے ہیں عائشہ کے پاس کتنے ہرے سیب ہیں',
  stop: 'بس شکریہ',
};

// Grade 3 Set A. Expected: oc1-oc4 correct; os1-os3 correct (os1 read aloud first); os4 none ("اگلا");
// owp1 = 6 (correct), owp2 = 10 (wrong; the answer is 12).
const G3A_MIXED = [
  [1, 0, COACH.start], [1, 2.5, COACH.compare],
  [2, 7, 'سولہ'],
  [1, 9, COACH.compare], [2, 13, 'ترانوے'],
  [2, 16, 'چھ سو اڑتیس'],
  [2, 20, '3826'],
  [1, 23, COACH.sum], [2, 26, 'چودہ جمع ایک پندرہ'],
  [2, 31, 'تیرہ'],
  [2, 35, 'اکاون'],
  [1, 45, COACH.next],
  [1, 48, COACH.wp],
  [1, 52, COACH.wp1], [2, 64, 'چھ'],
  [1, 67, COACH.wp2], [2, 81, 'دس'],
  [1, 85, COACH.stop],
];

// The child answers nothing; the coach says «اگلا» after every item, then reads both problems.
const G3A_SILENT = [
  [1, 0, COACH.start], [1, 2.5, COACH.compare],
  [1, 9, COACH.next], [1, 14, COACH.next], [1, 19, COACH.next], [1, 24, COACH.next],
  [1, 27, COACH.sum],
  [1, 32, COACH.next], [1, 37, COACH.next], [1, 42, COACH.next], [1, 47, COACH.next],
  [1, 50, COACH.wp],
  [1, 54, COACH.wp1], [1, 70, COACH.next],
  [1, 73, COACH.wp2], [1, 90, COACH.next],
  [1, 94, COACH.stop],
];

const words = (script) => wordsFromTokens(tokensFrom(script));

module.exports = { COACH, G3A_MIXED, G3A_SILENT, words, tokensFrom };
