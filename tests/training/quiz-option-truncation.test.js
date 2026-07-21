/**
 * bd-2230 — long quiz options must not be truncated.
 *
 * WhatsApp interactive-list rows cap description at 72 chars, so options like
 * "The teacher did not provide specific context about their students and se…"
 * were cut mid-sentence (reported with screenshots on the training feedback
 * card, 21 Jul).
 *
 * Contract:
 *   - When ANY option exceeds the row-description cap, the FULL text of every
 *     option is rendered inside the question body as lettered lines
 *     ("A. full text…"), and the list rows carry only the letter (short/no
 *     description) — nothing is lost.
 *   - When all options fit, the layout is unchanged (options in row
 *     descriptions, body = question text only).
 *   - Works for multi-select questions too (Done row + Selected line intact).
 *
 * Harness cloned from tests/training/quiz-multi-select.test.js.
 */

let QuizDelivery;
let supabaseFrom;
let whatsappInteractive;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, mutation: null };
  const chain = {};
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows, error: null };
  };
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });
  chain.in = jest.fn(() => chain);
  chain.filter = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const ATTEMPT_ID = '11111111-2222-3333-4444-555555555555';
const LONG_A = 'AI cannot generate lesson plans for all subjects no matter how detailed the request is';
const LONG_B = 'The teacher did not provide specific context about their students and setting in the prompt';
const SHORT = ['Yes', 'No', 'Maybe'];

function setupAttempt({ options, correctOption = '2' }) {
  tableStates.training_assessment_attempts = {
    rows: [{
      id: ATTEMPT_ID, user_id: 'user-1', quiz_kind: 'training_module',
      grand_quiz_id: null, training_module_id: 42, level_id: 3, program_id: 'p1',
      current_question_index: 0, total_questions: 1, status: 'in_progress',
    }],
  };
  tableStates.training_questions = {
    rows: [{ id: 900, question_text: 'Why did the plan fail?', options, correct_option: correctOption, order_index: 1 }],
  };
  tableStates.training_assessment_answers = { rows: [] };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));
  whatsappInteractive = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({ getPresignedUrl: jest.fn().mockResolvedValue('x') }));
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => jest.resetModules());

describe('bd-2230 — long options move to the body in full', () => {
  test('any long option ⇒ body carries the full lettered options, rows are letters only', async () => {
    setupAttempt({ options: [LONG_A, LONG_B, 'Short one'] });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, '923001234567');

    const msg = whatsappInteractive.mock.calls[0][1];
    // Full text present, nothing truncated
    expect(msg.body.text).toContain(LONG_A);
    expect(msg.body.text).toContain(LONG_B);
    expect(msg.body.text).toContain('Short one');
    expect(msg.body.text).toMatch(/A\.\s/);
    expect(msg.body.text).toMatch(/B\.\s/);
    // Rows: letters, no truncated fragments
    const rows = msg.action.sections[0].rows;
    expect(rows[0].title).toBe('A');
    for (const r of rows) {
      expect((r.description || '').length).toBeLessThan(30);
      expect(r.description || '').not.toContain('students and se');
    }
  });

  test('all-short options keep the compact layout (regression)', async () => {
    setupAttempt({ options: SHORT });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, '923001234567');
    const msg = whatsappInteractive.mock.calls[0][1];
    expect(msg.body.text).toBe('Why did the plan fail?');
    const rows = msg.action.sections[0].rows;
    expect(rows.map(r => r.description)).toEqual(SHORT);
  });

  test('multi-select long options: Done row and select-all instruction intact', async () => {
    setupAttempt({ options: [LONG_A, LONG_B, 'C short', 'D short'], correctOption: '1,3' });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, '923001234567');
    const msg = whatsappInteractive.mock.calls[0][1];
    expect(msg.body.text).toContain(LONG_A);
    const rows = msg.action.sections[0].rows;
    expect(rows.map(r => r.id)).toContain(`training_quiz_${ATTEMPT_ID}_done`);
    expect(msg.footer.text.toLowerCase()).toContain('select all');
  });

  test('extreme volume never overflows the 4096-char body cap', async () => {
    const huge = Array.from({ length: 9 }, (_, i) => `Option ${i + 1} — ${'x'.repeat(600)}`);
    setupAttempt({ options: huge });
    await QuizDelivery.sendQuestion(ATTEMPT_ID, '923001234567');
    const msg = whatsappInteractive.mock.calls[0][1];
    expect(msg.body.text.length).toBeLessThanOrEqual(4096);
  });
});
