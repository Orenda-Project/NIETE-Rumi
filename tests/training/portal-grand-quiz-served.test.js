/**
 * bd-klecr.7 — the portal level exam serves the BOT's paper for the attempt
 * (operator, 2026-10-07: "for NIETE, 20 questions per exam, and each
 * re-attempt gets different questions; the module quizzes stay as they are").
 *
 * The rule is already the vendor's, in training_vendors: NIETE has
 * exam_question_cap = 20 and shuffle_options = true, and WhatsApp's
 * startGrandQuiz draws the paper with it (selectServedQuestions, seeded on the
 * attempt id). The portal ignored it and served every question in the bank
 * (45–72 on production). Now:
 *
 *   GET  …/grand-quiz/questions  opens (or resumes) an in_progress attempt and
 *                                returns ITS paper: the bot's 20, options in
 *                                the served order, each with its canonical value.
 *   POST …/grand-quiz/attempts   marks THAT paper and closes THAT attempt; the
 *                                answers must be the served questions.
 *
 * A vendor without a cap still gets the whole bank — the rule is NIETE's only
 * because the setting is.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const USER = 'user-1';
const LEVEL = 1;
const QUIZ = 90;
let db;

function withUpsert(fake) {
  const from = fake.from.getMockImplementation();
  fake.from.mockImplementation((table) => {
    const chain = from(table);
    chain.upsert = (rowOrRows, opts) => {
      const keys = String((opts && opts.onConflict) || 'id').split(',').map((k) => k.trim());
      const rows = fake.tables[table] || (fake.tables[table] = []);
      const list = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      for (const row of list) {
        const hit = rows.find((r) => keys.every((k) => r[k] === row[k]));
        if (hit) Object.assign(hit, row); else rows.push({ id: `${table}-up-${rows.length + 1}`, ...row });
      }
      const out = { data: list, error: null };
      const c = { select: () => c, single: async () => ({ data: list[0], error: null }), then: (res, rej) => Promise.resolve(out).then(res, rej) };
      return c;
    };
    return chain;
  });
  return fake;
}

const BANK = Array.from({ length: 30 }, (_, i) => ({
  id: 1000 + i, grand_quiz_id: QUIZ, question_text: `GQ${i + 1}`, question_urdu: null,
  options: ['w', 'x', 'y', 'z'], correct_option: String((i % 4) + 1), order_index: i, is_active: true, bloom_level: 'remember',
}));

function seed({ cap = 20, shuffle = true, attempts = [], answers = [] } = {}) {
  db = withUpsert(createMemorySupabase({
    training_vendors: [{ id: 'vendor-niete', key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80, module_passing_pct: 100, exam_question_cap: cap, shuffle_options: shuffle, module_quiz_strategy: 'one_per_bloom' }],
    training_program_scopes: [{ program_id: 'prog-1', vendor_id: 'vendor-niete', level_ids: null }],
    training_levels: [{ id: LEVEL, name: 'Aspiring Teacher', order_index: 0, is_active: true, vendor_id: 'vendor-niete' }],
    training_courses: [{ id: 'c1', level_id: LEVEL, is_active: true, order_index: 0 }],
    training_modules: [{ id: 'm1', course_id: 'c1', is_active: true, order_index: 0 }],
    teacher_training_progress: [{ module_id: 'm1', user_id: USER }],
    training_grand_quizzes: [{ id: QUIZ, level_id: LEVEL, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: null }],
    training_questions: BANK,
    teacher_training_assignments: [{ program_id: 'prog-1', user_id: USER, is_active: true }],
    training_assessment_attempts: attempts,
    training_assessment_answers: answers,
    training_certificates: [],
  }, { unique: { training_assessment_answers: ['attempt_id', 'question_index'] } }));
}

beforeEach(() => {
  process.env.PORTAL_ASSESSMENTS_TEST_ENABLE = '1';
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (...a) => db.from(...a), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => (...a) => db.from(...a));
  // The shared delegation has no certifyLevel (the certificate guard is covered by
  // bd-60145-portal-certifies-via-guard); a pass here only needs it to issue nothing.
  require('../../dashboard/services/training-rules.service').certifyLevel = jest.fn(async () => ({ issued: false }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => { delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE; jest.resetModules(); });

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.methods[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}
async function call(method, path, { params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method} ${path} not found`);
  const req = { session: { portalUserId: USER, id: 's' }, params, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const h of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const getPaper = () => call('get', '/training/level/:id/grand-quiz/questions', { params: { id: String(LEVEL) } });
const getGate = () => call('get', '/training/level/:id/grand-quiz', { params: { id: String(LEVEL) } });
const submit = (body) => call('post', '/training/level/:id/grand-quiz/attempts', { params: { id: String(LEVEL) }, body });
const attempts = () => db.rows('training_assessment_attempts');
const answerRows = () => db.rows('training_assessment_answers');

/** Answer every served question with its canonical correct value (looked up in the bank). */
const allRight = (paper) => paper.questions.map((q) => ({ question_id: q.id, chosen_option: BANK.find((b) => b.id === q.id).correct_option }));
const allWrong = (paper) => paper.questions.map((q) => {
  const key = BANK.find((b) => b.id === q.id).correct_option;
  return { question_id: q.id, chosen_option: key === '1' ? '2' : '1' };
});

