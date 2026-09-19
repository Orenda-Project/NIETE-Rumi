/**
 * bd-60137 — routeOpenEndedAnswer must actually RUN.
 *
 * Reported twice from sandbox: the CRQ arrived, a real answer was typed, and it
 * was answered by the generic LLM chat reply. The attempt sat at index 8 of 9
 * with no answer row written.
 *
 * MY BUG, twice over, and both were invisible to every test I had written:
 *
 *   1. The function called `loadServedQuestions(attempt)`. No such function
 *      exists — the real one is `resolveServedQuestions`. That is a
 *      ReferenceError on the first CRQ answer of every exam, thrown and
 *      swallowed upstream, so the message fell through to ordinary chat.
 *
 *   2. The attempt SELECT omitted `quiz_kind` and `training_module_id`, which
 *      resolveServedQuestions reads to choose the question bank. Even with the
 *      name fixed, the served list would have been wrong and the question at
 *      the teacher's index undefined.
 *
 * Neither could be caught by testing the pure rules, because neither is in the
 * rules — they are in the call chain. This suite therefore EXECUTES
 * routeOpenEndedAnswer against a stubbed database and asserts the answer row
 * is written. That is what the repo's TDD rule means by "the red test must
 * execute the changed line": a grep-green line can still be a runtime
 * ReferenceError, and here it was one for two deploys running.
 */

let svc;
let sent;
let writes;
let rows;

/** Chainable supabase stub. `rows(table, filters, single)` supplies data. */
function makeFrom() {
  return function from(table) {
    const q = { _t: table, _f: {}, _payload: null };
    const chain = () => q;
    q.select = chain;
    q.eq = (k, v) => { q._f[k] = v; return q; };
    q.in = (k, v) => { q._f[k] = v; return q; };
    q.order = chain;
    q.limit = chain;
    q.is = chain;
    q.lt = chain;
    q.ilike = (k, v) => { q._f[k] = v; return q; };
    q.maybeSingle = () => Promise.resolve({ data: rows(table, q._f, true) });
    q.single = () => Promise.resolve({ data: rows(table, q._f, true) });
    q.upsert = (payload) => {
      writes.push({ table, op: 'upsert', payload });
      return Promise.resolve({ data: null, error: null });
    };
    q.update = (payload) => {
      writes.push({ table, op: 'update', payload });
      return { eq: () => Promise.resolve({ data: null, error: null }) };
    };
    q.insert = (payload) => {
      writes.push({ table, op: 'insert', payload });
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new' } }) }) };
    };
    q.then = (res) => Promise.resolve({ data: rows(table, q._f, false) }).then(res);
    return q;
  };
}

const ATTEMPT = {
  id: 'att-1',
  user_id: 'user-1',
  level_id: 26,
  grand_quiz_id: 36,
  training_module_id: null,
  quiz_kind: 'grand',
  program_id: 'prog-1',
  // bd-60141 — the paper is 2 MCQs + 1 CRQ, so the CRQ sits at index 2 of 3.
  // This was index 8 of 9 when the exam served the whole MCQ bank; leaving it
  // there made routeOpenEndedAnswer look for a question the paper no longer
  // has, and the typed answer went unclaimed — the very bug this file guards.
  current_question_index: 2,
  total_questions: 3,
  total_score: 3,
  status: 'in_progress',
};

// 8 MCQs + 4 CRQs, exactly as the widened projection returns them.
const BANK = [];
for (let i = 1; i <= 8; i += 1) {
  BANK.push({ id: i, order_index: i, bloom_level: null, options: ['a', 'b', 'c', 'd'], correct_option: '2' });
}
for (let i = 1; i <= 4; i += 1) {
  BANK.push({ id: 100 + i, order_index: 900 + i, bloom_level: null, options: [], correct_option: '' });
}

beforeEach(() => {
  jest.resetModules();
  sent = [];
  writes = [];
  rows = (table, f, single) => {
    if (table === 'users') return { id: 'user-1', name: 'Test Teacher' };
    if (table === 'training_assessment_attempts') return single ? ATTEMPT : [ATTEMPT];
    if (table === 'training_questions') return single ? BANK[0] : BANK;
    if (table === 'training_levels') return { id: 26, vendor_id: 'v-isaps' };
    if (table === 'training_vendors') return { id: 'v-isaps', key: 'ISAPS', capstone_points_per_question: 10 };
    if (table === 'training_courses') return single ? { id: 1, title: 'Module 1 - X', level_id: 26 } : [{ id: 1, title: 'Module 1 - X', level_id: 26 }];
    if (table === 'training_assessment_answers') return single ? null : [];
    if (table === 'training_grand_quizzes') return single ? { id: 36, quiz_type: 'grand_quiz', source_quiz_id: 901 } : [{ id: 36, quiz_type: 'grand_quiz', source_quiz_id: 901 }];
    return single ? null : [];
  };

  jest.doMock('../../bot/shared/config/supabase', () => ({ from: makeFrom(), rpc: jest.fn() }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: (to, text) => { sent.push(String(text)); return true; },
    sendInteractiveMessage: () => true,
    sendInteractiveButtons: () => true,
    sendImageFromUrl: () => true,
    sendFlow: () => true,
  }));
  jest.doMock('../../bot/shared/services/training/capstone-delivery.service', () => ({
    meetsAnswerFloor: () => true,
    MIN_ANSWER_CHARS: 200,
    scoreAnswer: async () => ({ score: 8, feedback: 'Good, specific and practical.' }),
    handleCapstoneButton: async () => true,
    routeTextAnswer: async () => false,
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: jest.fn(), getDefaultModel: () => 'test-model',
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });

  svc = require('../../bot/shared/services/training/quiz-delivery.service');
});

describe('bd-60137 — the CRQ answer is captured, not passed to chat', () => {
  const ANSWER = 'Activity: I would use a whiteboard brainstorm, first divergent then '
    + 'convergent, assessing variety of approaches in the first phase and accuracy in '
    + 'the second, because both thinking modes matter for this objective.';

  test('routeOpenEndedAnswer exists and is callable', () => {
    expect(typeof svc.routeOpenEndedAnswer).toBe('function');
  });

  test('a typed answer on the CRQ index is CLAIMED (returns true)', async () => {
    // This is the assertion both shipped bugs would have failed: a
    // ReferenceError or a wrong served list makes this false.
    const claimed = await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    expect(claimed).toBe(true);
  });

  test('the answer row is written with the text and a rubric mark', async () => {
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    const upsert = writes.find(w => w.table === 'training_assessment_answers');
    expect(upsert).toBeDefined();
    expect(upsert.payload.answer_text).toBe(ANSWER);
    expect(upsert.payload.answer_score).toBe(8);
    // bd-60141 — index 2 of a 3-question paper, was 8 of 9.
    expect(upsert.payload.question_index).toBe(2);
  });

  test('the teacher is told the score — not given a chat reply', async () => {
    await svc.routeOpenEndedAnswer('923000000000', ANSWER);
    expect(sent.join(' ')).toMatch(/8\/10/);
  });

  test('a slash command is never claimed', async () => {
    expect(await svc.routeOpenEndedAnswer('923000000000', '/training')).toBe(false);
  });

  test('empty text is never claimed', async () => {
    expect(await svc.routeOpenEndedAnswer('923000000000', '   ')).toBe(false);
  });
});
