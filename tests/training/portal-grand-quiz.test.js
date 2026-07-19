/**
 * Grand quiz (level exam) portal endpoints — quiz-parity phase 3.
 *
 *   GET  /api/portal/training/level/:id/grand-quiz            (gate/state)
 *   GET  /api/portal/training/level/:id/grand-quiz/questions  (exam paper)
 *   POST /api/portal/training/level/:id/grand-quiz/attempts   (submit+grade)
 *
 * Verifies the portal writes the SAME rows with the SAME semantics as the
 * WhatsApp writer (bot/shared/services/training/quiz-delivery.service.js,
 * quiz_kind='grand'): 100% pass bar, status passed/failed, 24h cooldown on
 * fail only, certificate issued on pass via the shared bot certificate
 * service, eligibility = every active course in the level has ≥1 completed
 * module (the loadGrandQuizState criterion).
 *
 * Same mock harness as tests/training/portal-quiz-submit.test.js.
 */

let supabaseFrom;
let tableStates;
let inserts;   // [{ table, row }]
let upserts;
let issueCertificateMock;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, rangeArgs: null };
  const chain = {};

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol], bv = b[record.orderCol];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    return { data: rows, error: null };
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn((a, b) => { record.rangeArgs = [a, b]; return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn((rowOrRows) => {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    for (const r of rows) inserts.push({ table: tableName, row: r });
    const returned = { ...(rows[0] || {}) };
    if (returned.id == null) returned.id = state.newId || 'generated-id';
    const insertChain = {
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      maybeSingle: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      then: (resolve, reject) => Promise.resolve({ data: state.insertError ? null : returned, error: state.insertError || null }).then(resolve, reject),
    };
    return insertChain;
  });
  chain.upsert = jest.fn((row, opts) => {
    upserts.push({ table: tableName, row, opts });
    const upsertChain = {
      select: jest.fn(() => upsertChain),
      single: jest.fn(async () => ({ data: row, error: null })),
      then: (resolve, reject) => Promise.resolve({ data: row, error: null }).then(resolve, reject),
    };
    return upsertChain;
  });
  chain.update = jest.fn(() => ({ eq: jest.fn(() => ({ then: (r) => Promise.resolve({ data: null, error: null }).then(r) })) }));
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke({ method, path, userId, params = {}, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {},
    method: method.toUpperCase(),
    path,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

const GATE_PATH = '/training/level/:id/grand-quiz';
const QUESTIONS_PATH = '/training/level/:id/grand-quiz/questions';
const SUBMIT_PATH = '/training/level/:id/grand-quiz/attempts';

/**
 * Canonical fixture: Level 1 (id=1) with 2 courses × 1 module each, a grand
 * quiz (id=90) with 3 questions. `completedModules` controls eligibility:
 * pass ['m1','m2'] (both courses started → eligible), ['m1'] (one course →
 * not eligible), [] (nothing started).
 */
function seedLevel({
  levelId = 1,
  quizId = 90,
  completedModules = ['m1', 'm2'],
  attempts = [],
  programId = 'prog-1',
  certificates = [],
} = {}) {
  tableStates.training_levels = {
    rows: [{ id: levelId, name: 'Foundations', order_index: 0, is_active: true }],
  };
  tableStates.training_courses = {
    rows: [
      { id: 'c1', level_id: levelId, is_active: true },
      { id: 'c2', level_id: levelId, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [
      { id: 'm1', course_id: 'c1', is_active: true },
      { id: 'm2', course_id: 'c2', is_active: true },
    ],
  };
  tableStates.teacher_training_progress = {
    rows: completedModules.map(id => ({ module_id: id, user_id: 'user-1' })),
  };
  tableStates.training_grand_quizzes = {
    rows: [{ id: quizId, level_id: levelId, quiz_type: 'grand_quiz', is_active: true }],
  };
  tableStates.training_questions = {
    // Filtered by grand_quiz_id in the routes — return rows only when the
    // grand_quiz_id filter matches, so a module-quiz query can't leak in.
    rows: (filters) => (filters.grand_quiz_id === quizId ? [
      { id: 201, grand_quiz_id: quizId, question_text: 'GQ1', question_urdu: null, options: ['a', 'b'], correct_option: '1', order_index: 1, is_active: true },
      { id: 202, grand_quiz_id: quizId, question_text: 'GQ2', question_urdu: null, options: ['a', 'b'], correct_option: '2', order_index: 2, is_active: true },
      { id: 203, grand_quiz_id: quizId, question_text: 'GQ3', question_urdu: null, options: ['a', 'b'], correct_option: '1', order_index: 3, is_active: true },
    ] : []),
  };
  tableStates.teacher_training_assignments = {
    rows: [{ program_id: programId, user_id: 'user-1', is_active: true }],
  };
  tableStates.training_assessment_attempts = {
    rows: attempts,
    newId: 'grand-attempt-uuid-1',
  };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: certificates };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserts = [];
  upserts = [];

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });

  // The shared bot certificate service — lazily required by the submit
  // handler on pass. Mocked so the dashboard suite doesn't load the bot's
  // supabase boot gate.
  issueCertificateMock = jest.fn().mockResolvedValue({
    certificate_code: 'TESTPFX-20260719-ABC123',
    teacher_name: 'Amina',
    level_name: 'Foundations',
    issued_at: '2026-07-19T10:00:00.000Z',
    already_issued: false,
  });
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    issueCertificate: issueCertificateMock,
  }), { virtual: true });
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
  }), { virtual: true });
});

