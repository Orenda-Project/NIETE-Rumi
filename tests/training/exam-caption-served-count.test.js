/**
 * bd-2499 — the /training exam caption must describe the paper the teacher
 * will actually sit.
 *
 * bd-2495 capped NIETE level exams at 20 randomly-sampled questions, but the
 * LEVEL_DETAIL caption still counts the whole bank. A teacher opening Skilled
 * Practitioner is told "72 questions" and is then served 20. Confirmed live on
 * 2026-08-02: the serving was correct, the advertisement was not.
 *
 * The caption also hardcodes "24h cooldown on fail". True for a grand quiz,
 * false for a Beacon House capstone — those have no cooldown at all
 * (capstone-delivery never writes cooldown_until). That is bd-2475, fixed on
 * the portal but never here.
 *
 * Both are display-only, but a wrong number is what a teacher plans around.
 */
let supabaseFrom, tableStates;

function makeChain(t) {
  const st = tableStates[t] || {};
  const rec = { filters: {}, isCount: false, orderCol: null, orderDir: null };
  const c = {};
  const rows = () => {
    let r = st.rows || [];
    for (const [col, v] of Object.entries(rec.filters)) {
      if (v && typeof v === 'object' && Array.isArray(v.in)) r = r.filter(x => v.in.includes(x[col]));
      else if (!col.includes('.')) r = r.filter(x => x[col] === v || String(x[col]) === String(v));
    }
    return r;
  };
  const one = () => st.error ? { data: null, error: st.error } : (rec.isCount ? { count: rows().length, data: null, error: null } : { data: rows()[0] || null, error: null });
  const many = () => {
    if (st.error) return { data: null, error: st.error };
    if (rec.isCount) return { count: rows().length, data: null, error: null };
    let r = rows();
    if (rec.orderCol) { const d = rec.orderDir === 'asc' ? 1 : -1; r = [...r].sort((a, b) => a[rec.orderCol] < b[rec.orderCol] ? -d : a[rec.orderCol] > b[rec.orderCol] ? d : 0); }
    return { data: r, error: null };
  };
  c.select = jest.fn((_c, o) => { if (o && o.count === 'exact' && o.head === true) rec.isCount = true; return c; });
  ['eq','neq','gt','gte','lt','lte','like','ilike','is','not'].forEach(m => { c[m] = jest.fn((col, v) => { rec.filters[col] = v; return c; }); });
  c.in = jest.fn((col, v) => { rec.filters[col] = { in: v }; return c; });
  c.order = jest.fn((col, o) => { rec.orderCol = col; rec.orderDir = o && o.ascending ? 'asc' : 'desc'; return c; });
  c.limit = jest.fn(() => c); c.range = jest.fn(() => c);
  c.insert = jest.fn(() => c); c.update = jest.fn(() => c); c.upsert = jest.fn(() => c);
  c.maybeSingle = jest.fn(async () => one()); c.single = jest.fn(async () => one());
  c.then = (res, rej) => Promise.resolve(many()).then(res, rej);
  return c;
}

const UID = 'u1', VENDOR = 'v1', LEVEL = 3, QUIZ = 7;

/** A fully-complete level whose exam bank holds `bank` questions. */
function seed({ bank = 72, cap = 20, quizType = 'grand_quiz', passing = 80 } = {}) {
  tableStates.users = { rows: [{ id: UID, name: 'A', phone_number: '92300' }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_vendors = { rows: [{ id: VENDOR, key: 'V', name: 'V', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: passing, module_passing_pct: 100, exam_question_cap: cap }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'L', order_index: 1, vendor_id: VENDOR, is_active: true }] };
  tableStates.training_courses = { rows: [{ id: 1, level_id: LEVEL, is_active: true, title: 'C', order_index: 1 }] };
  tableStates.training_modules = { rows: [{ id: 101, course_id: 1, is_active: true, title: 'M', order_index: 1 }] };
  tableStates.teacher_training_progress = { rows: [{ user_id: UID, module_id: 101 }] };   // level complete
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: QUIZ, level_id: LEVEL, quiz_type: quizType, is_active: true }] };
  tableStates.training_questions = { rows: Array.from({ length: bank }, (_, i) => ({ id: 900 + i, grand_quiz_id: QUIZ, order_index: i, is_active: true, options: ['a','b'], correct_option: '1' })) };
}

beforeEach(() => {
  jest.resetModules(); tableStates = {};
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  ['@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','exceljs','pdfkit','bullmq','aws-sdk'].forEach(m => jest.doMock(m, () => ({}), { virtual: true }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendInteractiveButtons: jest.fn(), sendInteractiveMessage: jest.fn() }));
});
afterEach(() => jest.resetModules());

const ep = () => require('../../bot/shared/routes/teacher-training-endpoint');

describe('bd-2499 — the caption counts the SERVED paper, not the bank', () => {
  it('a 72-question bank capped at 20 advertises 20', async () => {
    seed({ bank: 72, cap: 20 });
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).toContain('20 questions');
    expect(s.caption).not.toContain('72 questions');
  });

  it('a bank SMALLER than the cap advertises the bank, not the cap', async () => {
    seed({ bank: 8, cap: 20 });
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).toContain('8 questions');
  });

  it('no cap configured still advertises the whole bank', async () => {
    seed({ bank: 45, cap: null });
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).toContain('45 questions');
  });

  it('the locked caption is capped too — it is the same promise, earlier', async () => {
    seed({ bank: 72, cap: 20 });
    tableStates.teacher_training_progress = { rows: [] };   // not complete -> locked
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).toContain('20 questions');
    expect(s.caption).not.toContain('72 questions');
  });

  it('still reports the real vendor pass bar', async () => {
    seed({ bank: 72, cap: 20, passing: 80 });
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).toContain('80%');
  });
});

describe('bd-2475 — a capstone has no cooldown, so do not claim one', () => {
  it('omits the cooldown clause for a capstone', async () => {
    seed({ bank: 8, cap: null, quizType: 'capstone', passing: 70 });
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).not.toMatch(/cooldown/i);
  });

  it('keeps it for a grand quiz, which really does cool down', async () => {
    seed({ bank: 72, cap: 20 });
    const s = await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.caption).toMatch(/24h cooldown/);
  });
});
