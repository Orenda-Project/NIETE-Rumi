/**
 * bd-fj1fdi — a level the teacher holds a certificate for never reads "locked".
 *
 * loadVisibleLevelsWithProgress decided a level's state in this order:
 *
 *     if (chainLocked && !prevPassed && !isFirst) state = 'locked';
 *     else if (passedAttempt || certified)         state = 'certified';
 *
 * so the chain lock was asked BEFORE the certificate. That only bites when a
 * level below a certified one comes into view after the fact, and on NIETE
 * production that is exactly what happens: niete_middle_high scopes NIETE to
 * levels {3, 4} (Skilled Practitioner, Teacher Leader), so a middle/high
 * teacher's ladder starts at Skilled Practitioner and she certifies there with
 * nothing below. Adding niete_primary (scope: every NIETE level) puts Aspiring
 * Teacher and Emerging Practitioner in view, Emerging Practitioner is unpassed,
 * and her certified Skilled Practitioner flips to "🔒 Locked · Pass L2 first"
 * while the certificate itself still lists and downloads.
 *
 * Production, read-only, 11 Nov 2026: 20 live users, every one at Skilled
 * Practitioner with its certificate (logs in Investigations pk-ict/onboarding/
 * bd-97daxo-gb-region-niete/outputs/bd-fj1fdi-cert-before-lock-2026-11-11/).
 * This seed is the shape of one of them: both programmes, a certificate and a
 * passed exam at Skilled Practitioner, nothing at Levels 1-2.
 *
 * A finished level is terminal: a certificate (or a passed level exam) wins
 * over the chain lock, exactly as it already satisfies the NEXT level's lock
 * (bd-43812). The lower, unfinished levels keep their own state.
 */

let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, isCount: false, orderCol: null, orderDir: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const rowsNow = () => applyFilters(state.rows || []);
  const finalize = () => {
    const r = rowsNow();
    if (record.isCount) return { count: r.length, data: null, error: null };
    return { data: r[0] || null, error: null };
  };
  const finalizeMany = () => {
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
  chain.insert = jest.fn(() => chain);
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

const UID = 'u-fj1fdi';
const NIETE = 'v-taleemabad';
// NIETE's real level ids and 0-based order (training_levels on production).
const ASPIRING = 1;   // order 0
const EMERGING = 2;   // order 1
const SKILLED = 3;    // order 2 — the level that read "locked"
const LEADER = 4;     // order 3
const PRIMARY = 'p-niete-primary';
const MIDHIGH = 'p-niete-middle-high';

let maybeIssue;

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn(), PutObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
  jest.doMock('exceljs', () => ({ Workbook: jest.fn() }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('bullmq', () => ({ Queue: jest.fn(), Worker: jest.fn() }), { virtual: true });
  jest.doMock('aws-sdk', () => ({ SQS: jest.fn() }), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => makeChain(t)), rpc: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));
  // Fetch-or-issue on view (bd-arghnv.1) is not under test: nothing in these
  // seeds qualifies, and the spy proves no certificate is minted along the way.
  maybeIssue = jest.fn(async () => ({ issued: false }));
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({ maybeIssueQuizScoreCertificate: maybeIssue }));
});

afterEach(() => jest.resetModules());

/**
 * One NIETE ladder of four chain-locked levels, one course of two modules
 * each, reached through BOTH programmes as on production.
 */
function seed({ certificates = [], attempts = [], done = [], programmes = [PRIMARY, MIDHIGH] } = {}) {
  tableStates.teacher_training_assignments = { rows: programmes.map(p => ({ user_id: UID, program_id: p, is_active: true })) };
  tableStates.training_program_scopes = { rows: [
    { program_id: PRIMARY, vendor_id: NIETE, level_ids: null },
    { program_id: MIDHIGH, vendor_id: NIETE, level_ids: [SKILLED, LEADER] },
  ] };
  tableStates.training_vendors = { rows: [{
    id: NIETE, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', level_unlock_logic: 'chain',
    module_unlock_logic: 'chain', has_grand_quiz: true,
  }] };
  tableStates.training_levels = { rows: [
    { id: ASPIRING, vendor_id: NIETE, name: 'Aspiring Teacher', order_index: 0, cpd_level: null, is_active: true },
    { id: EMERGING, vendor_id: NIETE, name: 'Emerging Practitioner', order_index: 1, cpd_level: null, is_active: true },
    { id: SKILLED, vendor_id: NIETE, name: 'Skilled Practitioner', order_index: 2, cpd_level: null, is_active: true },
    { id: LEADER, vendor_id: NIETE, name: 'Teacher Leader', order_index: 3, cpd_level: null, is_active: true },
  ] };
  tableStates.training_courses = { rows: [ASPIRING, EMERGING, SKILLED, LEADER].map(l => ({ id: l * 10, level_id: l, is_active: true })) };
  tableStates.training_modules = { rows: [ASPIRING, EMERGING, SKILLED, LEADER].flatMap(l => [
    { id: l * 100 + 1, course_id: l * 10, is_active: true },
    { id: l * 100 + 2, course_id: l * 10, is_active: true },
  ]) };
  tableStates.teacher_training_progress = { rows: done.map(id => ({ user_id: UID, module_id: id })) };
  tableStates.training_assessment_attempts = { rows: attempts.map(a => ({ user_id: UID, ...a })) };
  tableStates.training_grand_quizzes = { rows: [ASPIRING, EMERGING, SKILLED, LEADER].map(l => ({
    id: l + 4, level_id: l, quiz_type: 'grand_quiz', source_quiz_id: null, is_active: true,
  })) };
  tableStates.training_certificates = { rows: certificates.map(l => ({ user_id: UID, level_id: l })) };
}

