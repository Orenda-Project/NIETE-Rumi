'use strict';
/**
 * PROD 2026-09-07, 06:21:05Z — the fourth quiz lost that day, and the first one
 * lost AFTER the language restatement, the widened authoring budget and the
 * in-place teacher-field repair were all live on production. A maths lesson,
 * English chosen:
 *
 *   attempt 1  drawable lesson came back without a picture      (re-rolled)
 *   attempt 2  q2: stem >200 code points, q3: stem >200 code points
 *   attempt 3  q3: stem >200 code points
 *   failed     validator_failed
 *
 * The last attempt was ONE over-long stem away from shipping, on ONE question,
 * and the targeted rewrite refused it: `PER_QUESTION_STRUCTURAL` matched
 * `option >72 code points` but never `stem >200 code points`, though the
 * validator writes the two on adjacent lines
 * (transcript-quiz-validator.js:218-219) and a stem is the same thing — one
 * question's own text, over a cap, the cheapest repair there is. The module's
 * own comment already made that argument for the option cap after an identical
 * death on 2026-09-06; the stem cap was simply left out of it.
 *
 * `STRUCTURAL_CAPS_RULE`, the instruction the repair prompt carries, only told
 * the model about the option cap and the selected_because word count, so it is
 * told about the stem cap too.
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
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const RW = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

describe('an over-long stem is one question to repair, exactly like an over-long option', () => {
  test('the live rejection that killed a quiz names its question', () => {
    const t = RW.rewriteTargets(['q3: stem >200 code points']);
    expect(t.indices).toEqual([3]);
    expect(t.byIndex[3]).toEqual(['q3: stem >200 code points']);
  });

  test('two over-long stems are two questions, not a re-roll', () => {
    expect(RW.rewriteTargets(['q2: stem >200 code points', 'q3: stem >200 code points']).indices).toEqual([2, 3]);
  });

  test('a stem and an option over the cap on one question are one target', () => {
    const t = RW.rewriteTargets(['q3: stem >200 code points', 'q3: option >72 code points']);
    expect(t.indices).toEqual([3]);
    expect(t.byIndex[3]).toHaveLength(2);
  });

  test('the cap the validator actually enforces is the one the pattern matches', () => {
    const { STEM_MAX, OPTION_MAX } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
    if (STEM_MAX) expect(RW.rewriteTargets([`q0: stem >${STEM_MAX} code points`]).indices).toEqual([0]);
    if (OPTION_MAX) expect(RW.rewriteTargets([`q0: option >${OPTION_MAX} code points`]).indices).toEqual([0]);
  });

  // SUPERSEDED 2026-09-07 by the general rule (PR #758). This suite's own fix —
  // adding the stem's code to the repairable allow-list — was the third
  // one-code extension in a morning, and the fourth teacher had already lost a
  // quiz to a code that was not on the list. A malformed question is now
  // repairable like any other complaint that names a question: the safety the
  // assertion below was protecting is still there, but it is carried by the CAP
  // (a broadly malformed reply complains about more than five questions and
  // falls back to a full attempt) and by the fact that every repaired set is
  // re-validated in full, so a malformed repair cannot ship.
  test('a malformed question is repaired like any other, and the CAP is what forces a re-roll', () => {
    expect(RW.rewriteTargets(['q0: empty stem']).indices).toEqual([0]);
    expect(RW.rewriteTargets(['q0: 2 options']).indices).toEqual([0]);
    expect(RW.rewriteTargets([0, 1, 2, 3, 4, 5].map((i) => `q${i}: empty stem`)).indices).toEqual([]);
  });

  test('the repair prompt tells the model about the stem cap, not only the option cap', () => {
    const p = RW.buildRewritePrompt({
      digest: { subject: 'maths', grade_band: '3-5', slos: [{ id: 'S1', statement: 'multiply', taught_level: 'recall' }] },
      language: 'en',
      questions: Array.from({ length: 8 }, (_, i) => ({
        slo_id: 'S1', level: 'recall', question: `q${i}`, options: ['a', 'b', 'c'], correct_index: 0,
      })),
      targets: RW.rewriteTargets(['q3: stem >200 code points']),
      gradeBand: '3-5',
    });
    expect(p).toMatch(/stem/i);
    expect(p).toMatch(/200/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// The whole pipeline on this branch, mocked only at the network boundary, so
// the changed pattern runs where production runs it.
// ─────────────────────────────────────────────────────────────────────────────
describe('the pipeline ships the quiz that a single over-long stem killed', () => {
  const QID = '77777777-7777-4777-8777-777777777777';
  const SID = '88888888-8888-4888-8888-888888888888';
  const DIGEST = {
    topic: 'Fraction Word Problems', topic_as_taught: 'Fraction Word Problems', subject: 'maths',
    grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
    slos: [
      { id: 'S1', statement: 'read a fraction word problem', taught_level: 'recall' },
      { id: 'S2', statement: 'solve a two-step fraction problem', taught_level: 'understand' },
    ],
    key_terms: ['numerator', 'denominator'], examples_used: ['half a roti'], misconceptions_surfaced: [],
  };
  const SUMMARY = 'Today you worked through fraction word problems, starting with half a roti and then two-step problems on the board.';
  // 200 is the validator's stem cap; this is comfortably past it.
  const LONG_STEM = `A shopkeeper had ${'a very large number of mangoes in his cart and '.repeat(4)}he sold some of them in the morning and some more in the afternoon, so which fraction of the mangoes is left at the end of the day?`;

  function q({ slo = 'S1', level = 'recall', question, options }) {
    return {
      slo_id: slo, level, question, options, correct_index: 0,
      explanation: 'You add the two parts and take them away from the whole.',
      selected_because: 'the half roti drawn on the board',
      distractor_misconceptions: { 1: 'adds the denominators', 2: 'forgets the second step' },
      option_feedback: {
        correct: 'Yes — you add the two parts first, then take them from the whole, like the roti.',
        wrong: {
          1: 'Adding the bottom numbers changes the size of the pieces; keep the denominator.',
          2: 'That is only the first step; the problem asks for what is left after both.',
        },
      },
    };
  }

  /** Eight questions; the indices in `long` get the over-cap stem. */
  function eight({ long = [] } = {}) {
    const stem = (i, text) => (long.includes(i) ? LONG_STEM : text);
    return [
      q({ question: stem(0, 'Which of these is a fraction?'), options: ['1/2', '2', '+'] }),
      q({ slo: 'S2', level: 'understand', question: stem(1, 'You eat 1/4 of a roti. What is left?'), options: ['3/4', '1/4', '4/4'] }),
      q({ question: stem(2, 'What is the bottom number of a fraction called?'), options: ['denominator', 'numerator', 'sum'] }),
      q({ slo: 'S2', level: 'understand', question: stem(3, 'Ali ate 1/3 and Sara ate 1/3. How much is gone?'), options: ['2/3', '1/3', '1/6'] }),
      q({ question: stem(4, 'Which fraction is bigger, 1/2 or 1/4?'), options: ['1/2', '1/4', 'the same'] }),
      q({ slo: 'S2', level: 'understand', question: stem(5, '3/4 of the class came. What fraction stayed away?'), options: ['1/4', '3/4', '4/4'] }),
      q({ question: stem(6, 'What is the top number of a fraction called?'), options: ['numerator', 'denominator', 'total'] }),
      q({ slo: 'S2', level: 'understand', question: stem(7, 'Half of 8 mangoes is how many?'), options: ['4', '2', '8'] }),
    ];
  }

  const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReset();
    process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
    delete process.env.QUIZ_MULTI_FLOW_ID;
    delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
    jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
    jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : {
        data: [{
          id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: DIGEST.subject,
          language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '4', step: 'author' },
        }],
      }),
      coaching_sessions: {
        data: [{
          id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'ur',
          created_at: '2026-09-07T05:00:00Z', analysis_data: { topic: 'x', subject: 'x' },
          users: { phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor' },
        }],
      },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [{ phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor' }] },
    });
  });

  const storedRows = () => {
    const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert');
    return ins.length ? ins[0][1] : [];
  };

  test('two over-long stems, then one, is a repair — and the quiz ships eight', async () => {
    // every full attempt writes the same two over-long stems, so nothing but a
    // repair can save it; the repair returns those two questions shortened.
    mockCreate.mockImplementation((args) => {
      const prompt = args.messages[0].content;
      if (prompt.includes('REWRITE THESE QUESTIONS')) {
        return Promise.resolve(reply({
          lesson_summary: SUMMARY,
          questions: [2, 3].map((i) => ({ index: i, ...eight()[i] })),
        }));
      }
      return Promise.resolve(reply({ lesson_summary: SUMMARY, questions: eight({ long: [2, 3] }) }));
    });

    const r = await Gen.process(QID, {});

    expect(r.failed).toBeUndefined();
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    rows.forEach((row) => expect([...String(row.question_text)].length).toBeLessThanOrEqual(200));
    const repairs = mockCreate.mock.calls.filter((c) => c[0].messages[0].content.includes('REWRITE THESE QUESTIONS'));
    expect(repairs.length).toBeGreaterThan(0);
    expect(repairs[0][0].messages[0].content).toContain('stem >200 code points');
  });
});