describe('the paper', () => {
  it('is the bot\'s 20 for this attempt, from a bank of 30, without the key', async () => {
    seed();
    const { statusCode, payload } = await getPaper();
    expect(statusCode).toBe(200);
    expect(payload.questions).toHaveLength(20);
    expect(payload.question_count).toBe(20);
    expect(JSON.stringify(payload)).not.toMatch(/correct_option/);

    const Serving = require('../../bot/shared/services/training/quiz-serving.service');
    const botPick = Serving.selectServedQuestions(BANK, {
      attemptId: payload.attempt_id, isModuleQuiz: false,
      config: Serving.normalizeServingConfig({ exam_question_cap: 20, shuffle_options: true }),
    }).map((q) => q.id);
    expect(payload.questions.map((q) => q.id)).toEqual(botPick);

    expect(attempts()).toEqual([expect.objectContaining({
      id: payload.attempt_id, user_id: USER, quiz_kind: 'grand', grand_quiz_id: QUIZ, level_id: LEVEL,
      status: 'in_progress', current_question_index: 0, total_questions: 20, total_score: 20, program_id: 'prog-1',
    })]);
  });

  it('shows the options in the served order and says each one\'s canonical value', async () => {
    seed();
    const { payload } = await getPaper();
    const Serving = require('../../bot/shared/services/training/quiz-serving.service');
    for (const q of payload.questions) {
      const order = Serving.buildOptionDisplayOrder({ optionCount: 4, correctOption: BANK.find((b) => b.id === q.id).correct_option, attemptId: payload.attempt_id, questionId: q.id, shuffle: true });
      expect(q.option_values).toEqual(order.map(String));
      expect(q.options).toEqual(order.map((i) => ['w', 'x', 'y', 'z'][i - 1]));
    }
  });

  it('a reload resumes the same attempt and the same paper', async () => {
    seed();
    const first = (await getPaper()).payload;
    const again = (await getPaper()).payload;
    expect(again.attempt_id).toBe(first.attempt_id);
    expect(again.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));
    expect(attempts()).toHaveLength(1);
  });

  it('the exam card counts the served paper, not the bank', async () => {
    seed();
    const { payload } = await getGate();
    expect(payload.grand_quiz.question_count).toBe(20);
  });

  it('a vendor with no cap still gets the whole bank', async () => {
    seed({ cap: null, shuffle: false });
    const { payload } = await getPaper();
    expect(payload.questions).toHaveLength(30);
    expect(payload.questions[0].option_values).toEqual(['1', '2', '3', '4']);
  });
});

