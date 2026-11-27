'use strict';
/**
 * A question a reviewer held is never served from a quiz a child already has (bd-g2baes.3, queue #375).
 *
 * Reviewers mark a broken question in quiz_item_reviews: 'ambiguous' (two right answers / none right / picture or
 * text broken) or 'key_wrong'. The class round and teacher reports already leave those out, but a quiz link sent
 * BEFORE the review still served them, on the web page and on WhatsApp. Now both leave them out when the child
 * plays. An 'open' row (the nightly job's suspect, not yet reviewed: most are real misconceptions) and any reviewed
 * verdict ('key_ok', 'fixed') still serve. The review table unreadable → served as before, logged.
 * Boundaries faked: Supabase, Redis, WhatsApp, the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue({ pickerFailed: false }) }));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({ sendScorecard: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), generateCorrelationId: () => 'c', runWithCorrelation: (_, fn) => fn(), getCurrentCorrelationId: () => null,
}));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../shared/storage/r2', () => ({ getPresignedUrl: jest.fn(async (u) => u) }));

const { logEvent } = require('../../shared/utils/structured-logger');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Keys = require('../../shared/services/quiz/quiz-key-review.service');
const WQ = require('../../shared/services/quiz/web-quiz.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const row = (n) => ({
  id: qid(n), quiz_id: QUIZ, external_id: `leg:x:${n}`, sort_order: n,
  question_text: `Question ${n}?`, option_a: 'Yes', option_b: 'No', option_c: 'Maybe', option_d: null,
  correct_option: 'A', explanation: 'Because.', option_feedback: null, media: {}, render_pattern: 'P3',
});
// 1 ambiguous and 4 key_wrong are held; 2 open, 3 key_ok, 6 fixed and 5 (no row) serve.
const REVIEWS = [
  { question_id: qid(1), status: 'ambiguous' }, { question_id: qid(2), status: 'open' }, { question_id: qid(3), status: 'key_ok' },
  { question_id: qid(4), status: 'key_wrong' }, { question_id: qid(6), status: 'fixed' },
];

function seedWeb({ reviewsFail = false } = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Animals', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Animals', grade: '2', subject: 'English', language: 'en', meta: {}, quiz_source: 'video' }],
    quiz_questions: [1, 2, 3, 4, 5, 6].map(row),
    quiz_item_reviews: REVIEWS,
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  // The embed unreadable (e.g. the table missing on a tier): a select naming it answers an error.
  const from = (t) => {
    const b = fake.from(t);
    if (!reviewsFail || t !== 'quiz_questions') return b;
    const sel = b.select.bind(b);
    b.select = (cols, o) => (String(cols).includes('quiz_item_reviews(')
      ? { eq: () => ({ order: () => ({ order: async () => ({ data: null, error: { message: 'boom' } }) }) }) } : sel(cols, o));
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  if (WQ._resetQuizCache) WQ._resetQuizCache();
});
afterAll(() => { process.env = SAVED; });

describe('servedAfterReview — which statuses hold', () => {
  test('serving holds only reviewer-decided broken items (ambiguous, key_wrong)', () => {
    expect([...Keys.SERVE_HELD].sort()).toEqual(['ambiguous', 'key_wrong']);
  });

  test('drops held rows, keeps the rest in order, takes the embed off', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ ...row(n), quiz_item_reviews: REVIEWS.filter((r) => r.question_id === qid(n)) }));
    const out = Keys.servedAfterReview(rows);
    expect(out.rows.map((r) => r.id)).toEqual([qid(2), qid(3), qid(5), qid(6)]);
    expect(out.held).toEqual([qid(1), qid(4)]);
    expect(out.rows.some((r) => 'quiz_item_reviews' in r)).toBe(false);
  });

  test('no embed on the rows (a plain read): every row serves', () => {
    const rows = [1, 2].map(row);
    expect(Keys.servedAfterReview(rows)).toEqual({ rows, held: [] });
  });
});

describe('web quiz page (a link sent before the review)', () => {
  test('a held question is not on the page', async () => {
    seedWeb();
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions.map((q) => q.qid)).toEqual([qid(2), qid(3), qid(5), qid(6)]);
    expect(JSON.stringify(out)).not.toContain('quiz_item_reviews');
  });

  test('review table unreadable: the quiz plays as before, logged', async () => {
    seedWeb({ reviewsFail: true });
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions).toHaveLength(6);
    expect(logEvent.mock.calls.some((c) => c[0] === 'quiz_keys.serve_hold_unread')).toBe(true);
  });
});

describe('WhatsApp quiz (startSession)', () => {
  const BANK = [
    { id: 'q-a', external_id: 'tq:quiz1:S1:0', sort_order: 0 },
    { id: 'q-b', external_id: 'tq:quiz1:S1:1', sort_order: 1 },
    { id: 'q-c', external_id: 'tq:quiz1:S1:2', sort_order: 2 },
  ].map((q) => ({ ...q, question_text: `Question ${q.id}?`, option_a: 'A', option_b: 'B', option_c: 'C', option_d: null,
    correct_option: 'A', explanation: '', option_feedback: null, media: null, render_pattern: 'P1' }));

  function stub(reviews) {
    let byId = null;
    supabase.from = jest.fn((table) => {
      if (table === 'quiz_questions') {
        const chain = {
          select: () => chain, order: () => chain,
          eq: (col, val) => { if (col === 'id') byId = val; return chain; },
          single: async () => ({ data: BANK.find((q) => q.id === byId) || null, error: null }),
          then: (resolve) => resolve({ data: BANK.map((q) => ({ ...q, quiz_item_reviews: reviews.filter((r) => r.question_id === q.id) })), error: null }),
        };
        return chain;
      }
      if (table === 'quiz_sessions') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'sess-1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }
      const chain = {
        select: () => chain, eq: () => chain, update: () => chain, insert: () => chain,
        single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    });
  }

  test('a held question is never asked: the run is the other two', async () => {
    stub([{ question_id: 'q-a', status: 'ambiguous' }]);
    await VideoQuiz.startSession({ phone: '923000000000', userId: null, quizId: 'quiz1', videoId: null, language: 'en', source: 'video_solo' });
    const first = sender.sendPhase.mock.calls[0][1];
    expect(first.find((m) => m.counter).counter).toEqual({ i: 1, n: 2 });
    const bodies = first.map((m) => m.body || '').join(' | ');
    expect(bodies).toMatch(/Question q-b\?/);
    expect(bodies).not.toMatch(/Question q-a\?/);
  });

  test('an open (unreviewed) flag still serves', async () => {
    stub([{ question_id: 'q-a', status: 'open' }]);
    await VideoQuiz.startSession({ phone: '923000000000', userId: null, quizId: 'quiz1', videoId: null, language: 'en', source: 'video_solo' });
    expect(sender.sendPhase.mock.calls[0][1].find((m) => m.counter).counter).toEqual({ i: 1, n: 3 });
  });
});
