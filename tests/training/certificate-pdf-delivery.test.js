/**
 * Every surface that issues a certificate must also HAND IT OVER.
 *
 * Three code paths mint a certificate on WhatsApp — the level exam
 * (quiz-delivery grand-quiz branch), the quiz-score route for vendors without
 * a capstone (maybeIssueQuizScoreCertificate), and the capstone pass
 * (capstone-delivery). All three used to end at a text message containing a
 * code. These tests assert each one now also sends the PDF as a document —
 * and, just as importantly, that a certificate WITHOUT a PDF still produces
 * the congratulation message and nothing else.
 */

let QuizDelivery;
let Capstone;
let tableStates;
let whatsappSend;
let whatsappButtons;
let sendCertificateDocument;
let issueCertificate;
let maybeIssueQuizScoreCertificate;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, isCount: false, mutation: null };
  const chain = {};
  const track = () => {
    if (record.mutation && !record._tracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._tracked = true;
    }
  };
  const rowsFor = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  const finalize = () => {
    track();
    if (record.isCount) return { count: state.count ?? 0, data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    return { data: rowsFor()[0] || null, error: null };
  };
  const finalizeMany = () => {
    track();
    if (record.isCount) return { count: state.count ?? 0, data: null, error: null };
    if (state.error) return { data: null, error: state.error };
    return { data: rowsFor(), error: null };
  };
  chain.select = jest.fn((_c, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload) => { record.mutation = { op: 'upsert', payload }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

const USER = 'user-uuid-1';
const PHONE = '923001234567';
const PDF_KEY = 'certs/user-uuid-1/PFX-20260802-A1B2C3.pdf';

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((t) => makeChain(t)),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));

  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappButtons = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: whatsappButtons,
    sendDocumentFromUrl: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
    buildR2PublicUrl: (k) => `https://r2.example.com/bucket/${k}`,
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"score": 4, "feedback": "ok"}' } }],
    }) } } }),
    getDefaultModel: () => 'test-model',
  }));

  sendCertificateDocument = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
    sendCertificateDocument,
    generateAndStoreCertificatePdf: jest.fn().mockResolvedValue(null),
    certificatePdfKey: (u, c) => (u && c ? `certs/${u}/${c}.pdf` : null),
    certificatePdfUrl: jest.fn().mockResolvedValue(null),
  }));

  issueCertificate = jest.fn().mockResolvedValue({
    certificate_code: 'PFX-20260802-A1B2C3',
    teacher_name: 'Amina Khan',
    level_name: 'Aspiring Teacher',
    issued_at: '2026-08-02T00:00:00Z',
    already_issued: false,
    pdf_r2_key: PDF_KEY,
  });
  maybeIssueQuizScoreCertificate = jest.fn().mockResolvedValue({ issued: false });
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    issueCertificate,
    maybeIssueQuizScoreCertificate,
  }));

  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
  Capstone = require('../../bot/shared/services/training/capstone-delivery.service');
});

afterEach(() => jest.resetModules());

// ── quiz-delivery: the level exam (grand quiz) ────────────────────────────

