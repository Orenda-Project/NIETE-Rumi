'use strict';
/**
 * The blind solve must be blind, and a word_blank picture must be the question asked.
 *
 * Production, Oct 2026: "What is the missing letter in S_Y?" went to children with
 * the options P / C / K, keyed K. Its picture was a word_blank with no pictogram,
 * so the child saw only the tiles "S _ Y" — and P (SPY) is just as right as K (SKY).
 * The blind solve ran on that quiz and recorded "clean, 8 agreed", because it was
 * handed the picture as its spec, and the spec carries `word: "SKY"`: the answer.
 *
 * A second fault rides on the same picture type: the author uses word_blank as a
 * generic "show this word" picture («تصویر میں دیے گئے لفظ 'کتاب' کے کتنے ارکان ہیں؟»
 * over «ک _ ا ب»), hiding a letter of a word the question treats as whole. 316 of 392
 * production word_blank items keyed something other than the hidden letter.
 *
 * With app_settings quiz_author_gates_v2 on:
 *   1. the solver sees the CHILD's view of a figure — the tiles with their blanks and
 *      the pictogram's name — never `word` or `blanks`;
 *   2. two options one letter apart are pointed out to the solver ("check whether BOTH
 *      answer the question"); code never rejects them on its own (cat/bat is a fair
 *      phonics distractor);
 *   3. a word_blank whose key is not the hidden letter(s) is WORD_BLANK_NOT_ASKED, a
 *      q-named complaint the existing targeted rewrite repairs.
 * With the flag off, all three are exactly today's behaviour.
 *
 * The LLM call is the only thing faked, and the fake answers from what it is SHOWN:
 * a solver that sees "SKY" picks K; one that sees "S _ Y" picks P and K.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
const mockComplete = jest.fn();
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => {
  const actual = jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-llm');
  return { ...actual, completeJson: (...a) => mockComplete(...a) };
});

const KeyVerify = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Lexical = require('../../bot/shared/services/quiz/quiz-option-lexical');

const SKY = {
  question: 'What is the missing letter in S_Y?',
  options: ['P', 'C', 'K'],
  correct_index: 2,
  figure: { type: 'word_blank', word: 'SKY', style: 'tiles', blanks: [1] },
};
const CAT = {
  question: 'Look at the picture. Which letter is missing?',
  options: ['O', 'A', 'U'],
  correct_index: 1,
  figure: { type: 'word_blank', word: 'cat', picto: 'cat', blanks: [1] },
};

/** A solver that can only answer from the prompt it is given. */
function solverFromPrompt({ prompt }) {
  const answers = [];
  const blocks = String(prompt).split(/\n(?=q\d+ \()/);
  blocks.forEach((b) => {
    const m = /^q(\d+) \(/.exec(b);
    if (!m) return;
    const shown = {};
    (/options: (.*)/.exec(b) || ['', ''])[1].split(' | ').forEach((s) => {
      const o = /^\[(\d+)\] (.*)$/.exec(s.trim());
      if (o) shown[o[2]] = Number(o[1]);
    });
    let correct = [];
    if (/S_Y/.test(b)) {
      // the spec's word gives the answer away; the tiles alone fit SPY and SKY
      correct = /SKY/.test(b) ? [shown.K] : [shown.P, shown.K];
    } else if (/missing/.test(b)) {
      correct = [shown.A];
    }
    answers.push({ index: Number(m[1]), correct, unsure: false, note: '' });
  });
  return { json: { answers }, model: 'fake/solver', costUsd: 0.001, latencyMs: 1 };
}

beforeEach(() => {
  mockComplete.mockReset();
  mockComplete.mockImplementation(async (args) => solverFromPrompt(args));
  GatesV2.resetForTests();
});

describe('the solver sees what the child sees', () => {
  test('gates on: S_Y over bare tiles is AMBIGUOUS (P and K both right) and is flagged', async () => {
    const out = await KeyVerify.verifyKeys({ questions: [SKY, CAT], language: 'en', grade: '3', subject: 'english', strictKey: true });
    const [sky, cat] = out.verdicts;
    expect(sky.verdict).toBe('ambiguous');
    expect(KeyVerify.FLAGGED.has(sky.verdict)).toBe(true);
    expect(cat.verdict).toBe('agree');
    const prompt = mockComplete.mock.calls[0][0].prompt;
    expect(prompt).not.toMatch(/SKY/);
    expect(prompt).toMatch(/S _ Y/);
    expect(prompt).toMatch(/picture of: cat/);
    expect(prompt).not.toMatch(/"blanks"/);
  });

  test('gates off: today\'s prompt, unchanged (the spec as data)', async () => {
    const out = await KeyVerify.verifyKeys({ questions: [SKY], language: 'en', strictKey: false });
    expect(out.verdicts[0].verdict).toBe('agree');
    expect(mockComplete.mock.calls[0][0].prompt).toMatch(/"word":"SKY"/);
  });

  test('a figure field that names the answer never reaches the solver', () => {
    const { childView } = require('../../bot/shared/services/quiz/quiz-figure-child-view');
    expect(childView({ type: 'pattern', items: ['circle', 'square', '?'], answer: 'circle' })).toEqual({ type: 'pattern', items: ['circle', 'square', '?'] });
    expect(childView({ type: 'word_blank', word: 'road', picto: 'road' }, { stem: 'What is the beginning sound of road?' }))
      .toEqual({ type: 'word_blank', shows: '_ o a d', picture: 'road' });
    expect(childView({ type: 'word_blank', word: 'park' }, { stem: 'Which letter is missing?' }).picture).toBe('none');
    expect(childView(null)).toBeNull();
  });
});

describe('options one letter apart are pointed out, never rejected by code', () => {
  test('the prompt names the pair in SHOWN positions when the gates are on', async () => {
    const q = { question: 'Which word names the space above us, where clouds are?', options: ['Sky', 'Spy', 'Sea'], correct_index: 0 };
    await KeyVerify.verifyKeys({ questions: [q], language: 'en', strictKey: true });
    const prompt = mockComplete.mock.calls[0][0].prompt;
    const line = /check: options \[(\d)\] and \[(\d)\] differ by one letter/.exec(prompt);
    expect(line).not.toBeNull();
    const shown = {};
    (/options: (.*)/.exec(prompt) || ['', ''])[1].split(' | ').forEach((s) => { const o = /^\[(\d+)\] (.*)$/.exec(s); if (o) shown[o[2]] = o[1]; });
    expect([line[1], line[2]].sort()).toEqual([shown.Sky, shown.Spy].sort());
  });
  test('no pair line with the gates off', async () => {
    await KeyVerify.verifyKeys({ questions: [{ question: 'x?', options: ['Sky', 'Spy', 'Sea'], correct_index: 0 }], language: 'en', strictKey: false });
    expect(mockComplete.mock.calls[0][0].prompt).not.toMatch(/differ by one letter/);
  });
});

describe('the lexical trigger (pure)', () => {
  test('edit distance one, case-folded; same-sound Urdu letters; identical after marks', () => {
    expect(Lexical.nearPairs(['Sky', 'Spy', 'Sea'])).toEqual([{ i: 0, j: 1, why: 'one_letter' }]);
    expect(Lexical.nearPairs(['cat', 'bat', 'dog'])).toEqual([{ i: 0, j: 1, why: 'one_letter' }]);
    expect(Lexical.nearPairs(['سورج', 'صورج', 'چاند'])).toEqual([{ i: 0, j: 1, why: 'same_sound' }]);
    expect(Lexical.nearPairs(['کِتاب', 'کتاب', 'قلم'])).toEqual([{ i: 0, j: 1, why: 'same_letters' }]);
    expect(Lexical.nearPairs(['Atmosphere', 'Space', 'Sky'])).toEqual([]);
    // single letters always differ by one letter: never a pair
    expect(Lexical.nearPairs(['P', 'C', 'K'])).toEqual([]);
    expect(Lexical.nearPairs(['12', '13', '21'])).toEqual([]);
  });
});

describe('a word_blank picture must be the question asked', () => {
  const DIGEST = { subject: 'urdu', slos: [{ id: 'S1', statement: 's', taught_level: 'understand' }] };
  const base = (i) => ({
    slo_id: 'S1', level: 'understand',
    question: `سوال ${i}: سبق میں اس خیال کے لیے کون سا لفظ آیا؟`,
    options: [`پہلا لفظ ${i}`, `دوسرا لفظ ${i}`, `تیسرا لفظ ${i}`],
    correct_index: 2,
    explanation: 'سبق میں تیسرا لفظ آیا۔',
    distractor_misconceptions: { 0: 'الفاظ ملا دیے', 1: 'دوسرا لفظ چنا' },
    option_feedback: { correct: 'جی، تیسرا لفظ۔', wrong: { 0: 'یہ پہلا لفظ ہے۔', 1: 'یہ دوسرا لفظ ہے۔' } },
  });
  const run = (q0, on) => validate([{ ...base(0), ...q0 }, ...[1, 2, 3, 4, 5].map(base)], {
    language: 'ur', subject: 'urdu', digest: DIGEST, nExpected: 6, authorGates: on,
  }).errors.filter((e) => /^q0: /.test(e));
  const SYLLABLES = {
    question: "تصویر میں دیے گئے لفظ 'کتاب' کے کتنے ارکان ہیں؟",
    options: ['ایک', 'دو', 'تین'], correct_index: 1,
    explanation: 'کتاب کے دو ارکان ہیں: کِ اور تاب۔',
    figure: { type: 'word_blank', word: 'کتاب', blanks: [1] },
  };
  test('a syllable question over «ک _ ا ب» is WORD_BLANK_NOT_ASKED (gates on), silent (gates off)', () => {
    expect(run(SYLLABLES, true).join(' | ')).toMatch(/WORD_BLANK_NOT_ASKED/);
    expect(run(SYLLABLES, false).join(' | ')).not.toMatch(/WORD_BLANK_NOT_ASKED/);
  });
  test('a letter question keyed to the hidden letter — or its name — passes', () => {
    const letter = {
      question: 'تصویر میں خالی جگہ پر کون سا حرف آئے گا؟',
      options: ['ک', 'ت', 'ب'], correct_index: 1,
      explanation: 'کتاب میں ک کے بعد ت آتا ہے۔',
      figure: { type: 'word_blank', word: 'کتاب', blanks: [1] },
    };
    expect(run(letter, true).join(' | ')).not.toMatch(/WORD_BLANK_NOT_ASKED/);
    expect(run({ ...letter, options: ['کاف', 'تے', 'بے'] }, true).join(' | ')).not.toMatch(/WORD_BLANK_NOT_ASKED/);
  });
  test('«کھ» keyed قاف over «ک _» is WORD_BLANK_NOT_ASKED (the hidden letter is ھ, never ق)', () => {
    const kh = {
      question: "تصویر میں کون سا حرف 'دو چشمی ہ' کے ساتھ مل کر 'کھ' بنا رہا ہے؟",
      options: ['خ', 'کاف', 'قاف'], correct_index: 2,
      explanation: 'قاف اور دو چشمی ہ مل کر کھ بناتے ہیں۔',
      figure: { type: 'word_blank', word: 'کھ', blanks: [1] },
    };
    expect(run(kh, true).join(' | ')).toMatch(/WORD_BLANK_NOT_ASKED/);
  });
  test('English: S_Y keyed K passes the code check (the solver judges SPY)', () => {
    const errs = GatesV2.questionErrors(SKY, 0);
    expect(errs.join(' | ')).not.toMatch(/WORD_BLANK_NOT_ASKED/);
    const wrong = GatesV2.questionErrors({ ...SKY, question: 'Which word names the space above us?', options: ['Sky', 'Spy', 'Sea'], correct_index: 0 }, 0);
    expect(wrong.join(' | ')).toMatch(/WORD_BLANK_NOT_ASKED/);
  });
  test('a sentence as a word_blank (19 tiny tiles on a phone) is WORD_BLANK_NOT_A_WORD', () => {
    const sentence = { ...SKY, question: 'Which letter is missing?', options: ['K', 'P', 'C'], correct_index: 0, figure: { type: 'word_blank', word: 'THE SKY IS BLUE', blanks: [5] } };
    expect(GatesV2.questionErrors(sentence, 0).join(' | ')).toMatch(/WORD_BLANK_NOT_A_WORD/);
    expect(GatesV2.questionErrors(SKY, 0).join(' | ')).not.toMatch(/WORD_BLANK_NOT_A_WORD/);
  });
});

