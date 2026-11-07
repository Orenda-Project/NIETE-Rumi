/**
 * bd-hz6ez.8 — an older in_progress module check blocks every new one.
 *
 * startTrainingQuiz looked up the NEWEST attempt for (user, module) with no
 * status filter and resumed only if that row was in_progress. When a newer
 * attempt had already failed or passed, an older in_progress row stayed
 * invisible; the insert then hit the partial unique index
 * ux_taa_one_active_per_module (status='in_progress', quiz_kind='training_module')
 * and every retry failed the same way.
 *
 * The lookup must ask for the in_progress row directly.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('pdfkit', () => jest.fn(), { virtual: true });

const PHONE = '+92300FIXTURE1';
const USER = 'u-1';
const MODULE = 42;

// Attempts for this teacher + module, newest first.
const ATTEMPTS = [
  { id: 'att-new', status: 'failed', started_at: '2026-11-07T10:00:00Z' },
  { id: 'att-old', status: 'in_progress', started_at: '2026-11-01T10:00:00Z' },
];

function makeSupabase(inserts) {
  const build = (table) => {
    const st = { table, filters: {}, op: null };
    const chain = {
      select() { return chain; },
      insert(p) { st.op = 'insert'; inserts.push({ table, p }); return chain; },
      update() { st.op = 'update'; return chain; },
      upsert() { st.op = 'upsert'; return chain; },
      eq(c, v) { st.filters[c] = v; return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      then(res) { return res(settle()); },
      maybeSingle: async () => settle(true),
      single: async () => settle(true),
    };
    function settle(one = false) {
      if (table === 'training_modules') return { data: one ? { id: MODULE, course_id: 7, title: 'Phonics' } : [], error: null };
      if (table === 'training_questions') {
        const bank = [1, 2, 3].map(i => ({ id: `q-${i}`, question_text: `Q${i}`, options: ['a', 'b', 'c', 'd'], correct_option: '1', order_index: i, is_active: true }));
        return { data: one ? bank[0] : bank, error: null };
      }
      if (table === 'teacher_training_assignments') return { data: one ? { program_id: 'p-1' } : [{ program_id: 'p-1' }], error: null };
      if (table === 'training_courses') return { data: { id: 7, level_id: 3 }, error: null };
      if (table === 'training_attempt_questions') return { data: one ? null : [], error: null };
      if (table === 'training_assessment_attempts') {
        if (st.op === 'insert') {
          // The partial unique index refuses a second in_progress row.
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ux_taa_one_active_per_module"' } };
        }
        if (st.filters.id) return { data: ATTEMPTS.find(a => a.id === st.filters.id) || null, error: null };
        const rows = st.filters.status ? ATTEMPTS.filter(a => a.status === st.filters.status) : ATTEMPTS;
        return { data: one ? rows[0] || null : rows, error: null };
      }
      return { data: one ? null : [], error: null };
    }
    return chain;
  };
  return { from: (t) => build(t), rpc: jest.fn() };
}

function load() {
  jest.resetModules();
  const inserts = [];
  jest.doMock('../../bot/shared/config/supabase', () => makeSupabase(inserts));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveList: jest.fn().mockResolvedValue(true),
  }));
  const svc = require('../../bot/shared/services/training/quiz-delivery.service');
  const { logToFile } = require('../../bot/shared/utils/logger');
  return { svc, inserts, logToFile };
}

describe('bd-hz6ez.8 — resume finds an older in_progress module check', () => {
  test('resumes the older in_progress attempt instead of inserting a duplicate', async () => {
    const { svc, inserts, logToFile } = load();
    await svc.startTrainingQuiz(USER, MODULE, PHONE);

    const attemptInserts = inserts.filter(i => i.table === 'training_assessment_attempts');
    expect(attemptInserts).toHaveLength(0);

    const resumed = logToFile.mock.calls.find(([msg]) => /Resuming in-progress training-module attempt/.test(msg));
    expect(resumed).toBeDefined();
    expect(resumed[1]).toEqual({ attemptId: 'att-old' });
  });
});
