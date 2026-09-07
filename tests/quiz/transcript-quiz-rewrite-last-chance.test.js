'use strict';
/**
 * PROD 2026-09-07, the second quiz lost that morning. A science lesson, English
 * chosen. Attempt 1 was thrown out because the lesson was drawable and came
 * back without a picture; that left one attempt, and it came back FOUR small
 * edits from shipping:
 *
 *   q3: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most
 *   q5: Q_MISSING_WHY — "selected_because" is 39 words; 15 at most
 *   q6: Q_MISSING_WHY — "selected_because" is 33 words; 15 at most
 *   q7: MULTI_TOO_FEW_CORRECT — "correct_indices" must name at least 2 correct
 *       options; got [0]
 *
 * The targeted rewrite exists for exactly that and refused it twice over:
 *
 *   1. `MULTI_TOO_FEW_CORRECT` matched neither per-question pattern, and one
 *      unmatched complaint disqualifies the whole set — even though every
 *      MULTI_ code that names its question ("qN: MULTI_…") is one question's
 *      own JSON and nothing else's. (MULTI_SHARE and MULTI_FIRST carry no
 *      "qN:" prefix; they are properties of the set and must stay refused.)
 *   2. Four questions is over MAX_TARGETS, whose stated reason is that "more
 *      than that is a re-roll" — true inside the attempt loop, and false after
 *      the last attempt, where the alternative is no quiz at all. The merged
 *      set goes through the whole validator either way, so the floor is the
 *      same and the ceiling is a teacher with a quiz instead of an apology.
 *
 * So: the MULTI_ codes that name a question are repairable, and the LAST-CHANCE
 * rewrite may repair up to half the set. Inside the loop the ceiling does not
 * move.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'x' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({
    client: { chat: { completions: { create: (...a) => mockCreate(...a) } } },
    model,
  }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const RW = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

// Verbatim from production, quiz 056a00b4, attempt 2.
const LIVE_ERRORS = [
  'q3: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
  'q5: Q_MISSING_WHY — "selected_because" is 39 words; 15 at most',
  'q6: Q_MISSING_WHY — "selected_because" is 33 words; 15 at most',
  'q7: MULTI_TOO_FEW_CORRECT — "correct_indices" must name at least 2 correct options; got [0]',
];

describe('a MULTI_ complaint that names its question is one question to repair', () => {
  test.each([
    ['MULTI_TOO_FEW_CORRECT — "correct_indices" must name at least 2 correct options; got [0]'],
    ['MULTI_OPTION_LONG — an option on a "select all that apply" question is a checkbox label, capped at 30 characters; "Prime Factorization and Division Method" is 39'],
    ['MULTI_ALL_CORRECT — 3 of 3 options are correct; at least one must be wrong'],
    ['MULTI_INDEX_RANGE — "correct_indices" [0,4] names an option that does not exist (there are 3)'],
    ['MULTI_FEEDBACK_KEYS — "option_feedback.wrong" keys [1] must be exactly the options that are NOT correct [2]'],
    ['MULTI_STEM_CUE — do not write "select all that apply" into the stem; the quiz adds that line itself'],
    ['MULTI_OPTION_COUNT — a "select all that apply" question needs 4 or 5 options; got 3'],
    ['MULTI_MODE — "answer_mode" is "many"; the only values are "single" (or omitted) and "multi"'],
  ])('q2: %s', (err) => {
    expect(RW.rewriteTargets([`q2: ${err}`]).indices).toEqual([2]);
  });

  test('a set-level MULTI_ complaint is still refused — no small call can fix it', () => {
    expect(RW.rewriteTargets(['MULTI_SHARE — 3 questions are "select all that apply"; at most 2 may be']).indices).toEqual([]);
    expect(RW.rewriteTargets(['MULTI_FIRST — question 1 must be the easiest one-answer question']).indices).toEqual([]);
  });
});

describe('the last-chance rewrite may repair up to half the set', () => {
  test('the live rejection that killed a quiz is repairable when there is no re-roll left', () => {
    const t = RW.rewriteTargets(LIVE_ERRORS, { maxTargets: 4 });
    expect(t.indices).toEqual([3, 5, 6, 7]);
    expect(t.byIndex[7]).toHaveLength(1);
  });

  test('inside the loop the ceiling does not move — four questions is still a re-roll', () => {
    expect(RW.rewriteTargets(LIVE_ERRORS).indices).toEqual([]);
    expect(RW.MAX_TARGETS).toBe(3);
  });

  test('the ceiling is a ceiling — five of eight is refused even on the last chance', () => {
    const five = [
      'q0: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
      'q1: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
      'q2: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
      'q3: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
      'q4: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
    ];
    expect(RW.rewriteTargets(five, { maxTargets: 4 }).indices).toEqual([]);
  });

  test('a quiz-level complaint still disqualifies the set, ceiling or no ceiling', () => {
    expect(RW.rewriteTargets(['only 4/8 at/below taught level'], { maxTargets: 4 }).indices).toEqual([]);
    expect(RW.rewriteTargets([...LIVE_ERRORS, 'only 4/8 at/below taught level'], { maxTargets: 4 }).indices).toEqual([]);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// THE WHOLE PIPELINE, on this branch, mocked only at the network boundary
// (llm-client's getClientForModel). The generate service, the author prompt, the
// validator, the rewrite prompt, the merge and the store all execute for real,
// so the wiring under test — the `maxTargets` the LAST-CHANCE call passes — runs
// on the live code path rather than being asserted about in a string.
// ─────────────────────────────────────────────────────────────────────────────
describe('the pipeline ships a quiz whose last rejection touched four questions', () => {
  const QID = '55555555-5555-4555-8555-555555555555';
  const SID = '66666666-6666-4666-8666-666666666666';

  const DIGEST = {
    topic: 'Degrees of Adjective', topic_as_taught: 'Degrees of Adjective', subject: 'english',
    grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
    slos: [
      { id: 'S1', statement: 'name the three degrees of an adjective', taught_level: 'recall' },
      { id: 'S2', statement: 'compare two things with the comparative degree', taught_level: 'understand' },
      { id: 'S3', statement: 'use the superlative degree in a sentence', taught_level: 'understand' },
    ],
    key_terms: ['positive', 'comparative', 'superlative'], examples_used: ['tall, taller, tallest'],
    misconceptions_surfaced: [],
  };
  const SUMMARY = 'Today you taught the three degrees of an adjective with tall, taller and tallest, then had the class compare two pupils and then the whole row.';

  // 40 words — the live fault, Q_MISSING_WHY, three times over on one attempt.
  const TOO_LONG_WHY = 'the moment in the lesson when the class was asked to compare the two pupils standing at the front of the room and then the whole row behind them before the board was wiped and the words were written again';

  function q({ slo = 'S1', level = 'recall', question, options, why }) {
    return {
      slo_id: slo, level, question, options, correct_index: 0,
      explanation: 'The comparative compares two things and the superlative compares three or more.',
      selected_because: why || 'tall, taller, tallest written on the board',
      distractor_misconceptions: { 1: 'uses the plain form to compare', 2: 'uses the superlative for two things' },
      option_feedback: {
        correct: 'Yes — that is the form we use when we compare, just like tall, taller, tallest on the board.',
        wrong: {
          1: 'That is the plain form; when we compare two things we add -er, as in taller.',
          2: 'That form is for three or more; for two things we use the comparative, taller.',
        },
      },
    };
  }

  /** Eight questions; `longWhy` gets the over-long selected_because. */
  function eight({ longWhy = [] } = {}) {
    const why = (i) => (longWhy.includes(i) ? TOO_LONG_WHY : undefined);
    return [
      q({ question: 'Which of these is the comparative degree of "tall"?', options: ['taller', 'tallest', 'tall'], why: why(0) }),
      q({ slo: 'S2', level: 'understand', question: 'Ali is 5 feet. Sara is 6 feet. Which word describes Sara?', options: ['taller', 'tall', 'tallest'], why: why(1) }),
      q({ question: 'Which of these is the plain (positive) degree?', options: ['tall', 'taller', 'tallest'], why: why(2) }),
      q({ slo: 'S3', level: 'understand', question: 'Which word fits: "Ali is the ____ boy in the whole school."', options: ['tallest', 'taller', 'tall'], why: why(3) }),
      q({ question: 'Which word is the superlative of "small"?', options: ['smallest', 'smaller', 'small'], why: why(4) }),
      q({ slo: 'S2', level: 'understand', question: 'Two mangoes are on the table. Which word compares them?', options: ['sweeter', 'sweetest', 'sweet'], why: why(5) }),
      q({ question: 'Which ending do we add for the comparative degree?', options: ['-er', '-est', '-ing'], why: why(6) }),
      q({ slo: 'S3', level: 'understand', question: 'Which sentence uses the superlative correctly?', options: ['Sara is the fastest of all.', 'Sara is the faster of all.', 'Sara is fast of all.'], why: why(7) }),
    ];
  }

  const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } });

  function wire() {
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : {
        data: [{
          id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: DIGEST.subject,
          language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '7', step: 'author' },
        }],
      }),
      coaching_sessions: {
        data: [{
          id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en',
          created_at: '2026-09-06T05:00:00Z', analysis_data: { topic: 'x', subject: 'x' },
          users: { phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor' },
        }],
      },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [{ phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor' }] },
    });
  }

  const storedRows = () => {
    const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert');
    return ins.length ? ins[0][1] : [];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReset();
    process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
    delete process.env.QUIZ_MULTI_FLOW_ID;
    jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
    jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
    wire();
  });

  /**
   * Attempt 1 and attempt 2 both come back with FOUR over-long
   * `selected_because` fields — q3, q5, q6, q7, the live shape. Attempt 1's
   * in-loop rewrite must refuse (four is over the in-loop ceiling and a re-roll
   * is still available); the last-chance rewrite after attempt 2 must accept,
   * repair those four, and the merged set must ship eight questions.
   */
  const FOUR = [3, 5, 6, 7];

  test('the last-chance rewrite repairs four questions and the quiz ships eight', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: eight({ longWhy: FOUR }) }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: eight({ longWhy: FOUR }) }))
      .mockResolvedValueOnce(reply({
        lesson_summary: SUMMARY,
        questions: FOUR.map((i) => ({ index: i, ...eight()[i] })),
      }));

    const r = await Gen.process(QID, {});

    expect(r.failed).toBeUndefined();
    expect(storedRows()).toHaveLength(8);
    // two full attempts, then ONE small repair call — not a third re-roll
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const repair = mockCreate.mock.calls[2][0].messages[0].content;
    expect(repair).toContain('REWRITE THESE QUESTIONS: q3, q5, q6, q7');
  });

  test('the in-loop rewrite still refuses four — the repair is the LAST chance, not the first', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: eight({ longWhy: FOUR }) }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: eight({ longWhy: FOUR }) }))
      .mockResolvedValueOnce(reply({
        lesson_summary: SUMMARY,
        questions: FOUR.map((i) => ({ index: i, ...eight()[i] })),
      }));

    await Gen.process(QID, {});

    // call 1 and call 2 are both FULL author prompts; only call 3 is the repair
    const isRepair = (i) => mockCreate.mock.calls[i][0].messages[0].content.includes('REWRITE THESE QUESTIONS');
    expect(isRepair(0)).toBe(false);
    expect(isRepair(1)).toBe(false);
    expect(isRepair(2)).toBe(true);
  });
});
