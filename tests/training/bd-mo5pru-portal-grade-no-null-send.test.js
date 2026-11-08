/**
 * bd-mo5pru — a portal-graded module exam never sends WhatsApp to a missing recipient.
 *
 * THE BUG. The portal's module-exam submit (submitModuleExamPaper) marks the written
 * answer in the background and then calls `gradeAttempt(attemptId, null)`: a web request
 * has no phone. gradeAttempt was written for WhatsApp and sent its verdict (module pass,
 * fail, the level-certificate congratulation) to that null phone. Meta answered each one
 * with #100 «The parameter to is required» — about 250 a day in production (24 Oct).
 *
 * THE FIX. gradeAttempt sends only when it has a phone (the pattern the HELD branch
 * already used); the verdict is still written. Exercised through the REAL WhatsAppService
 * with only the network faked (`fetch`), so the RED case is the real call to Meta with
 * `to: null`. The harness is isaps-golive-gates.test.js's (makeChain / moduleExam).
 */

let QuizDelivery;
let WhatsAppService;
let tableStates;
let certificate;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, mutation: null };
  const chain = {};
  const track = () => {
    if (record.mutation && !record._t) { (state._mutations = state._mutations || []).push(record.mutation); record._t = true; }
  };
  const rows = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(p => { record.mutation = { op: 'insert', payload: p }; return chain; });
  chain.update = jest.fn(p => { record.mutation = { op: 'update', payload: p }; return chain; });
  chain.upsert = jest.fn(p => { record.mutation = { op: 'upsert', payload: p }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach(m => {
    chain[m] = jest.fn((c, v) => { record.filters[c] = v; return chain; });
  });
  chain.in = jest.fn((c, v) => { record.filters[c] = { in: v }; return chain; });
  ['filter', 'order', 'limit', 'range'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => { track(); return { data: rows()[0] || null, error: null }; });
  chain.maybeSingle = chain.single;
  chain.then = (res, rej) => { track(); return Promise.resolve({ data: rows(), error: null }).then(res, rej); };
  return chain;
}

function loadGrader() {
  jest.resetModules();
  certificate = { issued: false };
  jest.doMock('../../bot/shared/utils/constants', () => ({ WHATSAPP_TOKEN: 'test-token', PHONE_NUMBER_ID: 'test-phone-id' }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(t => makeChain(t)), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://x'), buildR2PublicUrl: jest.fn(() => 'https://x/cert.pdf'),
    downloadFromR2: jest.fn(), downloadMedia: jest.fn(), extractKeyFromUrl: jest.fn(),
  }));
  // No Redis: the pacer proceeds without a schedule.
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    isAvailable: () => false, evalScript: jest.fn(), get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true),
  }));
  // The level certificate is decided by its own service; here it answers "issued" when a case asks.
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    maybeIssueQuizScoreCertificate: jest.fn(async () => certificate),
    issueCertificate: jest.fn(async () => certificate),
  }));
  // The Meta boundary: every send ends here.
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) }));
  WhatsAppService = require('../../bot/shared/services/whatsapp.service');
  jest.spyOn(WhatsAppService, 'sendMessage');
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
}

function moduleExam({ mcq = [true, true, true, false], crq = 6 } = {}) {
  tableStates = {
    app_settings: { rows: [{ key: 'isaps_crq_results_released', value: true }] },
    training_assessment_attempts: { rows: [{
      id: 'att-1', user_id: 'u1', quiz_kind: 'grand', grand_quiz_id: 37, training_module_id: null,
      level_id: 27, program_id: 'p1', total_questions: mcq.length + 1, status: 'in_progress',
    }] },
    training_assessment_answers: { rows: [
      ...mcq.map((c, i) => ({ question_index: i, is_correct: c, answer_score: null })),
      { question_index: mcq.length, is_correct: null, answer_score: crq },
    ] },
    training_grand_quizzes: { rows: [{ id: 37, source_quiz_id: 905, level_id: 27, quiz_type: 'grand_quiz', is_active: true }] },
    training_levels: { rows: [{ id: 27, name: 'Level 1: Novice', vendor_id: 'v-isaps', order_index: 0 }] },
    training_vendors: { rows: [{ id: 'v-isaps', key: 'ISAPS', name: 'I-SAPS', passing_pct: 60, module_passing_pct: 70,
      capstone_points_per_question: 10, cooldown_hours: 0, unlock_logic: 'all_modules' }] },
    training_courses: { rows: [{ id: 71, level_id: 27, title: 'Module 5 - Assessment and Data Use', order_index: 5 }] },
    training_modules: { rows: [] }, teacher_training_progress: { rows: [] }, training_certificates: { rows: [] },
    users: { rows: [{ id: 'u1', name: 'T' }] },
  };
}
const verdict = () => (tableStates.training_assessment_attempts._mutations || [])
  .map(m => m.payload).find(p => p && 'is_passed' in p);
const metaBodies = () => global.fetch.mock.calls
  .filter(([url]) => /\/messages$/.test(String(url)))
  .map(([, init]) => JSON.parse(init.body));
const sendsWithoutRecipient = () => metaBodies().filter(b => !b.to).length
  + WhatsAppService.sendMessage.mock.calls.filter(([to]) => !to).length;

describe('bd-mo5pru: a portal-graded module exam never sends WhatsApp to a missing recipient', () => {
  beforeEach(loadGrader);
  afterEach(() => { delete global.fetch; });

  test('module exam PASS graded in the background (phone = null) → nothing sent to Meta', async () => {
    moduleExam({ mcq: [true, true, true, false], crq: 6 });
    await QuizDelivery.gradeAttempt('att-1', null);          // submitModuleExamPaper's finishGrading call
    expect(sendsWithoutRecipient()).toBe(0);
    expect(metaBodies()).toHaveLength(0);
  });

  test('module exam FAIL graded in the background → nothing sent to Meta', async () => {
    moduleExam({ mcq: [true, true, true, true], crq: 5 });  // fails on the written-answer bar
    await QuizDelivery.gradeAttempt('att-1', null);
    expect(sendsWithoutRecipient()).toBe(0);
    expect(metaBodies()).toHaveLength(0);
  });

  test('the last module exam issues the level certificate → no congratulation to a null phone', async () => {
    certificate = { issued: true, teacher_name: 'T', level_name: 'Level 1', certificate_code: 'C-1', pdf_r2_key: 'certs/c-1.pdf' };
    moduleExam({ mcq: [true, true, true, false], crq: 6 });
    await QuizDelivery.gradeAttempt('att-1', null);
    expect(sendsWithoutRecipient()).toBe(0);
    expect(metaBodies()).toHaveLength(0);
  });

  test('the verdict is still written — only the send is skipped', async () => {
    moduleExam({ mcq: [true, true, true, false], crq: 6 });
    await expect(QuizDelivery.gradeAttempt('att-1', null)).resolves.toBe(true);
    expect(verdict()).toMatchObject({ is_passed: true, status: 'passed' });
  });

  test('golden: a WhatsApp-graded exam still sends its verdict once, to the phone', async () => {
    moduleExam({ mcq: [true, true, true, false], crq: 6 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(metaBodies()).toHaveLength(1);
    expect(metaBodies()[0]).toMatchObject({ to: '923000000000', type: 'text' });
  });

  test('golden: a WhatsApp-graded FAIL still sends once, to the phone', async () => {
    moduleExam({ mcq: [true, true, true, true], crq: 5 });
    await QuizDelivery.gradeAttempt('att-1', '923000000000');
    expect(metaBodies()).toHaveLength(1);
    expect(metaBodies()[0].to).toBe('923000000000');
  });
});
