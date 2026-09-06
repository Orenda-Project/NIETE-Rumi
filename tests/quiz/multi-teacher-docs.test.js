'use strict';
/**
 * A transcript-quiz question may now have TWO OR THREE correct options
 * ("select all that apply"), stored as a comma-joined letter set in
 * `correct_option` ("A,C") with `media.answer_mode === 'multi'`. Every
 * consumer that read `correct_option` as a single letter silently showed the
 * teacher (or the class report) the wrong thing. This file locks the fix for
 * the two documents lane C owns:
 *   - the pre-send teacher PDF (transcript-quiz-teacher.template.js)
 *   - `optionText` in the class report service (video-quiz-report.service.js)
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const VideoRender = require('../../bot/shared/services/quiz/video-quiz-render.service');
const Report = require('../../bot/shared/services/quiz/video-quiz-report.service');

// ─── the teacher PDF ───────────────────────────────────────────────────────

const MULTI_ROW = {
  external_id: 'tq:q-multi:S1:1',
  question_text: 'Which of these numbers are prime?',
  option_a: '2', option_b: '4', option_c: '3', option_d: '9',
  correct_option: 'A,C',
  media: { answer_mode: 'multi' },
  // A and C are the correct options. Their misconception text must never
  // print in the "miss" block even though an entry exists for them — only
  // the two WRONG options' text (B, D) may appear there.
  distractor_misconceptions: {
    A: 'CORRECT-A-MISCONCEPTION-MUST-NOT-APPEAR',
    B: 'even numbers past 2 are never prime',
    C: 'CORRECT-C-MISCONCEPTION-MUST-NOT-APPEAR',
    D: 'divisible by 3, so not prime',
  },
  selected_because: 'the sieve you drew on the board',
};

const SINGLE_ROW = {
  external_id: 'tq:q-single:S1:2',
  question_text: 'What is 2 + 2?',
  option_a: '4', option_b: '5', option_c: '3', correct_option: 'A',
};

const BASE = {
  topic: 'Prime numbers', teacherName: 'Rifat Noor', grade: '4', date: '5 Sep 2026',
  link: 'https://wa.me/1', digest: { slos: [] },
  language: 'en', contentLanguage: 'en',
  lessonSummary: 'You built a sieve of Eratosthenes on the board.',
};

function orderedPositions(row, correctLetters) {
  const labels = VideoRender.optionLabels(row);
  const order = VideoRender.displayOrder(row, labels);
  const correctStoredIdx = correctLetters.map((c) => 'ABCD'.indexOf(c));
  const correct = [];
  const wrong = [];
  order.forEach((stored, pos) => {
    (correctStoredIdx.includes(stored) ? correct : wrong).push(pos);
  });
  return { correct, wrong };
}

describe('the teacher PDF marks EVERY correct option on a multi-answer question', () => {
  const html = render({ ...BASE, questions: [MULTI_ROW] });
  const optDivs = [...html.matchAll(/<div class="opt( correct)? content"[^>]*>/g)].map((m) => Boolean(m[1]));
  const { correct: correctPositions, wrong: wrongPositions } = orderedPositions(MULTI_ROW, ['A', 'C']);

  test('renders all four options — proves option_d reaches the page', () => {
    expect(optDivs).toHaveLength(4);
  });

  test('both correct options (A and C) are marked correct; the two wrong ones are not', () => {
    correctPositions.forEach((p) => expect(optDivs[p]).toBe(true));
    wrongPositions.forEach((p) => expect(optDivs[p]).toBe(false));
    expect(optDivs.filter(Boolean)).toHaveLength(2);
  });

  test('neither correct option is printed in the misconception ("miss") block, even though authored text exists for it', () => {
    expect(html).not.toMatch(/CORRECT-A-MISCONCEPTION-MUST-NOT-APPEAR/);
    expect(html).not.toMatch(/CORRECT-C-MISCONCEPTION-MUST-NOT-APPEAR/);
  });

  test('both wrong options DO print their misconception text', () => {
    expect(html).toMatch(/even numbers past 2 are never prime/);
    expect(html).toMatch(/divisible by 3, so not prime/);
  });
});

describe('the "select all that apply" chip', () => {
  test('is present on a multi-answer question', () => {
    const html = render({ ...BASE, questions: [MULTI_ROW] });
    expect(html).toMatch(/Select all that apply\./);
  });

  test('is absent on a single-answer question', () => {
    const html = render({ ...BASE, questions: [SINGLE_ROW] });
    expect(html).not.toMatch(/Select all that apply/);
  });

  test('resolves in the document’s language — Urdu quiz gets the Urdu chip, not hardcoded English', () => {
    const html = render({
      ...BASE,
      language: 'ur',
      contentLanguage: 'ur',
      questions: [{ ...MULTI_ROW, question_text: 'ان میں سے کون سے نمبر مؤثر ہیں؟' }],
    });
    expect(html).toMatch(/سب درست جواب چنیں/);
    expect(html).not.toMatch(/Select all that apply/);
  });
});

// ─── optionText, exercised through the exported hardestQuestions() ─────────
// (per the brief: exercise the internal helper through the exported function
// that uses it, rather than add a second export for a one-line helper.)

describe('optionText resolves a comma-joined correct_option (class report)', () => {
  const MULTI_Q = {
    id: 'q1',
    question_text: 'Which of these numbers are prime?',
    option_a: '2', option_b: '4', option_c: '3', option_d: '9',
    correct_option: 'A,C',
  };

  beforeEach(() => { jest.clearAllMocks(); });

  test("'A,C' resolves to both option texts, joined", async () => {
    installFrom(supabase.from, {
      quiz_sessions: { data: [{ id: 's1' }], error: null },
      quiz_answers: {
        data: [{ question_id: 'q1', is_correct: false, selected_option: 'B' },
          { question_id: 'q1', is_correct: false, selected_option: 'B' }],
        error: null,
      },
      quiz_questions: { data: [MULTI_Q], error: null },
    });
    const [hardest] = await Report.hardestQuestions('sc-1');
    expect(hardest.correct_option).toBe('A,C');
    expect(hardest.correct_text).toBe('2 + 3');
  });

  test("a single letter still resolves to just that option's text (unchanged behaviour)", async () => {
    installFrom(supabase.from, {
      quiz_sessions: { data: [{ id: 's1' }], error: null },
      quiz_answers: {
        data: [{ question_id: 'q1', is_correct: false, selected_option: 'B' },
          { question_id: 'q1', is_correct: false, selected_option: 'B' }],
        error: null,
      },
      quiz_questions: { data: [{ ...MULTI_Q, correct_option: 'B' }], error: null },
    });
    const [hardest] = await Report.hardestQuestions('sc-1');
    expect(hardest.correct_text).toBe('4');
  });

  test('a missing option still resolves to null (unchanged behaviour)', async () => {
    installFrom(supabase.from, {
      quiz_sessions: { data: [{ id: 's1' }], error: null },
      quiz_answers: {
        data: [{ question_id: 'q1', is_correct: false, selected_option: 'B' },
          { question_id: 'q1', is_correct: false, selected_option: 'B' }],
        error: null,
      },
      quiz_questions: { data: [{ ...MULTI_Q, option_d: null, correct_option: 'D' }], error: null },
    });
    const [hardest] = await Report.hardestQuestions('sc-1');
    expect(hardest.correct_text).toBeNull();
  });
});
