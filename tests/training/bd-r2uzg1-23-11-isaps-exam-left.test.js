/**
 * bd-r2uzg1.23.11 (queue #274, call 13A; ICT sheet Middle and High TT 63, 74): an I-SAPS course whose parts are
 * all done but whose end-of-module exam is not passed must not read "Done".
 *
 * 180 teachers at Level 1 (89 at L2, 69 at L3; prod 25 Nov) had every part done, an exam not passed and no
 * certificate, while every course on the level page said Done and Continue went elsewhere. The level page reads
 * GET /training/courses, which had no exam fact at all.
 *
 * Under test:
 *   1. courseExamStates (pure, isaps-module-exam.rules): course "Module N" -> its active per-module exam
 *      (source_quiz_id 900+N); 'passed' with a passed attempt, else 'left'; no exam -> no entry.
 *   2. GET /training/courses carries exam_state per course: 'left' / 'passed' for I-SAPS, null for a vendor with
 *      no per-module exams (every other vendor's payload is otherwise unchanged), null when the exam read fails.
 *
 * Route harness copied from tests/training/portal-level-unlock-logic.test.js.
 */

require('../fixtures/portal-auth-live').installLivePortalAccounts();

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null };
  const chain = {};

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    // Honour .in() filters so a single seeded table can serve scoped queries.
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
      }
    }
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
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
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

