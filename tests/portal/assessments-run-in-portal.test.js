/**
 * bd-2673 — assessments run in the portal, and eligibility is what gates them.
 *
 * This file was `assessments-are-whatsapp-only.test.js` and asserted the exact
 * opposite: that all four assessment routes answered 409. That was bd-2490, an
 * interim measure with two stated reasons, both now addressed —
 *
 *   1. a free-text capstone rendered through the radio-per-option path gave a
 *      Beacon House teacher eight questions, no inputs and a dead Submit;
 *   2. every assessment rule the portal owned had drifted from the bot's and
 *      been fixed separately (pass bar bd-2483, progress write bd-2450,
 *      eligibility proxy bd-2447).
 *
 * (1) is fixed by a real written-exam path, and (2) by there no longer being an
 * assessment rule in the portal to drift — marking, both pass verdicts and the
 * capstone rubric all come from the bot, with
 * tests/portal/no-local-grading-in-portal-routes.test.js failing the build if
 * one reappears.
 *
 * WHAT THIS SUITE NOW DEFENDS
 * ---------------------------
 * Opening a gate is the risky half of that change, so the assertions kept the
 * old file's shape and only flipped the expectation: the routes work, AND the
 * things that must still refuse still refuse. The rule that survives verbatim
 * from bd-2490 is the important one:
 *
 *   THE GATE IS THE API, NOT THE BUTTON. #77 shipped this bug in reverse — a
 *   '🔒 Locked' label with no server-side check, which started the exam anyway
 *   when tapped. A session cookie and curl must hit the same wall the UI does,
 *   so these tests drive the ROUTES, not the UI.
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, orderCol: null, orderDir: null };
  const chain = {};
  const rowsNow = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
      } else if (!col.includes('.')) {
        // Honour .eq() as well as .in(). The older portal harnesses treat eq as
        // a no-op, which quietly makes every fixture row visible to every
        // query — that is how a module with no quiz still looked like it had
        // one here, and it is the same gap that let a stale
        // .eq('quiz_kind','grand') filter go untested for months.
        //
        // Compared loosely on purpose: Postgres coerces '101' to 101, and some
        // routes pass req.params through unparsed. Strict equality would make
        // this fixture reject rows the real database returns.
        rows = rows.filter(r => (r[col] === val)
          || (r[col] != null && val != null && String(r[col]) === String(val)));
      }
    }
    return rows;
  };
  const finalize = () => state.error ? { data: null, error: state.error } : { data: rowsNow()[0] || null, error: null };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = rowsNow();
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.insert = jest.fn(() => { inserted.push(tableName); return chain; });
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => { upserted.push(tableName); return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

let inserted; let upserted;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke(method, path, { userId = 'user-1', params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = { session: { portalUserId: userId, id: 's1' }, params, query: {}, body, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined };
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
const PLAIN_MODULE = 101;     // order 1, no questions — still completable here
const QUIZZED_MODULE = 102;   // order 2, has questions

function seed(quizType = 'capstone') {
  tableStates.training_vendors = { rows: [{ id: VENDOR, key: 'V', name: 'V', unlock_logic: 'all_modules', has_grand_quiz: true, passing_pct: 70, module_passing_pct: 70 }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'English', order_index: 1, vendor_id: VENDOR, is_active: true }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_courses = { rows: [{ id: 1, level_id: LEVEL, is_active: true, title: 'C1', order_index: 1 }] };
  tableStates.training_modules = { rows: [
    { id: PLAIN_MODULE, course_id: 1, is_active: true, title: 'M1', order_index: 1, source_media_url: 'https://x/d.pdf' },
    { id: QUIZZED_MODULE, course_id: 1, is_active: true, title: 'M2', order_index: 2, video_url: 'https://x/v.mp4' },
  ] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: 30, level_id: LEVEL, quiz_type: quizType, is_active: true }] };
  tableStates.training_questions = {
    rows: Array.from({ length: 3 }, (_, i) => ({
      id: 900 + i, grand_quiz_id: 30, training_module_id: QUIZZED_MODULE,
      question_text: `Q${i + 1}`, order_index: i, is_active: true,
      options: quizType === 'capstone' ? [] : ['a', 'b'], correct_option: quizType === 'capstone' ? '' : '1',
    })),
  };
}

beforeEach(() => {
  jest.resetModules();
  // The production default. The four portal quiz suites open a test seam to
  // exercise the retained grading logic; this one must never see it.
  delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE;
  tableStates = {}; inserted = []; upserted = [];
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  require('../fixtures/delegate-training-to-bot').installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_r, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

const ASSESSMENT_ROUTES = [
  ['get', '/training/module/:id/questions', { params: { id: String(QUIZZED_MODULE) } }],
  ['post', '/training/module/:id/quiz-attempts', { params: { id: String(QUIZZED_MODULE) }, body: { answers: [{ question_id: 900, chosen_option: '1' }] } }],
  ['get', '/training/level/:id/grand-quiz/questions', { params: { id: String(LEVEL) } }],
  ['post', '/training/level/:id/grand-quiz/attempts', { params: { id: String(LEVEL) }, body: { answers: [{ question_id: 900, chosen_option: '1' }] } }],
];

describe('bd-2673 — no assessment route is blanket-refused any more', () => {
  it.each(ASSESSMENT_ROUTES)('%s %s is not refused with whatsapp_only', async (method, path, opts) => {
    seed('grand_quiz');
    // Level complete, so the bot's gate says the exam is sittable.
    tableStates.teacher_training_progress = { rows: [
      { user_id: UID, module_id: PLAIN_MODULE }, { user_id: UID, module_id: QUIZZED_MODULE },
    ] };
    const { statusCode, payload } = await invoke(method, path, opts);
    expect(statusCode).not.toBe(409);
    expect(payload && payload.code).not.toBe('whatsapp_only');
  });

  it('no longer redirects anyone to WhatsApp to take a quiz', () => {
    // The interim module and its constant are gone, not merely bypassed. A
    // lingering copy is what let the portal and the bot drift before.
    const src = require('fs').readFileSync(require.resolve('../../dashboard/routes/portal.routes'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('PORTAL_ASSESSMENTS_TEST_ENABLE');
    expect(code).not.toContain('whatsapp_only');
    expect(require('fs').existsSync(
      require('path').join(__dirname, '../../portal/src/lib/assessments.ts')
    )).toBe(false);
  });

  it('the written exam is served as free text, with the floor the server enforces', async () => {
    seed('capstone');
    tableStates.teacher_training_progress = { rows: [
      { user_id: UID, module_id: PLAIN_MODULE }, { user_id: UID, module_id: QUIZZED_MODULE },
    ] };
    const { statusCode, payload } = await invoke('get', '/training/level/:id/capstone/questions', {
      params: { id: String(LEVEL) },
    });
    expect(statusCode).toBe(200);
    expect(payload.questions).toHaveLength(3);
    // The number the teacher is held to must come from the enforcing side.
    expect(payload.min_answer_chars).toBeGreaterThan(0);
    expect(payload.pass_mark_pct).toBeGreaterThan(0);
  });

  it('refuses a written answer under the floor, and writes nothing', async () => {
    seed('capstone');
    tableStates.teacher_training_progress = { rows: [
      { user_id: UID, module_id: PLAIN_MODULE }, { user_id: UID, module_id: QUIZZED_MODULE },
    ] };
    const { statusCode, payload } = await invoke('post', '/training/level/:id/capstone/attempts', {
      params: { id: String(LEVEL) },
      body: { answers: [900, 901, 902].map(id => ({ question_id: id, answer_text: 'far too short' })) },
    });
    expect(statusCode).toBe(400);
    expect(payload.code).toBe('answer_too_short');
    // A rejected paper must leave no attempt or answer rows behind.
    expect(inserted).toHaveLength(0);
    expect(upserted).toHaveLength(0);
  });
});

describe('bd-2673 — eligibility, not the surface, is the gate', () => {
  it('refuses the exam paper when the coursework is not done', async () => {
    seed('grand_quiz');   // no progress at all
    const { statusCode, payload } = await invoke('get', '/training/level/:id/grand-quiz/questions', {
      params: { id: String(LEVEL) },
    });
    expect(statusCode).toBe(403);
    expect(payload.questions).toBeUndefined();
  });

  it('refuses a written exam paper when the coursework is not done', async () => {
    seed('capstone');
    const { statusCode, payload } = await invoke('get', '/training/level/:id/capstone/questions', {
      params: { id: String(LEVEL) },
    });
    expect(statusCode).toBe(403);
    expect(payload.questions).toBeUndefined();
  });

  it('refuses a written SUBMIT when the coursework is not done, writing nothing', async () => {
    seed('capstone');
    const { statusCode } = await invoke('post', '/training/level/:id/capstone/attempts', {
      params: { id: String(LEVEL) },
      body: { answers: [{ question_id: 900, answer_text: 'x'.repeat(500) }] },
    });
    expect(statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
  });
});

describe('bd-2673 — content and status still work', () => {
  it('serves module content', async () => {
    seed();
    const { statusCode } = await invoke('get', '/training/module/:id', { params: { id: String(PLAIN_MODULE) } });
    expect(statusCode).toBe(200);
  });

  it('still lists levels', async () => {
    seed();
    const { statusCode } = await invoke('get', '/training/levels', {});
    expect(statusCode).toBe(200);
  });

  it('reports ready — not whatsapp_only — once the exam is sittable', async () => {
    seed();
    tableStates.teacher_training_progress = { rows: [
      { user_id: UID, module_id: PLAIN_MODULE }, { user_id: UID, module_id: QUIZZED_MODULE },
    ] };  // level complete -> the bot's gate says ready
    const { statusCode, payload } = await invoke('get', '/training/level/:id/grand-quiz', { params: { id: String(LEVEL) } });
    expect(statusCode).toBe(200);
    expect(payload.grand_quiz.state).toBe('ready');
  });

  /**
   * Kept from bd-2490. The interim state used to be returned ahead of every
   * other one, which told a teacher with unfinished coursework to go and sit an
   * exam the bot would refuse her. The states that describe eligibility must
   * still win over the state that describes which form to draw.
   */
  it('still says courses_incomplete when the coursework is not done', async () => {
    seed();   // no progress at all
    const { payload } = await invoke('get', '/training/level/:id/grand-quiz', { params: { id: String(LEVEL) } });
    expect(payload.grand_quiz.state).toBe('courses_incomplete');
  });

  it('still completes a module that has NO quiz — there is nothing to assess', async () => {
    seed();
    const { statusCode } = await invoke('post', '/training/module/:id/complete', { params: { id: String(PLAIN_MODULE) } });
    expect(statusCode).toBe(200);
  });
});