afterEach(() => jest.resetModules());

// ─── GET gate ───────────────────────────────────────────────────────────────

describe('GET /api/portal/training/level/:id/grand-quiz', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invoke({ method: 'get', path: GATE_PATH, userId: null, params: { id: '1' } });
    expect(statusCode).toBe(401);
  });

  it('state=ready when every course in the level has ≥1 completed module', async () => {
    seedLevel({ completedModules: ['m1', 'm2'] });
    const { statusCode, payload } = await invoke({ method: 'get', path: GATE_PATH, userId: 'user-1', params: { id: '1' } });
    expect(statusCode).toBe(200);
    expect(payload.grand_quiz.state).toBe('ready');
    expect(payload.grand_quiz.question_count).toBe(3);
    expect(payload.grand_quiz.pass_mark_pct).toBe(100);
    expect(payload.grand_quiz.cooldown_hours).toBe(24);
  });

  it('state=courses_incomplete when a course has no completed modules (WhatsApp eligibility rule)', async () => {
    seedLevel({ completedModules: ['m1'] }); // c2 untouched
    const { payload } = await invoke({ method: 'get', path: GATE_PATH, userId: 'user-1', params: { id: '1' } });
    expect(payload.grand_quiz.state).toBe('courses_incomplete');
    expect(payload.grand_quiz.courses_started).toBe(1);
    expect(payload.grand_quiz.courses_total).toBe(2);
  });

  it('state=cooldown with cooldown_until surfaced while a failed attempt cools down', async () => {
    const future = new Date(Date.now() + 5 * 3_600_000).toISOString();
    seedLevel({
      attempts: [{ id: 'a1', level_id: 1, quiz_kind: 'grand', status: 'failed', is_passed: false, cooldown_until: future, completed_at: new Date().toISOString() }],
    });
    const { payload } = await invoke({ method: 'get', path: GATE_PATH, userId: 'user-1', params: { id: '1' } });
    expect(payload.grand_quiz.state).toBe('cooldown');
    expect(payload.grand_quiz.cooldown_until).toBe(future);
  });

  it('state=passed with the certificate attached', async () => {
    seedLevel({
      attempts: [{ id: 'a1', level_id: 1, quiz_kind: 'grand', status: 'passed', is_passed: true, cooldown_until: null, completed_at: '2026-07-01T00:00:00Z' }],
      certificates: [{ certificate_code: 'TESTPFX-20260701-XYZ789', teacher_name_snapshot: 'Amina', level_name_snapshot: 'Foundations', issued_at: '2026-07-01T00:00:00Z' }],
    });
    const { payload } = await invoke({ method: 'get', path: GATE_PATH, userId: 'user-1', params: { id: '1' } });
    expect(payload.grand_quiz.state).toBe('passed');
    expect(payload.grand_quiz.certificate).toEqual(expect.objectContaining({
      certificate_code: 'TESTPFX-20260701-XYZ789',
      teacher_name: 'Amina',
    }));
  });
});