async function invoke(path, { userId, query = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {},
    query,
    method: 'GET',
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

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

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

  // bd-2469 — the portal no longer decides any of this; it asks the bot over
  // HTTP. Here the hop is replaced by an in-process call to the REAL bot
  // functions, driven by the SAME fixture. That is deliberately not a stub:
  // every assertion below still exercises the genuine unlock rules, and it now
  // also proves the portal delegates instead of keeping its own copy. The
  // wire itself is covered separately in tests/portal/training-rules-client
  // and tests/routes/internal-training-api.
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('bullmq', () => ({ Queue: jest.fn(), Worker: jest.fn() }), { virtual: true });
  jest.doMock('aws-sdk', () => ({ SQS: jest.fn() }), { virtual: true });
  jest.doMock('exceljs', () => ({ Workbook: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  jest.doMock('../../dashboard/services/training-rules.service', () => {
    const bot = require('../../bot/shared/routes/teacher-training-endpoint');
    return {
      getLevelStates: (uid) => bot.loadVisibleLevelsWithProgress(uid),
      checkLevelUnlocked: (uid, levelId) => bot.checkLevelUnlocked(uid, levelId),
      checkModuleUnlocked: (uid, moduleId) => bot.checkModuleUnlocked(uid, moduleId),
      checkExamGate: (uid, order, vendorKey) => bot.assertCanStartGrandQuiz(uid, order, vendorKey),
      getGrandQuizState: (uid, levelId) => bot.loadGrandQuizState(uid, levelId),
    };
  });
});

afterEach(() => jest.resetModules());

const { courseExamStates } = require('../../bot/shared/services/training/isaps-module-exam.rules');

describe('courseExamStates (pure)', () => {
  const courses = [
    { id: 101, title: 'Module 1: Philosophical Foundations' },
    { id: 102, title: 'Module 2: Learners' },
    { id: 103, title: 'Introduction' },
  ];
  const quizzes = [
    { id: 37, source_quiz_id: 901, quiz_type: 'grand_quiz', is_active: true },
    { id: 38, source_quiz_id: 902, quiz_type: 'grand_quiz', is_active: true },
  ];

  it("names each course's exam: passed, or left; a course with no exam has no entry", () => {
    expect(courseExamStates(courses, quizzes, [{ grand_quiz_id: 38, is_passed: true }]))
      .toEqual({ 101: 'left', 102: 'passed' });
  });

  it('a failed or open attempt leaves the exam left', () => {
    expect(courseExamStates(courses, quizzes, [{ grand_quiz_id: 37, is_passed: false }, { grand_quiz_id: 38, is_passed: null }]))
      .toEqual({ 101: 'left', 102: 'left' });
  });

  it('an inactive exam, or a level exam (no 900+N id), is not a course exam', () => {
    const q = [{ id: 37, source_quiz_id: 901, quiz_type: 'grand_quiz', is_active: false }, { id: 5, source_quiz_id: null, quiz_type: 'grand_quiz', is_active: true }];
    expect(courseExamStates(courses, q, [])).toEqual({});
  });

  it('bad input reads as no exams, never throws', () => {
    expect(courseExamStates(null, null, null)).toEqual({});
  });
});

const V_ISAPS = 'vendor-isaps';
const V_BH = 'vendor-beaconhouse';

function seedIsaps({ attempts = [], quizzesError = null } = {}) {
  tableStates.training_vendors = { rows: [
    { id: V_ISAPS, key: 'ISAPS', unlock_logic: 'all_modules' },
    { id: V_BH, key: 'BEACONHOUSE', unlock_logic: 'all_modules' },
  ] };
  tableStates.training_levels = { rows: [
    { id: 27, name: 'Effective Teaching', order_index: 0, vendor_id: V_ISAPS, is_active: true, training_vendors: { key: 'ISAPS', unlock_logic: 'all_modules' } },
    { id: 11, name: 'BH-English', order_index: 1, vendor_id: V_BH, is_active: true, training_vendors: { key: 'BEACONHOUSE', unlock_logic: 'all_modules' } },
  ] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: 'user-1', program_id: 'prog-all', is_active: true }] };
  tableStates.training_program_scopes = { rows: [
    { program_id: 'prog-all', vendor_id: V_ISAPS, level_ids: null },
    { program_id: 'prog-all', vendor_id: V_BH, level_ids: null },
  ] };
  tableStates.training_courses = { rows: (f) => {
    const all = [
      { id: 101, title: 'Module 1: Philosophical Foundations', course_type: null, order_index: 0, level_id: 27 },
      { id: 102, title: 'Module 2: Learners', course_type: null, order_index: 1, level_id: 27 },
      { id: 201, title: 'Phonics', course_type: null, order_index: 0, level_id: 11 },
    ];
    return all.filter((c) => f.level_id === undefined || c.level_id === f.level_id);
  } };
  tableStates.training_modules = { rows: [
    { id: 1001, course_id: 101 }, { id: 1002, course_id: 101 },
    { id: 1003, course_id: 102 },
    { id: 2001, course_id: 201 },
  ] };
  tableStates.teacher_training_progress = { rows: [
    { module_id: 1001, completed_at: '2026-10-21' }, { module_id: 1002, completed_at: '2026-10-21' },
    { module_id: 1003, completed_at: '2026-10-22' }, { module_id: 2001, completed_at: '2026-10-23' },
  ] };
  tableStates.training_assessment_attempts = { rows: attempts };
  tableStates.training_grand_quizzes = quizzesError ? { error: quizzesError } : { rows: [
    { id: 37, level_id: 27, source_quiz_id: 901, quiz_type: 'grand_quiz', is_active: true },
    { id: 38, level_id: 27, source_quiz_id: 902, quiz_type: 'grand_quiz', is_active: true },
  ] };
}

const PASSED_38 = { user_id: 'user-1', level_id: 27, grand_quiz_id: 38, quiz_kind: 'grand', status: 'passed', is_passed: true, cooldown_until: null, completed_at: '2026-10-22' };
const OPEN_37 = { user_id: 'user-1', level_id: 27, grand_quiz_id: 37, quiz_kind: 'grand', status: 'in_progress', is_passed: null, cooldown_until: null, completed_at: null };

describe('GET /training/courses: exam_state per course (call 13A)', () => {
  it('I-SAPS: parts done, exam open -> left; exam passed -> passed (parts counts unchanged)', async () => {
    seedIsaps({ attempts: [PASSED_38, OPEN_37] });
    const { statusCode, payload } = await invoke('/training/courses', { userId: 'user-1', query: { level_id: '27' } });
    expect(statusCode).toBe(200);
    const byId = Object.fromEntries(payload.courses.map((c) => [c.id, c]));
    expect(byId[101]).toMatchObject({ module_count: 2, completed_count: 2, exam_state: 'left' });
    expect(byId[102]).toMatchObject({ module_count: 1, completed_count: 1, exam_state: 'passed' });
  });

  it('a vendor with no per-module exams: exam_state null, nothing else changes', async () => {
    seedIsaps({ attempts: [PASSED_38] });
    const { statusCode, payload } = await invoke('/training/courses', { userId: 'user-1', query: { level_id: '11' } });
    expect(statusCode).toBe(200);
    expect(payload.courses).toEqual([
      { id: 201, title: 'Phonics', course_type: null, order_index: 0, module_count: 1, completed_count: 1, exam_state: null },
    ]);
  });

  it('a failed exam read never breaks the list: exam_state null, 200', async () => {
    seedIsaps({ attempts: [PASSED_38], quizzesError: { message: 'boom' } });
    const { statusCode, payload } = await invoke('/training/courses', { userId: 'user-1', query: { level_id: '27' } });
    expect(statusCode).toBe(200);
    expect(payload.courses.map((c) => c.exam_state)).toEqual([null, null]);
    expect(payload.courses.map((c) => c.completed_count)).toEqual([2, 1]);
  });
});