const ep = () => require('../../bot/shared/routes/teacher-training-endpoint');
const stateOf = async (levelId) => (await ep().loadVisibleLevelsWithProgress(UID)).find(l => l.id === levelId).state;

// The production shape: Skilled Practitioner certified off its exam (grand
// quiz 7), every module done, nothing at Levels 1-2.
const SKILLED_DONE = [SKILLED * 100 + 1, SKILLED * 100 + 2];
const SKILLED_PASS = { level_id: SKILLED, quiz_kind: 'grand', grand_quiz_id: SKILLED + 4, is_passed: true, status: 'passed', completed_at: '2026-04-17T10:00:00Z' };

describe('bd-fj1fdi — a certified level is not chain-locked by an unpassed level below it', () => {
  it('shows Skilled Practitioner as certified, not locked (the production case)', async () => {
    seed({ certificates: [SKILLED], attempts: [SKILLED_PASS], done: SKILLED_DONE });
    expect(await stateOf(SKILLED)).toBe('certified');
  });

  it('shows it certified on the certificate alone, with no exam attempt behind it (bd-43811 backfill rows)', async () => {
    seed({ certificates: [SKILLED] });
    expect(await stateOf(SKILLED)).toBe('certified');
  });

  it('shows it certified on a passed level exam whose certificate is not on record yet', async () => {
    seed({ attempts: [SKILLED_PASS], done: SKILLED_DONE });
    expect(await stateOf(SKILLED)).toBe('certified');
  });

  it('lets her open it: checkLevelUnlocked says ok, not 403', async () => {
    seed({ certificates: [SKILLED], attempts: [SKILLED_PASS], done: SKILLED_DONE });
    const gate = await ep().checkLevelUnlocked(UID, SKILLED);
    expect(gate.ok).toBe(true);
    expect(gate.status).toBeUndefined();
  });

  it('still refuses a re-sit of its exam, as already passed rather than locked', async () => {
    seed({ certificates: [SKILLED], attempts: [SKILLED_PASS], done: SKILLED_DONE });
    const gate = await ep().assertCanStartExamForLevel(UID, SKILLED);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('already_passed');
  });

  it('leaves every other level as it was: Level 1 open, Level 2 locked, Teacher Leader open', async () => {
    seed({ certificates: [SKILLED], attempts: [SKILLED_PASS], done: SKILLED_DONE });
    const levels = await ep().loadVisibleLevelsWithProgress(UID);
    const byId = Object.fromEntries(levels.map(l => [l.id, l.state]));
    expect(byId).toEqual({
      [ASPIRING]: 'not_started',
      [EMERGING]: 'locked',          // Aspiring Teacher is unpassed — the chain still holds below
      [SKILLED]: 'certified',
      [LEADER]: 'not_started',       // already opened by Skilled's certificate (bd-43812)
    });
    expect(maybeIssue).not.toHaveBeenCalled();
  });

  it('still locks an UNcertified level behind an unpassed one — the chain itself is unchanged', async () => {
    seed({ done: SKILLED_DONE });
    expect(await stateOf(SKILLED)).toBe('locked');
  });

  it('does not count a passed MODULE quiz as finishing the level (bd-2391)', async () => {
    seed({ attempts: [{ ...SKILLED_PASS, quiz_kind: 'training_module' }], done: SKILLED_DONE });
    expect(await stateOf(SKILLED)).toBe('locked');
  });

  it('is unchanged for a middle/high-only teacher, whose ladder starts at Skilled Practitioner', async () => {
    seed({ certificates: [SKILLED], attempts: [SKILLED_PASS], done: SKILLED_DONE, programmes: [MIDHIGH] });
    const levels = await ep().loadVisibleLevelsWithProgress(UID);
    expect(levels.map(l => [l.id, l.state])).toEqual([[SKILLED, 'certified'], [LEADER, 'not_started']]);
  });
});
