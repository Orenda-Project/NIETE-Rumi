'use strict';
/**
 * Round 5 — the chrome bubble said "Question 7 of 8"
 * while the card in the same message pair read "QUESTION 5 OF 8".
 *
 * A transcript quiz's external_id is `tq:<quizId>:<sloId>:<n>` (SLO-id
 * string), so ordering the session by external_id (startSession's old
 * behaviour) walks the bank in SLO-id order while the card's own printed
 * number comes from sort_order + 1 — two different orders for the same quiz.
 * orderForSession fixes the ASKING order; the two re-selects below fix the
 * belt-and-braces half (a row loaded without external_id shuffles its options
 * differently from the one the card was drawn from, since displayOrder seeds
 * on external_id || id).
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue({ pickerFailed: false }),
}));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923000000000';

describe('orderForSession — pure helper', () => {
  test('a transcript bank (every row external_id starts with tq:) is asked by sort_order, not by the DB\'s external_id order', () => {
    // DB order (as `.order('external_id')` would return it) is 3,1,0,2 —
    // the SLO ids S9,S2,S9,S1 sort that way as strings. sort_order 0..3 is
    // the authored/printed order and must win.
    const questions = [
      { id: 'q-c', external_id: 'tq:quiz1:S9:2', sort_order: 3 },
      { id: 'q-b', external_id: 'tq:quiz1:S2:0', sort_order: 1 },
      { id: 'q-a', external_id: 'tq:quiz1:S9:0', sort_order: 0 },
      { id: 'q-d', external_id: 'tq:quiz1:S1:1', sort_order: 2 },
    ];
    const ordered = VideoQuiz.orderForSession(questions);
    expect(ordered.map((q) => q.id)).toEqual(['q-a', 'q-b', 'q-d', 'q-c']);
    expect(ordered.map((q) => q.sort_order)).toEqual([0, 1, 2, 3]);
  });

  test('a null/undefined sort_order sorts last, and ties keep the DB order (stable sort)', () => {
    const questions = [
      { id: 'q-1', external_id: 'tq:quiz1:S1:0', sort_order: 1 },
      { id: 'q-2', external_id: 'tq:quiz1:S2:0', sort_order: null },
      { id: 'q-3', external_id: 'tq:quiz1:S3:0', sort_order: 1 },
      { id: 'q-4', external_id: 'tq:quiz1:S4:0' }, // undefined sort_order
    ];
    const ordered = VideoQuiz.orderForSession(questions);
    expect(ordered.map((q) => q.id)).toEqual(['q-1', 'q-3', 'q-2', 'q-4']);
  });

  test('a mixed PK bank (leg: rows plus generated rows) is unchanged: legacy first, each group in DB order', () => {
    const questions = [
      { id: 'g-2', external_id: 'gen:2', sort_order: 5 },
      { id: 'leg-2', external_id: 'leg:2', sort_order: 1 },
      { id: 'g-1', external_id: 'gen:1', sort_order: 4 },
      { id: 'leg-1', external_id: 'leg:1', sort_order: 2 },
    ];
    const ordered = VideoQuiz.orderForSession(questions);
    // Legacy rows first, IN THE DB'S OWN ORDER (leg-2 before leg-1, matching
    // the input order) — sort_order must NOT be consulted for this bank.
    expect(ordered.map((q) => q.id)).toEqual(['leg-2', 'leg-1', 'g-2', 'g-1']);
  });

  test('an empty array returns an empty array', () => {
    expect(VideoQuiz.orderForSession([])).toEqual([]);
  });
});

describe('startSession — the integration red test: transcript quiz asks sort_order 0 first', () => {
  const Q = (n, sloId, sortOrder) => ({
    id: `q-${n}`,
    external_id: `tq:quiz1:${sloId}:${n}`,
    sort_order: sortOrder,
    question_text: `Question sort_order=${sortOrder}?`,
    option_a: 'A', option_b: 'B', option_c: 'C', option_d: null,
    correct_option: 'A', explanation: '', option_feedback: null,
    media: null, render_pattern: 'P1',
  });

  // The bank AS THE DB HANDS IT BACK, i.e. sorted by external_id — which for a
  // transcript quiz means SLO-id string order. Read down the sort_order column
  // of this array and you get 2,0,3,1: the DB's first row is the THIRD question
  // the teacher's PDF prints and the card numbers "QUESTION 3 OF 4".
  const BANK_DB_ORDER = [
    Q(1, 'S9', 2),
    Q(2, 'S1', 0),
    Q(3, 'S9', 3),
    Q(4, 'S2', 1),
  ];

  function stub() {
    let byId = null;
    supabase.from.mockImplementation((table) => {
      if (table === 'quiz_questions') {
        const chain = {
          select: () => chain,
          eq: (col, val) => { if (col === 'id') byId = val; return chain; },
          order: () => chain,
          single: async () => ({ data: BANK_DB_ORDER.find((q) => q.id === byId) || null, error: null }),
          then: (resolve) => resolve({ data: BANK_DB_ORDER, error: null }),
        };
        return chain;
      }
      if (table === 'quiz_sessions') {
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'sess-1' }, error: null }) }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }
      const chain = {
        select: () => chain, eq: () => chain, update: () => chain, insert: () => chain,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    WhatsAppService.sendMessage.mockResolvedValue(true);
  });

  test('question 1 of 4 IS the row whose sort_order is 0', async () => {
    stub();

    await VideoQuiz.startSession({
      phone: PHONE, userId: null, quizId: 'quiz1', videoId: null,
      language: 'en', source: 'video_solo',
    });

    // The counter is no longer a chat message of its own — render.build is
    // given `{ questionNumber, totalQuestions }` and puts it on the question's
    // own message. So the number and the question it labels are now literally
    // the same object, which is the whole point: they cannot disagree.
    expect(sender.sendPhase).toHaveBeenCalled();
    const firstQuestionMsgs = sender.sendPhase.mock.calls[0][1];
    const numbered = firstQuestionMsgs.filter((m) => m.counter);
    expect(numbered).toHaveLength(1);
    expect(numbered[0].counter).toEqual({ i: 1, n: 4 });

    // And it must be the sort_order:0 row, not the sort_order:2 row the DB
    // returned first (that was the bug: the counter said "Question 1 of 4"
    // while the card was the DB's first row).
    const bodies = firstQuestionMsgs.map((m) => m.body || '').join(' | ');
    expect(bodies).toMatch(/sort_order=0/);
    expect(bodies).not.toMatch(/sort_order=2/);
  });
});

describe('sendNextQuestion and handleAnswer both request external_id from quiz_questions', () => {
  const Q1 = {
    id: 'q1', external_id: 'tq:quiz1:S1:0', sort_order: 0,
    question_text: 'Q1?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: null,
    correct_option: 'A', explanation: '', option_feedback: null, media: null, render_pattern: 'P1',
  };

  function stub() {
    supabase.from.mockImplementation((table) => {
      if (table === 'quiz_questions') {
        const chain = {
          select: (cols) => { chain._cols = cols; return chain; },
          eq: () => chain,
          single: async () => ({ data: Q1, error: null }),
        };
        return chain;
      }
      const chain = {
        // `or` is the guard on the counter write: the chain handleAnswer runs is
        // `.update().eq().or('total_questions_answered.is.null,…lte.N')`. A stub
        // missing one link fails as a TypeError, which reads as this file's
        // subject breaking rather than as a stub that is a link short.
        select: () => chain, eq: () => chain, or: () => chain, update: () => chain,
        insert: async () => ({ error: null }),
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    });
    return supabase.from;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    WhatsAppService.sendMessage.mockResolvedValue(true);
  });

  test('sendNextQuestion selects external_id', async () => {
    const from = stub();
    const state = {
      sessionId: 's1', quizId: 'quiz1', questionIds: ['q1'], index: 0,
      language: 'en', answered: 0, correct: 0,
    };
    await VideoQuiz.sendNextQuestion(PHONE, state);

    const call = from.mock.results.find((r) => r.value._cols !== undefined);
    expect(call).toBeDefined();
    expect(call.value._cols).toEqual(expect.stringContaining('external_id'));
  });

  test('handleAnswer selects external_id', async () => {
    const from = stub();
    const redis = require('../../shared/services/cache/railway-redis.service');
    redis.get.mockResolvedValue({
      sessionId: 's1', quizId: 'quiz1', questionIds: ['q1'], index: 0,
      language: 'en', answered: 0, correct: 0, sentAt: Date.now(),
    });

    await VideoQuiz.handleAnswer(PHONE, 'vq_q1_0');

    const call = from.mock.results.find((r) => r.value._cols !== undefined);
    expect(call).toBeDefined();
    expect(call.value._cols).toEqual(expect.stringContaining('external_id'));
  });
});
