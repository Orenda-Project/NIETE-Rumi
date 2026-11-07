/**
 * bd-gipj44.2 / bd-hz6ez.8 — the WhatsApp module check starts by the same rule
 * as the portal: one open attempt per teacher per module, resumed or opened,
 * never a failed start.
 *
 * startTrainingQuiz read only her NEWEST attempt (order started_at desc,
 * limit 1) and resumed it only if it was still open. With an old open attempt
 * under a newer closed one, it inserted, hit ux_taa_one_active_per_module, and
 * told her "Could not start the module check — please try again in a moment."
 * — which failed identically on every try (bd-hz6ez.8: teacher 025f4773,
 * module 133, an August attempt at question 2/5 under a September fail).
 *
 * Held here, against the stateful in-memory Supabase with the partial unique
 * index modelled:
 *   - the stuck pair: the old open attempt is abandoned and a fresh one opens;
 *     she gets Q1, not the error;
 *   - two taps at once: one open attempt, and neither tap gets the error;
 *   - an open attempt that is her newest is resumed, as before;
 *   - the shared rule file has no requires, so the portal can load it.
 */

const fs = require('fs');
const path = require('path');
const { createMemorySupabase } = require('../fixtures/memory-supabase');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('pdfkit', () => jest.fn(), { virtual: true });

const PHONE = '923001234567';
const USER = 'u-1';
const MODULE = 42;
const ONE_OPEN_PER_MODULE = {
  keys: ['user_id', 'training_module_id'],
  where: (r) => r.status === 'in_progress' && r.quiz_kind === 'training_module',
};
const COULD_NOT_START = /Could not start the module check/;

let db;

function load(attemptRows = []) {
  jest.resetModules();
  mockLogEvent.mockClear();
  db = createMemorySupabase({
    training_modules: [{ id: MODULE, course_id: 7, title: 'Restorative Practices', is_active: true }],
    training_courses: [{ id: 7, level_id: 3 }],
    training_levels: [{ id: 3, vendor_id: null }],
    training_vendors: [],
    training_questions: [1, 2, 3].map((i) => ({
      id: 100 + i, training_module_id: MODULE, question_text: `Question ${i}?`, options: ['a', 'b', 'c', 'd'],
      correct_option: '1', order_index: i, is_active: true, bloom_level: 'remember',
    })),
    teacher_training_assignments: [{ user_id: USER, program_id: 'p-1', is_active: true }],
    training_assessment_attempts: attemptRows,
    training_assessment_answers: [],
  }, { unique: { training_assessment_attempts: ONE_OPEN_PER_MODULE } });
  const sent = [];
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: (...a) => db.from(...a), rpc: jest.fn(async () => ({ data: null, error: null })) }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async (_to, body) => { sent.push(String(body)); return true; }),
    sendInteractiveButtons: jest.fn(async (_to, p) => { sent.push(JSON.stringify(p)); return true; }),
    sendInteractiveMessage: jest.fn(async (_to, p) => { sent.push(JSON.stringify(p)); return true; }),
    sendInteractiveList: jest.fn(async (_to, p) => { sent.push(JSON.stringify(p)); return true; }),
    sendListMessage: jest.fn(async (...a) => { sent.push(JSON.stringify(a)); return true; }),
  }));
  const svc = require('../../bot/shared/services/training/quiz-delivery.service');
  return { svc, sent };
}

const attempts = () => db.rows('training_assessment_attempts');
const open = () => attempts().filter((a) => a.status === 'in_progress');
const row = (over) => ({
  user_id: USER, program_id: 'p-1', quiz_kind: 'training_module', training_module_id: MODULE, level_id: 3,
  current_question_index: 0, total_questions: 3, total_score: 3, ...over,
});

describe('WhatsApp module check — an old open attempt under a newer closed one', () => {
  const OLD = 'att-old-open';
  const NEWER = 'att-newer-closed';
  const stuck = () => load([
    row({ id: OLD, status: 'in_progress', current_question_index: 1, started_at: '2026-08-06T09:00:00Z' }),
    row({ id: NEWER, status: 'failed', score: 0, is_passed: false, started_at: '2026-09-21T03:21:00Z', completed_at: '2026-09-21T03:21:00Z' }),
  ]);

  test('opens a fresh check and abandons the old one, instead of "Could not start"', async () => {
    const { svc, sent } = stuck();
    const ok = await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(sent.join(' ⏎ ')).not.toMatch(COULD_NOT_START);
    expect(ok).not.toBe(false);
    expect(attempts().find((a) => a.id === OLD).status).toBe('abandoned');
    expect(attempts().find((a) => a.id === NEWER).status).toBe('failed');
    expect(open()).toHaveLength(1);
    expect(open()[0].id).not.toBe(OLD);
    expect(open()[0].current_question_index).toBe(0);
    // She is asked the fresh check's first question.
    expect(sent.join(' ⏎ ')).toMatch(/Q1\/3/);
    expect(mockLogEvent).toHaveBeenCalledWith('training_quiz_attempt_abandoned', expect.objectContaining({
      attempt_uuid: OLD, newer_attempt_uuid: NEWER, module_row_id: MODULE, surface: 'whatsapp',
    }));
  });
});

describe('WhatsApp module check — two taps at once', () => {
  test('one open attempt, and neither tap is told it could not start', async () => {
    const { svc, sent } = load();
    await Promise.all([svc.startTrainingQuiz(USER, MODULE, PHONE), svc.startTrainingQuiz(USER, MODULE, PHONE)]);
    expect(sent.join(' ⏎ ')).not.toMatch(COULD_NOT_START);
    expect(attempts()).toHaveLength(1);
    expect(open()).toHaveLength(1);
  });
});

describe('WhatsApp module check — her open attempt is her newest', () => {
  test('is resumed, as before: no new row, nothing abandoned', async () => {
    const { svc, sent } = load([
      row({ id: 'att-done', status: 'passed', is_passed: true, started_at: '2026-09-01T09:00:00Z', completed_at: '2026-09-01T09:05:00Z' }),
      row({ id: 'att-open', status: 'in_progress', current_question_index: 1, started_at: '2026-11-01T09:00:00Z' }),
    ]);
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(attempts()).toHaveLength(2);
    expect(attempts().every((a) => a.status !== 'abandoned')).toBe(true);
    expect(sent.join(' ⏎ ')).toMatch(/Q2\/3/);
  });
});

describe('the shared rule', () => {
  test('has no requires, so the portal can load it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/training/open-module-attempt.js'), 'utf8');
    expect(src).not.toMatch(/require\(/);
  });
});
