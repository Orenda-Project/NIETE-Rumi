/**
 * bd-2452 / bd-2453 / bd-2454 / bd-2451 — every "locked" state must be a GATE,
 * not a caption.
 *
 * Found by walking all seven locked surfaces in /training. Exactly one of them
 * (the grand-quiz cooldown) actually refused. The rest showed a lock and let
 * the tap through, because the lock lived in the CTA text and nowhere else:
 *
 *   - LEVEL_DETAIL renders the grand-quiz CTA as an EmbeddedLink. WhatsApp
 *     Flows have no disabled state for one, so "🔒 Locked" is still tappable —
 *     and the start_grand_quiz branch had no precondition check at all.
 *     Reproduced on a live account: level 3 at 38/40 modules, gate correctly
 *     computed "🔒 Locked", exam started anyway and recorded an answer.
 *   - startGrandQuiz's guard only covered in_progress and failed-with-cooldown,
 *     so a level with status='passed' fell through and started a fresh attempt.
 *     issueCertificate dedupes per attempt_id, not per level, so re-passing
 *     mints a SECOND certificate for a level already certified.
 *   - maybeOfferCapstone checks levelFullyComplete + already-passed, but
 *     handleCapstoneButton re-checks neither — and WhatsApp buttons live in
 *     chat history forever, so a stale tap starts a capstone at any time.
 *
 * The unifying rule: the label is advisory, the handler is the gate. Every
 * start path re-checks its own precondition at the moment of the tap.
 *
 * bd-2451 is the other half — a refusal must not leave the teacher in silence.
 * Refusals now carry a reason into the Flow-completion params so the bot can
 * say what happened instead of returning true and sending nothing.
 */

