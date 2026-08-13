/**
 * bd-2673 — submitting a written capstone from the portal.
 *
 * The end-to-end path the interim block (bd-2490) existed because the portal did
 * not have: serve a free-text paper, score each answer with the bot's rubric,
 * apply the bot's pass bar, persist the attempt and its answer rows, and mint the
 * certificate on a pass.
 *
 * Harness follows tests/training/portal-grand-quiz.test.js; the LLM grader is
 * mocked by the shared delegation fixture to a deterministic 4/5 per answer.
 */

let supabaseFrom;
let tableStates;
let inserted;
let issueCertificateMock;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, orderCol: null, orderDir: null, mutation: null };
  const chain = {};

  const rowsNow = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
      } else if (!col.includes('.')) {
        rows = rows.filter(r => (r[col] === val)
          || (r[col] != null && val != null && String(r[col]) === String(val)));
      }
    }
    return rows;
  };

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    if (record.mutation && record.mutation.op === 'insert') {
      return { data: { id: state.insertId || 'attempt-cap-1' }, error: null };
    }
    return { data: rowsNow()[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = rowsNow();
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir
        : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.insert = jest.fn((rows) => {
    record.mutation = { op: 'insert' };
    for (const row of (Array.isArray(rows) ? rows : [rows])) inserted.push({ table: tableName, row });
    return chain;
  });
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = UID, params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = {
    session: { portalUserId: userId, id: 's1' }, params, query: {}, body,
    method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const h of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = h(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const UID = 'user-1';
const VENDOR = 'v1';
const LEVEL = 18;
const QUIZ = 30;
const MOD_A = 101;
const MOD_B = 102;
const Q_IDS = [900, 901, 902, 903];   // 4 questions x 5 pts = 20; bar = ceil(14) = 14

/** A long enough answer to clear the server-side floor. */
const LONG = 'x'.repeat(450);

function seed() {
  tableStates.training_vendors = { rows: [{
    id: VENDOR, key: 'BEACONHOUSE', name: 'Beacon House',
    unlock_logic: 'all_modules', has_grand_quiz: true, passing_pct: 70, module_passing_pct: 70,
  }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'Level 3', order_index: 1, vendor_id: VENDOR, is_active: true }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_courses = { rows: [{ id: 1, level_id: LEVEL, is_active: true, title: 'C1', order_index: 1 }] };
  tableStates.training_modules = { rows: [
    { id: MOD_A, course_id: 1, is_active: true, title: 'M1', order_index: 1 },
    { id: MOD_B, course_id: 1, is_active: true, title: 'M2', order_index: 2 },
  ] };
  // Level fully complete, so the bot's gate lets the exam start.
  tableStates.teacher_training_progress = { rows: [
    { user_id: UID, module_id: MOD_A }, { user_id: UID, module_id: MOD_B },
  ] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: QUIZ, level_id: LEVEL, quiz_type: 'capstone', is_active: true }] };
  tableStates.training_questions = {
    rows: Q_IDS.map((id, i) => ({
      id, grand_quiz_id: QUIZ, question_text: `Q${i + 1}`,
      order_index: i, is_active: true, options: [], correct_option: '',
    })),
  };
}

const fullPaper = () => ({ answers: Q_IDS.map(id => ({ question_id: id, answer_text: LONG })) });

beforeEach(() => {
  jest.resetModules();
  tableStates = {}; inserted = [];
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  require('../fixtures/delegate-training-to-bot').installTrainingDelegation(() => supabaseFrom);

  issueCertificateMock = jest.fn().mockResolvedValue({
    certificate_code: 'BH-20260813-AAA111',
    teacher_name: 'A Teacher',
    level_name: 'Level 3',
    issued_at: '2026-08-13T00:00:00Z',
  });
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    issueCertificate: issueCertificateMock,
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_r, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  seed();
});

afterEach(() => jest.resetModules());

const SUBMIT = ['post', '/training/level/:id/capstone/attempts'];

describe('bd-2673 — capstone submit, happy path', () => {
  it('scores every answer, passes at the bar, and mints the certificate', async () => {
    const { statusCode, payload } = await invoke(...SUBMIT, {
      params: { id: String(LEVEL) }, body: fullPaper(),
    });

    expect(statusCode).toBe(200);
    // 4 answers x 4 points (the fixture's grader) = 16, bar = ceil(20 * 0.7) = 14.
    expect(payload.attempt.score).toBe(16);
    expect(payload.attempt.total_score).toBe(20);
    expect(payload.attempt.pass_bar).toBe(14);
    expect(payload.attempt.is_passed).toBe(true);
    expect(issueCertificateMock).toHaveBeenCalledTimes(1);
    expect(payload.certificate.certificate_code).toBe('BH-20260813-AAA111');
  });

  it('records the attempt as a capstone, not a grand quiz', async () => {
    await invoke(...SUBMIT, { params: { id: String(LEVEL) }, body: fullPaper() });
    const attempts = inserted.filter(i => i.table === 'training_assessment_attempts');
    expect(attempts).toHaveLength(1);
    // The bot filters level passes on quiz_kind; a capstone written as 'grand'
    // is how the first Beacon House certificate went invisible (bd-2479).
    expect(attempts[0].row.quiz_kind).toBe('capstone');
    expect(attempts[0].row.level_id).toBe(LEVEL);
    expect(attempts[0].row.status).toBe('passed');
  });

  it('stores each answer verbatim with its score and feedback', async () => {
    await invoke(...SUBMIT, { params: { id: String(LEVEL) }, body: fullPaper() });
    const rows = inserted.filter(i => i.table === 'training_assessment_answers');
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.row.answer_text).toBe(LONG);      // verbatim — never truncated
      expect(r.row.answer_score).toBe(4);
      expect(r.row.feedback_text).toBe('Clear and specific.');
    }
    // question_index follows the canonical order, matching the WhatsApp writer.
    expect(rows.map(r => r.row.question_index).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('bd-2673 — capstone submit refuses a paper it cannot mark fairly', () => {
  it('rejects a partial paper rather than scoring the answers it got', async () => {
    // Scoring 2 of 4 and reporting 8/20 is bd-2478 — a teacher who answered well
    // being told they nearly failed.
    const { statusCode } = await invoke(...SUBMIT, {
      params: { id: String(LEVEL) },
      body: { answers: Q_IDS.slice(0, 2).map(id => ({ question_id: id, answer_text: LONG })) },
    });
    expect(statusCode).toBe(400);
    expect(inserted.filter(i => i.table === 'training_assessment_attempts')).toHaveLength(0);
  });

  it('rejects a duplicate answer for the same question', async () => {
    const { statusCode } = await invoke(...SUBMIT, {
      params: { id: String(LEVEL) },
      body: { answers: [Q_IDS[0], Q_IDS[0], Q_IDS[1], Q_IDS[2]].map(id => ({ question_id: id, answer_text: LONG })) },
    });
    expect(statusCode).toBe(400);
    expect(inserted.filter(i => i.table === 'training_assessment_attempts')).toHaveLength(0);
  });

  it('rejects an answer that references a question not on this exam', async () => {
    const { statusCode } = await invoke(...SUBMIT, {
      params: { id: String(LEVEL) },
      body: { answers: [{ question_id: 555, answer_text: LONG }] },
    });
    expect(statusCode).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('never mints a certificate on a rejected submit', async () => {
    await invoke(...SUBMIT, {
      params: { id: String(LEVEL) },
      body: { answers: Q_IDS.map(id => ({ question_id: id, answer_text: 'short' })) },
    });
    expect(issueCertificateMock).not.toHaveBeenCalled();
  });
});