// ─── GET questions ──────────────────────────────────────────────────────────

describe('GET /api/portal/training/level/:id/grand-quiz/questions', () => {
  it('returns the ordered paper WITHOUT correct_option when eligible', async () => {
    seedLevel();
    const { statusCode, payload } = await invoke({ method: 'get', path: QUESTIONS_PATH, userId: 'user-1', params: { id: '1' } });
    expect(statusCode).toBe(200);
    expect(payload.questions).toHaveLength(3);
    expect(payload.questions.map(q => q.id)).toEqual([201, 202, 203]); // order_index asc
    for (const q of payload.questions) {
      expect(q).not.toHaveProperty('correct_option');
      expect(Array.isArray(q.options)).toBe(true);
    }
  });

  it('403s (code=courses_incomplete) when not eligible — the paper is never exposed early', async () => {
    seedLevel({ completedModules: [] });
    const { statusCode, payload } = await invoke({ method: 'get', path: QUESTIONS_PATH, userId: 'user-1', params: { id: '1' } });
    expect(statusCode).toBe(403);
    expect(payload.code).toBe('courses_incomplete');
  });
});

// ─── POST submit ────────────────────────────────────────────────────────────

const ALL_CORRECT = [
  { question_id: 201, chosen_option: '1' },
  { question_id: 202, chosen_option: '2' },
  { question_id: 203, chosen_option: '1' },
];