let supabaseFrom;
let tableStates;
let inserted;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, orderCol: null, orderDir: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const rowsNow = () => applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    return { data: r[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      r = [...r].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: r, error: null };
  };
  chain.select = jest.fn((_c, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((row) => {
    const rows = Array.isArray(row) ? row : [row];
    for (const r of rows) inserted.push({ table: tableName, row: r });
    const ret = { ...(rows[0] || {}) };
    if (ret.id == null) ret.id = state.newId || 'new-id';
    const ic = {
      select: jest.fn(() => ic),
      single: jest.fn(async () => ({ data: ret, error: null })),
      maybeSingle: jest.fn(async () => ({ data: ret, error: null })),
      then: (res) => Promise.resolve({ data: ret, error: null }).then(res),
    };
    return ic;
  });
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const VENDOR = 'v-niete';
const UID = 'u1';
const LEVEL = 3;
let sendMessage;

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserted = [];
  // flow-response.handler pulls bot/shared/utils/constants, which calls
  // require('dotenv').config() at load. dotenv is a bot-tree dep and root
  // `npm test` runs before `bot/ npm ci`, so mock it virtually (same trick the
  // portal suites use for bcryptjs / express-rate-limit).
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  // llm-client constructs an OpenAI client at module load and throws without a
  // key. The handler never reaches an LLM call in these tests; it just needs
  // the module to import.
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  // Bot-only deps the handler's require graph pulls in. Root `npm test` runs
  // before `bot/ npm ci`, so these must be mocked virtually (CLAUDE.md).
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn(), PutObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
  jest.doMock('exceljs', () => ({ Workbook: jest.fn(() => ({ addWorksheet: jest.fn(), xlsx: { writeBuffer: jest.fn() } })) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('bullmq', () => ({ Queue: jest.fn(), Worker: jest.fn() }), { virtual: true });
  jest.doMock('aws-sdk', () => ({ SQS: jest.fn() }), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  supabaseFrom = jest.fn((t) => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  sendMessage = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage,
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));
});

afterEach(() => jest.resetModules());

/**
 * One NIETE level: 2 courses x 3 modules. `done` controls completion,
 * `attempts` seeds grand-quiz history.
 */
function seed({ done = [], attempts = [], hasExam = true } = {}) {
  tableStates.users = { rows: [{ id: UID, name: 'A', phone_number: '92300' }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: [LEVEL] }] };
  tableStates.training_vendors = {
    rows: [{ id: VENDOR, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80, module_passing_pct: 100 }],
  };
  tableStates.training_levels = {
    rows: [{ id: LEVEL, name: 'Skilled Practitioner', order_index: 0, vendor_id: VENDOR, is_active: true, cpd_level: null }],
  };
  const courses = [], modules = [];
  for (let c = 1; c <= 2; c++) {
    courses.push({ id: c, level_id: LEVEL, is_active: true, title: `Course ${c}`, order_index: c });
    for (let m = 1; m <= 3; m++) modules.push({ id: c * 100 + m, course_id: c, is_active: true, title: `M${c}.${m}`, order_index: m });
  }
  tableStates.training_courses = { rows: courses };
  tableStates.training_modules = { rows: modules };
  tableStates.teacher_training_progress = { rows: done.map(id => ({ user_id: UID, module_id: id })) };
  tableStates.training_assessment_attempts = { rows: attempts, newId: 'attempt-new' };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_grand_quizzes = {
    rows: hasExam ? [{ id: 7, level_id: LEVEL, quiz_type: 'grand_quiz', is_active: true }] : [],
  };
  tableStates.training_questions = {
    rows: Array.from({ length: 10 }, (_, i) => ({
      id: 500 + i, grand_quiz_id: 7, question_text: `Q${i + 1}`,
      options: ['a', 'b'], correct_option: '1', order_index: i, is_active: true,
    })),
  };
  tableStates.training_certificates = { rows: [] };
}

const ALL = [101, 102, 103, 201, 202, 203];
const ep = () => require('../../bot/shared/routes/teacher-training-endpoint');

/** Tap the grand-quiz link on LEVEL_DETAIL, exactly as the Flow does. */
async function tapStartExam(levelOrder = '1') {
  return ep().handleTeacherTrainingDataExchange(UID, 'LEVEL_DETAIL', {
    _action: 'start_grand_quiz',
    _level_order: levelOrder,
  });
}
const action = (res) => res?.data?.extension_message_response?.params?.training_action;
const startedAttempts = () => inserted.filter(i => i.table === 'training_assessment_attempts');

describe('bd-2452 — a locked grand quiz must not start', () => {
  test('the reported bug: tapping the exam on an incomplete level does NOT start it', async () => {
    seed({ done: [101] });   // 1 of 6 modules — the gate renders "🔒 Locked"

    const res = await tapStartExam();

    expect(action(res)).not.toBe('start_grand_quiz');
  });

  test('the refusal explains that the level is unfinished', async () => {
    seed({ done: [101] });

    const res = await tapStartExam();

    expect(String(res.data.message)).toMatch(/finish|complete|module/i);
  });

  test('going through to startGrandQuiz directly also refuses, and writes no attempt', async () => {
    // Defence in depth: the Flow gate is not the only caller.
    seed({ done: [101] });
    const Quiz = require('../../bot/shared/services/training/quiz-delivery.service');

    await Quiz.startGrandQuiz(UID, 1, '92300');

    expect(startedAttempts()).toHaveLength(0);
    expect(sendMessage.mock.calls.map(c => String(c[1])).join('\n')).toMatch(/finish|complete|module/i);
  });

  test('a fully complete level DOES start the exam', async () => {
    seed({ done: ALL });

    const res = await tapStartExam();

    expect(action(res)).toBe('start_grand_quiz');
  });
});

describe('bd-2453 — a level already passed must not be re-sat', () => {
  const passedAttempt = {
    id: 'a-passed', user_id: UID, level_id: LEVEL, quiz_kind: 'grand', grand_quiz_id: 7,
    training_module_id: null, status: 'passed', is_passed: true, cooldown_until: null,
    completed_at: '2026-07-31T10:00:00Z', started_at: '2026-07-31T09:00:00Z',
    current_question_index: 10, total_questions: 10,
  };

  test('tapping "✓ Passed" does not start another attempt', async () => {
    seed({ done: ALL, attempts: [passedAttempt] });

    const res = await tapStartExam();

    expect(action(res)).not.toBe('start_grand_quiz');
    expect(String(res.data.message)).toMatch(/already passed/i);
  });

  test('startGrandQuiz writes no second attempt for a certified level', async () => {
    // This is what mints a duplicate certificate: issueCertificate dedupes on
    // attempt_id, so a NEW attempt on an already-passed level is a new cert.
    seed({ done: ALL, attempts: [passedAttempt] });
    const Quiz = require('../../bot/shared/services/training/quiz-delivery.service');

    await Quiz.startGrandQuiz(UID, 1, '92300');

    expect(startedAttempts()).toHaveLength(0);
  });

  test('a FAILED attempt with an expired cooldown can still be retried', async () => {
    // Guard against over-blocking: only a pass closes the exam for good.
    seed({
      done: ALL,
      attempts: [{ ...passedAttempt, id: 'a-failed', status: 'failed', is_passed: false, cooldown_until: '2020-01-01T00:00:00Z' }],
    });

    const res = await tapStartExam();

    expect(action(res)).toBe('start_grand_quiz');
  });

  test('a FAILED attempt still inside its cooldown is refused', async () => {
    const future = new Date(Date.now() + 6 * 3600_000).toISOString();
    seed({
      done: ALL,
      attempts: [{ ...passedAttempt, id: 'a-cool', status: 'failed', is_passed: false, cooldown_until: future }],
    });

    const res = await tapStartExam();

    expect(action(res)).not.toBe('start_grand_quiz');
    expect(String(res.data.message)).toMatch(/hour|cooldown|recently/i);
  });
});

describe('bd-2452 — a level with no exam configured says so', () => {
  test('tapping the blank CTA is refused with a clear reason', async () => {
    seed({ done: ALL, hasExam: false });

    const res = await tapStartExam();

    expect(action(res)).not.toBe('start_grand_quiz');
    expect(String(res.data.message)).toMatch(/no .*exam|not available|contact/i);
  });
});

describe('bd-2451 — a refusal must never be silent', () => {
  test('the refusal carries a reason code the bot can act on', async () => {
    seed({ done: [101] });

    const res = await tapStartExam();
    const params = res.data.extension_message_response.params;

    expect(params.training_action).toBe('error');
    expect(String(params.error_message || '')).not.toBe('');
  });

  test('the bot sends the reason to the teacher when the Flow closes on an error', async () => {
    const handler = require('../../bot/shared/handlers/flow-response.handler');
    const message = {
      interactive: {
        nfm_reply: {
          response_json: JSON.stringify({
            training_action: 'error',
            error_message: 'Finish all modules in this level first.',
          }),
        },
      },
    };

    await handler.handleTeacherTrainingFlow(message, '92300', UID);

    expect(sendMessage).toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).toMatch(/Finish all modules/);
  });

  test('a plain close (no error) still sends nothing', async () => {
    const handler = require('../../bot/shared/handlers/flow-response.handler');
    const message = {
      interactive: { nfm_reply: { response_json: JSON.stringify({ training_action: 'close' }) } },
    };

    await handler.handleTeacherTrainingFlow(message, '92300', UID);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('bd-2452 — the _level_order guard rejects a non-numeric value', () => {
  test('an un-interpolated literal does not sail through as a level order', async () => {
    // `if (!levelOrder)` treated the literal string "${data.level_order}" as
    // present, because a non-empty string is truthy. It then reached
    // parseInt -> NaN and dead-ended. Only a real number may be trusted.
    seed({ done: ALL });

    const res = await tapStartExam('${data.level_order}');

    // Either it infers the single ready level, or it refuses — but it must
    // never pass the literal through as the level order.
    const lo = res?.data?.extension_message_response?.params?.level_order;
    expect(String(lo || '')).not.toMatch(/\$\{/);
  });
});