describe('submitting', () => {
  it('a pass marks the served 20 and closes THAT attempt, saving 20 answers', async () => {
    seed();
    const paper = (await getPaper()).payload;
    const { statusCode, payload } = await submit({ attempt_id: paper.attempt_id, answers: allRight(paper) });
    expect(statusCode).toBe(200);
    expect(payload.attempt).toEqual(expect.objectContaining({ id: paper.attempt_id, score: 20, max_score: 20, is_passed: true }));
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toEqual(expect.objectContaining({ status: 'passed', is_passed: true, score: 20, current_question_index: 20, cooldown_until: null }));
    expect(attempts()[0].completed_at).toBeTruthy();
    expect(answerRows()).toHaveLength(20);
    expect(answerRows().map((r) => r.question_id)).toEqual(paper.questions.map((q) => q.id));
    expect(answerRows().map((r) => r.question_index)).toEqual([...Array(20).keys()]);
  });

  it('a fail closes the attempt as failed with a cooldown', async () => {
    seed();
    const paper = (await getPaper()).payload;
    const { payload } = await submit({ attempt_id: paper.attempt_id, answers: allWrong(paper) });
    expect(payload.attempt).toEqual(expect.objectContaining({ score: 0, max_score: 20, is_passed: false }));
    expect(attempts()[0]).toEqual(expect.objectContaining({ status: 'failed', is_passed: false }));
    expect(attempts()[0].cooldown_until).toBeTruthy();
  });

  it('refuses answers to questions that were not served, and writes nothing', async () => {
    seed();
    const paper = (await getPaper()).payload;
    const served = new Set(paper.questions.map((q) => q.id));
    const notServed = BANK.filter((b) => !served.has(b.id)).slice(0, 1).map((b) => ({ question_id: b.id, chosen_option: '1' }));
    const answers = [...allRight(paper).slice(1), ...notServed];
    const { statusCode } = await submit({ attempt_id: paper.attempt_id, answers });
    expect(statusCode).toBe(400);
    expect(answerRows()).toHaveLength(0);
    expect(attempts()[0].status).toBe('in_progress');
  });

  it('refuses the whole bank (the old one-shot submit) for a capped paper', async () => {
    seed();
    const paper = (await getPaper()).payload;
    const { statusCode } = await submit({ attempt_id: paper.attempt_id, answers: BANK.map((b) => ({ question_id: b.id, chosen_option: b.correct_option })) });
    expect(statusCode).toBe(400);
    expect(attempts()[0].status).toBe('in_progress');
  });

  it('a submit without an open attempt draws the paper there and then — and a capped one refuses the whole bank', async () => {
    seed();
    const { statusCode } = await submit({ answers: BANK.map((b) => ({ question_id: b.id, chosen_option: b.correct_option })) });
    expect(statusCode).toBe(400);
    expect(attempts()).toHaveLength(0);
  });

  it('finds her open attempt when the page does not send its id', async () => {
    seed();
    const paper = (await getPaper()).payload;
    const { statusCode, payload } = await submit({ answers: allRight(paper) });
    expect(statusCode).toBe(200);
    expect(payload.attempt.id).toBe(paper.attempt_id);
  });

  it('finishes an attempt WhatsApp started, over the answers it already saved', async () => {
    seed({ attempts: [{ id: 'wa-attempt-1', user_id: USER, program_id: 'prog-1', quiz_kind: 'grand', grand_quiz_id: QUIZ, level_id: LEVEL, status: 'in_progress', current_question_index: 1, total_questions: 20, total_score: 20, started_at: '2026-10-06T08:00:00Z' }] });
    const paper = (await getPaper()).payload;
    expect(paper.attempt_id).toBe('wa-attempt-1');
    db.tables.training_assessment_answers.push({ id: 'a0', attempt_id: 'wa-attempt-1', question_index: 0, question_id: paper.questions[0].id, chosen_option: '1', is_correct: false });
    const { statusCode } = await submit({ attempt_id: 'wa-attempt-1', answers: allRight(paper) });
    expect(statusCode).toBe(200);
    expect(answerRows()).toHaveLength(20);
    expect(answerRows().filter((r) => r.question_index === 0)).toHaveLength(1);
  });
});

describe('a re-attempt', () => {
  it('opens a NEW attempt with a different 20', async () => {
    const past = new Date(Date.now() - 48 * 3_600_000).toISOString();
    seed();
    const first = (await getPaper()).payload;
    await submit({ attempt_id: first.attempt_id, answers: allWrong(first) });
    // The 24h cooldown is over.
    db.tables.training_assessment_attempts[0].cooldown_until = past;
    const second = (await getPaper()).payload;
    expect(second.attempt_id).not.toBe(first.attempt_id);
    expect(second.questions).toHaveLength(20);
    expect(second.questions.map((q) => q.id)).not.toEqual(first.questions.map((q) => q.id));
    expect(attempts()).toHaveLength(2);
  });
});
