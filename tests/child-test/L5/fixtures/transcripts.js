'use strict';
/**
 * Recorded-shape Soniox transcripts for the child-test scoring tests.
 * Synthetic: no real child, no names. `script` lines are [speaker, startSec, text];
 * words inside a line are spaced 0.5 s apart and each becomes Soniox-style
 * sub-word tokens (a leading-space token, then a continuation token).
 */
function tokensFrom(script, gap = 0.5) {
  const tokens = [];
  for (const [speaker, start, text] of script) {
    String(text).split(/\s+/).filter(Boolean).forEach((w, k) => {
      const s = Math.round((start + k * gap) * 1000);
      const chars = [...w];
      const cut = Math.max(1, Math.ceil(chars.length / 2));
      tokens.push({ text: ` ${chars.slice(0, cut).join('')}`, start_ms: s, end_ms: s + 200, speaker: String(speaker), language: 'ur' });
      if (chars.length > cut) tokens.push({ text: chars.slice(cut).join(''), start_ms: s + 200, end_ms: s + 400, speaker: String(speaker), language: 'ur' });
    });
  }
  return tokens;
}

// Urdu block: coach (1) cues, child (2) reads the first 20 words of the story in ~50 s with
// one substitution, then three questions, two first sounds, two made-up words.
const URDU_BLOCK = [
  [1, 1.0, 'السلام علیکم بیٹا یہ کہانی پڑھیں شروع'],
  [2, 6.0, 'آج بلال اپنے والد کے ساتھ دریا جہلم کے کنارے'],
  [2, 20.0, 'گیا وہاں ٹھنڈی ہوا چل رہی تھی اور پانی آہستہ'],
  [1, 70.0, 'بس شکریہ'],
  [1, 72.0, 'بلال کس کے ساتھ گیا'],
  [2, 75.0, 'ابو کے ساتھ'],
  [1, 78.0, 'وہاں ہوا کیسی تھی'],
  [2, 81.0, 'گرم'],
  [1, 84.0, 'پانی کیسے بہہ رہا تھا'],
  [2, 88.0, 'آہستہ آہستہ'],
  [1, 92.0, 'اب پہلی آواز بتائیں انار'],
  [2, 96.0, 'ا'],
  [1, 98.0, 'بکری'],
  [2, 100.0, 'ب'],
  [1, 104.0, 'یہ لفظ پڑھیں'],
  [2, 107.0, 'تمال سوپک'],
];

// Same block with the start cue never spoken.
const URDU_BLOCK_NO_CUE = URDU_BLOCK.map((l, i) => (i === 0 ? [1, 1.0, 'السلام علیکم بیٹا یہ کہانی پڑھیں'] : l));

// Coach prompting the child mid-minute.
const URDU_BLOCK_PROMPTING = URDU_BLOCK.slice(0, 2).concat([[1, 14.0, 'دریائے دریائے آگے پڑھو جلدی']], URDU_BLOCK.slice(2));

// Maths: numbers, then quick sums (child reads the sum and answers), then the word problem.
const MATHS_BLOCK = [
  [1, 1.0, 'یہ نمبر پڑھیں'],
  [2, 4.0, 'سینتالیس'],
  [2, 6.0, 'بارہ'],
  [2, 8.0, 'نو'],
  [2, 10.0, 'آٹھ'],
  [1, 14.0, 'اب جلدی جلدی جمع شروع'],
  [2, 17.0, 'تین جمع چار سات'],
  [2, 22.0, 'پانچ جمع دو سات'],
  [2, 27.0, 'چھ جمع تین آٹھ'],
  [2, 32.0, '6'],
  [1, 80.0, 'بس شکریہ'],
  [1, 82.0, 'سوال سنیں ایک ٹوکری میں پانچ آم ہیں چار اور ڈال دیے اب کتنے آم ہیں'],
  [2, 92.0, 'نو آم'],
];

// English block: start cue, the child reads the 12-word story with one wrong word (idx 3), then
// two questions and two made-up words.
const ENGLISH_BLOCK = [
  [1, 1.0, 'read the story please start'],
  [2, 4.0, 'imran woke up only for school today his class was planting trees'],
  [1, 20.0, 'thank you'],
  [1, 22.0, 'what was the class planting'],
  [2, 25.0, 'trees'],
  [1, 27.0, 'why did imran wake up early'],
  [2, 30.0, 'for school'],
  [1, 33.0, 'read these words'],
  [2, 35.0, 'lat mop'],
];

module.exports = { ENGLISH_BLOCK, tokensFrom, URDU_BLOCK, URDU_BLOCK_NO_CUE, URDU_BLOCK_PROMPTING, MATHS_BLOCK };
