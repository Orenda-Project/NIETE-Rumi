/**
 * bd-s42dye.5 — a failed exam's retry copy follows the vendor's REAL cooldown.
 *
 * The failure message was hardcoded "Try again in *24 hours*" even though the
 * I-SAPS vendor row carries cooldown_hours = 0 (retakes are immediate; the DB
 * write already honours it). cooldown_hours = 0 means offer the retake now, with
 * no hours mentioned; a non-zero value is quoted as itself; unreadable keeps the
 * historical 24 (fail closed, same as cooldownUntilFor).
 */
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => global.__fromImpl(...a), rpc: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const sent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, msg) => { sent.push(String(msg)); return true; }),
  sendInteractiveButtons: jest.fn(async (to, b) => { sent.push(JSON.stringify(b)); return true; }),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
global.__fromImpl = () => { throw new Error('no DB in a pure test'); };

let tableStates;
function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, mutation: null };
  const chain = {};
  const rows = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach(m => { chain[m] = jest.fn((c, v) => { record.filters[c] = v; return chain; }); });
  chain.in = jest.fn((c, v) => { record.filters[c] = { in: v }; return chain; });
  ['filter', 'order', 'limit', 'range'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => ({ data: rows()[0] || null, error: null }));
  chain.maybeSingle = chain.single;
  chain.then = (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
  return chain;
}
function failedModuleExam({ cooldown }) {
  const vendor = { id: 'v', key: 'ISAPS', passing_pct: 60, module_passing_pct: 70, capstone_points_per_question: 10, unlock_logic: 'all_modules' };
  if (cooldown !== undefined) vendor.cooldown_hours = cooldown;
  tableStates = {
    app_settings: { rows: f => (f.key === 'isaps_crq_results_released' ? [{ key: f.key, value: true }] : []) },
    training_assessment_attempts: { rows: [{ id: 'att-1', user_id: 'u1', quiz_kind: 'grand', grand_quiz_id: 37, training_module_id: null,
      level_id: 27, program_id: 'p1', total_questions: 5, status: 'in_progress' }] },
    training_assessment_answers: { rows: [
      { question_index: 0, is_correct: true, answer_score: null }, { question_index: 1, is_correct: false, answer_score: null },
      { question_index: 2, is_correct: false, answer_score: null }, { question_index: 3, is_correct: false, answer_score: null },
      { question_index: 4, is_correct: null, answer_score: 3 }] },
    training_grand_quizzes: { rows: [{ id: 37, source_quiz_id: 901, level_id: 27, quiz_type: 'grand_quiz', is_active: true }] },
    training_levels: { rows: [{ id: 27, name: 'Level 1: Novice', vendor_id: 'v', order_index: 0 }] },
    training_vendors: { rows: [vendor] },
    training_courses: { rows: [{ id: 71, level_id: 27, title: 'Module 1 - X', order_index: 1 }] },
    training_modules: { rows: [] }, teacher_training_progress: { rows: [] }, training_certificates: { rows: [] },
    users: { rows: [{ id: 'u1', name: 'T' }] },
  };
}

describe('failed exam copy follows the vendor cooldown', () => {
  let QD;
  beforeEach(() => { jest.resetModules(); global.__fromImpl = t => makeChain(t); sent.length = 0; QD = require('../../bot/shared/services/training/quiz-delivery.service'); });

  test('cooldown_hours = 0 (I-SAPS) → retake offered now, no hours mentioned', async () => {
    failedModuleExam({ cooldown: 0 });
    await QD.gradeAttempt('att-1', '923000000000');
    const said = sent.join('\n');
    expect(said).toMatch(/Not this time/);
    expect(said).not.toMatch(/hours?\b/i);
    expect(said).toMatch(/again now|right away|now/i);
  });

  test('cooldown_hours = 48 → quotes 48, not the hardcoded 24', async () => {
    failedModuleExam({ cooldown: 48 });
    await QD.gradeAttempt('att-1', '923000000000');
    const said = sent.join('\n');
    expect(said).toMatch(/48 hours/);
    expect(said).not.toMatch(/24 hours/);
  });

  test('vendor cooldown unreadable → the historical 24 hours (fail closed)', async () => {
    failedModuleExam({ cooldown: undefined });
    await QD.gradeAttempt('att-1', '923000000000');
    expect(sent.join('\n')).toMatch(/24 hours/);
  });
});

describe('retryLine (the pure rule)', () => {
  test('0 → now; N → N hours; junk → 24', () => {
    const { retryLine, effectiveCooldownHours } = require('../../bot/shared/services/training/retry-cooldown.rules');
    expect(effectiveCooldownHours(0)).toBe(0);
    expect(effectiveCooldownHours(48)).toBe(48);
    for (const bad of [undefined, null, -1, NaN, 'x']) expect(effectiveCooldownHours(bad)).toBe(24);
    expect(retryLine(0)).not.toMatch(/hour/i);
    expect(retryLine(24)).toMatch(/\*24 hours\*/);
    expect(retryLine(1)).toMatch(/\*1 hour\*/);
  });
});