function seedGrandQuiz({ correct = 5, total = 5 } = {}) {
  tableStates.training_modules = { rows: [{ id: 42, course_id: 7, title: 'M', order_index: 1 }] };
  tableStates.training_courses = { rows: [{ id: 7, level_id: 3, title: 'C' }] };
  tableStates.training_levels = { rows: [{ id: 3, name: 'Aspiring Teacher', order_index: 0, vendor_id: 'vendor-1' }] };
  tableStates.training_vendors = {
    rows: [{ id: 'vendor-1', key: 'TALEEMABAD', name: 'Taleemabad', module_passing_pct: 100, passing_pct: 80, unlock_logic: 'chain' }],
  };
  tableStates.training_certificates = { rows: [] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
  tableStates.training_assessment_attempts = {
    rows: [{
      id: 'attempt-1', user_id: USER, quiz_kind: 'grand', grand_quiz_id: 'gq-1',
      training_module_id: null, level_id: 3, program_id: 'program-uuid-1',
      total_questions: total, status: 'in_progress',
    }],
  };
  tableStates.training_assessment_answers = {
    rows: Array.from({ length: total }, (_, i) => ({ is_correct: i < correct })),
  };
  return 'attempt-1';
}

describe('level exam pass → the PDF is delivered', () => {
  test('sends the certificate document with the stored key', async () => {
    const id = seedGrandQuiz();
    await QuizDelivery.gradeAttempt(id, PHONE);

    expect(sendCertificateDocument).toHaveBeenCalledTimes(1);
    const [phone, cert] = sendCertificateDocument.mock.calls[0];
    expect(phone).toBe(PHONE);
    expect(cert).toEqual(expect.objectContaining({
      pdf_r2_key: PDF_KEY,
      certificate_code: 'PFX-20260802-A1B2C3',
      level_name: 'Aspiring Teacher',
    }));
  });

  // bd-w2daa.8 — the congratulation used to be a text bubble before the PDF.
  // It is now the PDF's caption: one message, same words, same code.
  test('still sends the congratulation — as the certificate PDF\'s caption', async () => {
    const id = seedGrandQuiz();
    await QuizDelivery.gradeAttempt(id, PHONE);
    expect(sendCertificateDocument).toHaveBeenCalledTimes(1);
    const caption = String(sendCertificateDocument.mock.calls[0][2] || '');
    expect(caption).toContain('Congratulations');
    expect(caption).toContain('PFX-20260802-A1B2C3');
    expect(whatsappSend).not.toHaveBeenCalled();
  });

  test('a PDF that does not arrive still leaves the congratulation, as text', async () => {
    sendCertificateDocument.mockResolvedValueOnce(false);
    const id = seedGrandQuiz();
    await QuizDelivery.gradeAttempt(id, PHONE);
    const said = whatsappSend.mock.calls.map((c) => String(c[1])).join('\n');
    expect(said).toContain('PFX-20260802-A1B2C3');
  });

  test('a certificate with no PDF sends the text and no document', async () => {
    issueCertificate.mockResolvedValueOnce({
      certificate_code: 'PFX-1', teacher_name: 'Amina Khan', level_name: 'Aspiring Teacher',
      issued_at: '2026-08-02T00:00:00Z', already_issued: false, pdf_r2_key: null,
    });
    const id = seedGrandQuiz();
    await QuizDelivery.gradeAttempt(id, PHONE);

    expect(sendCertificateDocument).not.toHaveBeenCalled();
    expect(whatsappSend.mock.calls.map((c) => String(c[1])).join('\n')).toContain('PFX-1');
  });

  test('a failed exam issues nothing and delivers nothing', async () => {
    const id = seedGrandQuiz({ correct: 1, total: 5 });
    await QuizDelivery.gradeAttempt(id, PHONE);
    expect(sendCertificateDocument).not.toHaveBeenCalled();
  });

  test('a delivery failure does not break grading', async () => {
    sendCertificateDocument.mockRejectedValueOnce(new Error('meta 500'));
    const id = seedGrandQuiz();
    await expect(QuizDelivery.gradeAttempt(id, PHONE)).resolves.toBe(true);
  });
});

// ── quiz-delivery: the quiz-score certificate route ───────────────────────

describe('quiz-score certificate → the PDF is delivered', () => {
  function seedModuleQuiz() {
    tableStates.training_modules = { rows: [{ id: 42, course_id: 7, title: 'M', order_index: 1 }] };
    tableStates.training_courses = { rows: [{ id: 7, level_id: 3, title: 'C' }] };
    tableStates.training_levels = { rows: [{ id: 3, name: 'Aspiring Teacher', order_index: 0, vendor_id: 'vendor-1' }] };
    tableStates.training_vendors = {
      rows: [{ id: 'vendor-1', key: 'OXBRIDGE', name: 'Oxbridge', module_passing_pct: 70, passing_pct: 70, unlock_logic: 'all_modules' }],
    };
    tableStates.training_certificates = { rows: [] };
    tableStates.teacher_training_progress = { rows: [] };
    tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
    tableStates.training_questions = { count: 5, rows: [] };
    tableStates.training_assessment_attempts = {
      rows: [{
        id: 'attempt-2', user_id: USER, quiz_kind: 'training_module', grand_quiz_id: null,
        training_module_id: 42, level_id: 3, program_id: 'program-uuid-1',
        total_questions: 5, status: 'in_progress',
      }],
    };
    tableStates.training_assessment_answers = {
      rows: Array.from({ length: 5 }, () => ({ is_correct: true })),
    };
    return 'attempt-2';
  }

  test('sends the document when a quiz-score certificate is issued', async () => {
    maybeIssueQuizScoreCertificate.mockResolvedValueOnce({
      issued: true,
      certificate_code: 'PFX-20260802-A1B2C3',
      level_name: 'Aspiring Teacher',
      teacher_name: 'Amina Khan',
      pdf_r2_key: PDF_KEY,
    });
    const id = seedModuleQuiz();
    await QuizDelivery.gradeAttempt(id, PHONE);

    expect(sendCertificateDocument).toHaveBeenCalledTimes(1);
    expect(sendCertificateDocument.mock.calls[0][1]).toEqual(expect.objectContaining({
      pdf_r2_key: PDF_KEY, certificate_code: 'PFX-20260802-A1B2C3',
    }));
  });

  test('no certificate issued → no document', async () => {
    const id = seedModuleQuiz();
    await QuizDelivery.gradeAttempt(id, PHONE);
    expect(sendCertificateDocument).not.toHaveBeenCalled();
  });
});

// The capstone pass branch is exercised end-to-end in
// tests/training/capstone-delivery.test.js, which already owns the
// answer-routing fixture that reaches the grader.
test('the capstone service is loadable alongside these mocks', () => {
  expect(typeof Capstone.routeTextAnswer).toBe('function');
});
