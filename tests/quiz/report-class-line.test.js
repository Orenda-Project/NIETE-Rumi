'use strict';
/**
 * PLAN_R5 §0 item 6 / D6 — the report names the class the CHILDREN entered,
 * never the digest's grade band ("Grade 6-8" was a model's guess about a
 * recording, not a fact about a classroom).
 *
 * `classesTaught()` is the pure extraction (tested directly below); the
 * integration tests prove generate() actually threads its result into the
 * template call as `classes` — an array of RAW (unit-word-stripped) values,
 * never pre-formatted, because the template attaches the document's own
 * "Class"/"Classes"/"جماعت" wording via the shared classHeading() helper.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockRenderHtml = jest.fn().mockReturnValue('<html></html>');
jest.mock('../../bot/shared/templates/video-quiz-report.template', () => mockRenderHtml);
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));

const supabase = require('../../bot/shared/config/supabase');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');
const { classesTaught } = report;

const SHARE_CODE_ID = 'sc-1';

describe('classesTaught — pure extraction from the finished sessions', () => {
  test('no sessions -> []', () => {
    expect(classesTaught([])).toEqual([]);
    expect(classesTaught(undefined)).toEqual([]);
  });

  test('all blank classes -> []', () => {
    expect(classesTaught([
      { status: 'completed', student_class: '' },
      { status: 'completed', student_class: null },
      { status: 'completed', student_class: '   ' },
    ])).toEqual([]);
  });

  test('one class', () => {
    expect(classesTaught([{ status: 'completed', student_class: '7' }])).toEqual(['7']);
  });

  test('"7", "Class 7" and " 7 " collapse to one value', () => {
    expect(classesTaught([
      { status: 'completed', student_class: '7' },
      { status: 'completed', student_class: 'Class 7' },
      { status: 'completed', student_class: ' 7 ' },
    ])).toEqual(['7']);
  });

  test('a child who typed "جماعت 4" collapses with one who typed "4"', () => {
    expect(classesTaught([
      { status: 'completed', student_class: 'جماعت 4' },
      { status: 'completed', student_class: '4' },
    ])).toEqual(['4']);
  });

  test('6/7/10 sort numerically, not lexically', () => {
    expect(classesTaught([
      { status: 'completed', student_class: '10' },
      { status: 'completed', student_class: '6' },
      { status: 'completed', student_class: '7' },
    ])).toEqual(['6', '7', '10']);
  });

  test('unfinished sessions are excluded', () => {
    expect(classesTaught([
      { status: 'completed', student_class: '6' },
      { status: 'in_progress', student_class: '9' },
      { status: 'expired', student_class: '11' },
    ])).toEqual(['6']);
  });
});

describe('generate() — classesTaught(done) reaches the template as `classes`', () => {
  const shareCode = {
    id: SHARE_CODE_ID, code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 'u1',
    teacher_name: 'Miss Ayesha', topic: 'Electric circuit', language: 'en',
    report_sent_at: null,
  };
  const teacher = { phone_number: '923001234567', preferred_language: 'en' };

  function stub(sessions) {
    supabase.from.mockImplementation((table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        update: () => chain,
        maybeSingle: async () => {
          if (table === 'quiz_share_codes') return { data: shareCode };
          if (table === 'users') return { data: teacher };
          return { data: null };
        },
      };
      chain.eq = () => {
        const listy = {
          ...chain,
          then: (resolve) => resolve({ data: table === 'quiz_sessions' ? sessions : [] }),
        };
        listy.eq = () => listy;
        listy.in = () => listy;
        listy.is = () => listy;
        listy.select = () => listy;
        listy.maybeSingle = chain.maybeSingle;
        listy.update = chain.update;
        return listy;
      };
      return chain;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRenderHtml.mockReturnValue('<html></html>');
  });

  test('two finished classes reach the template as the RAW, bare array', async () => {
    stub([
      { id: 's1', student_name: 'Hamza', student_class: '7', status: 'completed',
        total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 },
      { id: 's2', student_name: 'Ayesha', student_class: 'Class 6', status: 'completed',
        total_questions_answered: 8, correct_answers: 6, mastery_percentage: 75 },
    ]);

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(mockRenderHtml).toHaveBeenCalledTimes(1);
    const vm = mockRenderHtml.mock.calls[0][0];
    // Bare and sorted, never "Grade 7" / "Class 6" — the template attaches
    // its own unit word.
    expect(vm.classes).toEqual(['6', '7']);
  });

  test('nobody has entered a class -> an empty array, never a digest guess', async () => {
    stub([
      { id: 's1', student_name: 'Hamza', student_class: null, status: 'completed',
        total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 },
    ]);

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const vm = mockRenderHtml.mock.calls[0][0];
    expect(vm.classes).toEqual([]);
  });

  test('an unfinished sibling session does not contribute its class', async () => {
    stub([
      { id: 's1', student_name: 'Hamza', student_class: '7', status: 'completed',
        total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 },
      { id: 's2', student_name: 'Bilal', student_class: '9', status: 'in_progress',
        total_questions_answered: 2, correct_answers: 1, mastery_percentage: 50 },
    ]);

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const vm = mockRenderHtml.mock.calls[0][0];
    expect(vm.classes).toEqual(['7']);
  });
});