describe('POST /api/portal/training/level/:id/grand-quiz/attempts', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invoke({ method: 'post', path: SUBMIT_PATH, userId: null, params: { id: '1' }, body: { answers: [] } });
    expect(statusCode).toBe(401);
  });

  it('rejects a missing answers array (400) and an answer-count mismatch (400)', async () => {
    seedLevel();
    const missing = await invoke({ method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: {} });
    expect(missing.statusCode).toBe(400);

    seedLevel();
    const short = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' },
      body: { answers: ALL_CORRECT.slice(0, 1) },
    });
    expect(short.statusCode).toBe(400);
    expect((short.payload.error || '').toLowerCase()).toMatch(/mismatch|count/);
  });

  it('403s (code=courses_incomplete) when the level coursework is not done — gating is server-side', async () => {
    seedLevel({ completedModules: ['m1'] });
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });
    expect(statusCode).toBe(403);
    expect(payload.code).toBe('courses_incomplete');
    expect(inserts.filter(i => i.table === 'training_assessment_attempts')).toHaveLength(0);
  });

  it('PASS — 100% → status=passed, is_passed, NO cooldown, certificate issued via the shared bot service', async () => {
    seedLevel();
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });

    expect(statusCode).toBe(200);
    expect(payload.attempt).toEqual(expect.objectContaining({
      score: 3, max_score: 3, is_passed: true, status: 'passed', cooldown_until: null,
    }));
    expect(payload.certificate).toEqual(expect.objectContaining({
      certificate_code: 'TESTPFX-20260719-ABC123',
    }));

    // Attempt row — exact WhatsApp grand-quiz shape
    const attemptInsert = inserts.find(i => i.table === 'training_assessment_attempts');
    expect(attemptInsert.row).toEqual(expect.objectContaining({
      user_id: 'user-1',
      program_id: 'prog-1',
      quiz_kind: 'grand',
      grand_quiz_id: 90,
      level_id: 1,
      total_questions: 3,
      total_score: 3,          // one point per question
      score: 3,
      is_passed: true,
      status: 'passed',
      cooldown_until: null,
    }));

    // One answer row per question, canonical 0-based question_index
    const answerInserts = inserts.filter(i => i.table === 'training_assessment_answers');
    expect(answerInserts).toHaveLength(3);
    expect(answerInserts.map(a => a.row.question_index).sort()).toEqual([0, 1, 2]);

    // Certificate service called with the attempt context (injected client first)
    expect(issueCertificateMock).toHaveBeenCalledTimes(1);
    expect(issueCertificateMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      userId: 'user-1', programId: 'prog-1', levelId: 1, attemptId: 'grand-attempt-uuid-1',
    }));
  });

  it('FAIL — any wrong answer → status=failed, cooldown_until ≈ now+24h, NO certificate', async () => {
    seedLevel();
    const before = Date.now();
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' },
      body: { answers: [
        { question_id: 201, chosen_option: '1' },  // correct
        { question_id: 202, chosen_option: '1' },  // WRONG (correct=2)
        { question_id: 203, chosen_option: '1' },  // correct
      ] },
    });

    expect(statusCode).toBe(200);
    expect(payload.attempt.score).toBe(2);
    expect(payload.attempt.is_passed).toBe(false);
    expect(payload.attempt.status).toBe('failed');
    expect(payload.certificate).toBeNull();

    const cooldownMs = new Date(payload.attempt.cooldown_until).getTime() - before;
    expect(cooldownMs).toBeGreaterThan(23.9 * 3_600_000);
    expect(cooldownMs).toBeLessThan(24.1 * 3_600_000);

    const attemptInsert = inserts.find(i => i.table === 'training_assessment_attempts');
    expect(attemptInsert.row.status).toBe('failed');
    expect(attemptInsert.row.is_passed).toBe(false);
    expect(attemptInsert.row.cooldown_until).toBeTruthy();

    expect(issueCertificateMock).not.toHaveBeenCalled();
  });

  it('COOLDOWN — active cooldown blocks a retry (403 code=cooldown), no row written', async () => {
    const future = new Date(Date.now() + 10 * 3_600_000).toISOString();
    seedLevel({
      attempts: [{ id: 'a1', level_id: 1, quiz_kind: 'grand', status: 'failed', is_passed: false, cooldown_until: future }],
    });
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });
    expect(statusCode).toBe(403);
    expect(payload.code).toBe('cooldown');
    expect(payload.cooldown_until).toBe(future);
    expect(inserts.filter(i => i.table === 'training_assessment_attempts')).toHaveLength(0);
  });

  it('EXPIRED cooldown — a stale failed attempt does NOT block the retry', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    seedLevel({
      attempts: [{ id: 'a1', level_id: 1, quiz_kind: 'grand', status: 'failed', is_passed: false, cooldown_until: past }],
    });
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });
    expect(statusCode).toBe(200);
    expect(payload.attempt.is_passed).toBe(true);
  });

  it('IDEMPOTENCY — already passed → 409 code=already_passed, no duplicate attempt/cert', async () => {
    seedLevel({
      attempts: [{ id: 'a1', level_id: 1, quiz_kind: 'grand', status: 'passed', is_passed: true, cooldown_until: null }],
    });
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });
    expect(statusCode).toBe(409);
    expect(payload.code).toBe('already_passed');
    expect(inserts.filter(i => i.table === 'training_assessment_attempts')).toHaveLength(0);
    expect(issueCertificateMock).not.toHaveBeenCalled();
  });

  it('a perfect per-module attempt on the level does NOT count as a level pass (quiz_kind filter)', async () => {
    // The gate queries filter quiz_kind='grand'; the mock applies rows(filters)
    // so a kind-filtered query must exclude this module attempt.
    seedLevel({
      attempts: [],
    });
    tableStates.training_assessment_attempts.rows = (filters) =>
      (filters.quiz_kind === 'grand' ? [] : [
        { id: 'mod-a', level_id: 1, quiz_kind: 'training_module', status: 'passed', is_passed: true, cooldown_until: null },
      ]);
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });
    expect(statusCode).toBe(200); // NOT 409 — the module attempt must be ignored
    expect(payload.attempt.is_passed).toBe(true);
  });

  it('rejects answers referencing questions not on the exam (400)', async () => {
    seedLevel();
    const { statusCode } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' },
      body: { answers: [
        { question_id: 999, chosen_option: '1' },
        { question_id: 202, chosen_option: '2' },
        { question_id: 203, chosen_option: '1' },
      ] },
    });
    expect(statusCode).toBe(400);
  });

  it('400 when the teacher has no active program assignment (WhatsApp enrollment rule)', async () => {
    seedLevel();
    tableStates.teacher_training_assignments = { rows: [] };
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT_PATH, userId: 'user-1', params: { id: '1' }, body: { answers: ALL_CORRECT },
    });
    expect(statusCode).toBe(400);
    expect((payload.error || '').toLowerCase()).toMatch(/program|assignment/);
  });
});
