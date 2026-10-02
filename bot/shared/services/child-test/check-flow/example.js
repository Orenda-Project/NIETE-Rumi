'use strict';

/**
 * Child test check Flow — the example a screen shows in Meta's builder and in the
 * mockups: a made-up Grade 3 child (roll 14, no name) whose marks exercise every kind of field —
 * pre-filled counts, ticked and unticked chips, an empty unsure answer, a read photo answer. It is
 * rendered through the same code the endpoint uses, so the JSON's __example__ values are real output.
 */

const ITEMS = {
  urdu: {
    story: { tokens: ['ایک', 'دن', 'علی', 'اپنے', 'والد', 'کے', 'ساتھ', 'دریا', 'گیا', 'وہاں', 'کشتی', 'تھی'] },
    questions: [
      { id: 'u3A-q1', prompt: 'علی کس کے ساتھ گیا؟' },
      { id: 'u3A-q2', prompt: 'وہاں کیا تھا؟' },
      { id: 'u3A-q3', prompt: 'علی خوش کیوں تھا؟' },
    ],
    first_sounds: [['u3A-fs1', 'مچھلی'], ['u3A-fs2', 'چاند'], ['u3A-fs3', 'بکری'], ['u3A-fs4', 'سیب'], ['u3A-fs5', 'گھر']].map(([id, word]) => ({ id, word })),
    nonwords: [['u3A-nw1', 'تامو'], ['u3A-nw2', 'نوپی'], ['u3A-nw3', 'سیکا'], ['u3A-nw4', 'بولی'], ['u3A-nw5', 'داپو']].map(([id, text]) => ({ id, text })),
    fallback: { letters: new Array(10).fill('ا'), words: new Array(10).fill('گھر') },
  },
  english: {
    story: { tokens: ['One', 'day', 'the', 'class', 'went', 'out', 'to', 'plant', 'trees'] },
    questions: [{ id: 'e3A-q1', prompt: 'What was the class planting?' }, { id: 'e3A-q2', prompt: 'Why was the teacher happy?' }],
    nonwords: ['rup', 'jeg', 'fim', 'tob', 'sab', 'lud', 'vop', 'kez'].map((text, i) => ({ id: `e3A-nw${i + 1}`, text })),
    fallback: { letters: new Array(10).fill('a'), words: new Array(10).fill('cat') },
  },
  maths: {
    numbers: [6, 13, 27, 40, 58, 71, 99, 104].map((value, i) => ({ id: `m3A-n${i + 1}`, value })),
    written: [['34 + 28', 62], ['56 + 27', 83], ['72 - 35', 37], ['6 × 4', 24]].map(([prompt, answer], i) => ({ id: `m3A-w${i + 1}`, prompt, answer })),
    word_problem: { id: 'm3A-wp', prompt_ur: 'علی کے پاس 5 آم ہیں، 4 اور ملے۔ کل کتنے؟', prompt_en: 'Ali has 5 mangoes and gets 4 more. How many now?', answer: 9 },
  },
};

const row = (id, verdict, confidence, heard = '') => ({ id, verdict, heard, confidence });

const MARKS = {
  urdu: {
    version: 'ai-marks-v1',
    block: 'urdu',
    story: {
      words_correct: 31, words_attempted: 34, seconds: 60, finished_early: false, confidence: 0.9,
      flagged: [{ idx: 4, word: 'والد', verdict: 'wrong', confidence: 0.8 }, { idx: 8, word: 'گیا', verdict: 'skipped', confidence: 0.75 }, { idx: 10, word: 'کشتی', verdict: 'wrong', confidence: 0.4 }],
    },
    fallback: null,
    questions: [row('u3A-q1', 'correct', 0.9, 'والد کے ساتھ'), row('u3A-q2', 'wrong', 0.8, 'پتھر'), row('u3A-q3', 'none', 0.4)],
    first_sounds: [row('u3A-fs1', 'correct', 0.4, 'م'), row('u3A-fs2', 'wrong', 0.4, 'ج'), row('u3A-fs3', 'correct', 0.4, 'ب'), row('u3A-fs4', 'none', 0), row('u3A-fs5', 'correct', 0.4, 'گ')],
    nonwords: [row('u3A-nw1', 'correct', 0.9), row('u3A-nw2', 'wrong', 0.8, 'نوری'), row('u3A-nw3', 'correct', 0.7), row('u3A-nw4', 'wrong', 0.5, 'بولو'), row('u3A-nw5', 'correct', 0.8)],
    maths: null,
  },
  english: {
    version: 'ai-marks-v1',
    block: 'english',
    story: { words_correct: 17, words_attempted: 21, seconds: 60, finished_early: false, confidence: 0.85, flagged: [{ idx: 3, word: 'class', verdict: 'wrong', confidence: 0.7 }, { idx: 7, word: 'plant', verdict: 'wrong', confidence: 0.9 }] },
    fallback: null,
    questions: [row('e3A-q1', 'correct', 0.95, 'trees'), row('e3A-q2', 'wrong', 0.5, 'he woke up')],
    first_sounds: [],
    nonwords: ['correct', 'wrong', 'correct', 'correct', 'wrong', 'correct', 'correct', 'none'].map((v, i) => row(`e3A-nw${i + 1}`, v, i === 7 ? 0.2 : 0.8)),
    maths: null,
  },
  maths: {
    version: 'ai-marks-v1',
    block: 'maths',
    story: null,
    fallback: null,
    questions: [],
    first_sounds: [],
    nonwords: [],
    maths: {
      numbers: ['correct', 'correct', 'wrong', 'correct', 'correct', 'wrong', 'correct', 'none'].map((v, i) => row(`m3A-n${i + 1}`, v, i === 5 ? 0.5 : 0.9)),
      quick_sums: { correct: 9, attempted: 11, seconds: 60, confidence: 0.8 },
      written: [
        { id: 'm3A-w1', read_answer: '62', verdict: 'correct', confidence: 0.9 },
        { id: 'm3A-w2', read_answer: '73', verdict: 'wrong', confidence: 0.85 },
        { id: 'm3A-w3', read_answer: '', verdict: 'unreadable', confidence: 0 },
        { id: 'm3A-w4', read_answer: '24', verdict: 'correct', confidence: 0.8 },
      ],
      word_problem: { verdict: 'correct', read_answer: '9', confidence: 0.6 },
    },
  },
};

const CHILD = { label: 'رول نمبر 14 · جماعت 3' };

module.exports = { ITEMS, MARKS, CHILD };
