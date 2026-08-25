/**
 * bd-2391 — a passed MODULE quiz must not certify the LEVEL.
 *
 * `training_assessment_attempts` holds both kinds of quiz — the per-module
 * "quick check" (quiz_kind='training_module') and the level exam
 * (quiz_kind='grand') — and BOTH carry a level_id. The level-passed checks
 * matched on `level_id + is_passed` without looking at quiz_kind, so acing a
 * single 9-question module check marked the whole level `certified`.
 *
 * Consequences seen in production on a real account:
 *   - the level card read "9/9 courses ✓ · Exam passed" with a "Review" CTA,
 *     so the grand quiz was unreachable — there was nothing left to take
 *   - the next level chain-unlocked off a module quiz
 *
 * The portal's grand-quiz gate (_loadGrandQuizGate) already filtered by kind
 * and carried a comment "flagged for backport to the Flow". This is that
 * backport, plus the two remaining unfiltered sites.
 *
 * Contract: only a quiz_kind='grand' attempt with is_passed=true may make a
 * level `certified` or satisfy a chain-lock's previous-level requirement.
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: applyFilters(rows)[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    rows = applyFilters(rows);
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -1 * dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn(() => chain);
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

const V_NIETE = 'v-niete';
const UID = 'u1';

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  supabaseFrom = jest.fn((t) => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));
});

afterEach(() => jest.resetModules());

/**
 * Two NIETE levels, both fully "started" (so they'd be ready_for_quiz), each
 * with a real grand quiz. The teacher has ONE passed module-quiz attempt on
 * level 3 — and no grand attempt anywhere.
 */
function seed({ moduleAttemptPassed = true } = {}) {
  tableStates.teacher_training_assignments = {
    rows: [{ user_id: UID, program_id: 'p1', is_active: true }],
  };
  tableStates.training_program_scopes = {
    rows: [{ program_id: 'p1', vendor_id: V_NIETE, level_ids: [3, 4] }],
  };
  tableStates.training_vendors = {
    rows: [{ id: V_NIETE, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true }],
  };
  tableStates.training_levels = {
    rows: [
      { id: 3, name: 'Skilled Practitioner', order_index: 2, vendor_id: V_NIETE, is_active: true, cpd_level: null },
      { id: 4, name: 'Teacher Leader', order_index: 3, vendor_id: V_NIETE, is_active: true, cpd_level: null },
    ],
  };
  tableStates.training_courses = {
    rows: [
      { id: 21, level_id: 3, is_active: true },
      { id: 30, level_id: 4, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [
      { id: 104, course_id: 21, is_active: true },
      { id: 300, course_id: 30, is_active: true },
    ],
  };
  // Level 3's only course has a completed module → level 3 is fully "started".
  tableStates.teacher_training_progress = {
    rows: [{ user_id: UID, module_id: 104, module: { course_id: 21 } }],
  };
  // The crux: a MODULE attempt, passed, carrying level_id=3. No grand attempt.
  tableStates.training_assessment_attempts = {
    rows: [{
      user_id: UID, level_id: 3, quiz_kind: 'training_module',
      training_module_id: 104, grand_quiz_id: null,
      status: moduleAttemptPassed ? 'passed' : 'failed',
      is_passed: moduleAttemptPassed, cooldown_until: null,
      completed_at: '2026-07-31T14:51:09Z',
    }],
  };
  tableStates.training_grand_quizzes = {
    rows: [
      { id: 7, level_id: 3, quiz_type: 'grand_quiz', is_active: true },
      { id: 4, level_id: 4, quiz_type: 'grand_quiz', is_active: true },
    ],
  };
  tableStates.training_questions = { rows: [] };
}

describe('bd-2391 — WhatsApp Flow: level state', () => {
  test('a passed module quiz does NOT make the level certified', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);
    const lv3 = levels.find(l => l.id === 3);

    expect(lv3).toBeDefined();
    expect(lv3.state).not.toBe('certified');
    expect(lv3.state).toBe('ready_for_quiz');
  });

  test('a passed module quiz does NOT chain-unlock the next level', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);
    const lv4 = levels.find(l => l.id === 4);

    expect(lv4).toBeDefined();
    expect(lv4.state).toBe('locked');
  });

  test('a real passed GRAND attempt does certify the level', async () => {
    seed();
    tableStates.training_assessment_attempts.rows.push({
      user_id: UID, level_id: 3, quiz_kind: 'grand', grand_quiz_id: 7,
      training_module_id: null, status: 'passed', is_passed: true,
      cooldown_until: null, completed_at: '2026-07-31T15:00:00Z',
    });
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    expect(levels.find(l => l.id === 3).state).toBe('certified');
    // …and only then does the next level open up.
    expect(levels.find(l => l.id === 4).state).not.toBe('locked');
  });
});

describe('bd-2391 — WhatsApp Flow: LEVEL_DETAIL grand-quiz gate', () => {
  test('the exam is still offered when only a module quiz was passed', async () => {
    seed();
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const gate = await ep.loadGrandQuizState(UID, 3);

    // Must not report the level as already passed.
    const blob = JSON.stringify(gate);
    expect(blob).not.toMatch(/passed/i);
  });
});

/**
 * bd-43812 — a held certificate must satisfy the chain-lock, not just the badge.
 *
 * THE BUG THIS ENCODES
 * --------------------
 * `loadVisibleLevelsWithProgress` decided two things about a level six lines
 * apart, and they disagreed about what counts as finishing it:
 *
 *   state === 'certified'  ←  a passing exam attempt OR a certificate  (bd-2503)
 *   prevPassed             ←  a passing exam attempt ONLY
 *
 * So a teacher holding a certificate with no matching attempt row was shown as
 * certified at level N and simultaneously LOCKED out of level N+1 — the badge
 * said done, the next level said "Pass Level N's grand quiz first". That is the
 * partner-sheet report "she has the certificate but it says pass the grand quiz
 * first" (Middle and High r33, Gulnaz), and on production it is 65 NIETE
 * certificates across 65 teachers, 47 of whom have a next level to be locked
 * out of.
 *
 * How they get there legitimately: bd-2234's module-score path issues a
 * certificate off completed modules with no exam attempt at all, and the
 * bd-43811 backfill wrote 912 more with a null attempt_id. Those certificates
 * are real; the lock reading past them is the defect.
 *
 * WHY THE FIXTURE HAD TO GROW
 * ---------------------------
 * `seed()` above never populated `training_certificates`, so every assertion in
 * this file ran with zero certificates in the world and the certificate branch
 * of the chain-lock was unreachable by construction. That is precisely why the
 * split survived bd-2391 and bd-2503. These tests seed it.
 *
 * The guard tests matter as much as the fix: a certificate must NOT rescue a
 * level whose own requirement is unmet, and a module quiz still must not
 * unlock anything (the bd-2391 contract above stays intact).
 */
describe('bd-43812 — a certificate satisfies the chain-lock', () => {
  /** A certificate for `levelId` with no attempt behind it — the real shape. */
  function certifyLevel(levelId) {
    tableStates.training_certificates = {
      rows: [{
        user_id: UID, level_id: levelId, attempt_id: null,
        certificate_code: `NIETE-2026-L${levelId}`,
      }],
    };
  }

  test('a certificate on the previous level UNLOCKS the next one', async () => {
    seed();
    // Gulnaz's shape: certified at level 3 by module scores, no grand attempt.
    certifyLevel(3);
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    expect(levels.find(l => l.id === 3).state).toBe('certified');
    // The whole bug: this was 'locked' while the level below read 'certified'.
    expect(levels.find(l => l.id === 4).state).not.toBe('locked');
  });

  test('the two decisions agree — certified below can never mean locked above', async () => {
    seed();
    certifyLevel(3);
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    const lv3 = levels.find(l => l.id === 3);
    const lv4 = levels.find(l => l.id === 4);
    // Stated as the invariant rather than the symptom, so any future rewrite of
    // either branch has to keep them in step.
    if (lv3.state === 'certified') expect(lv4.state).not.toBe('locked');
  });

  test('the shared level gate agrees with the card the teacher is looking at', async () => {
    seed();
    certifyLevel(3);
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const gate = await ep.checkLevelUnlocked(UID, 4);

    // checkLevelUnlocked derives from the same catalogue, so a refusal here
    // would contradict the badge — which is how the portal and the Flow ended
    // up telling the teacher two different things.
    expect(gate.ok).toBe(true);
  });

  test('a certificate does NOT rescue a level whose OWN requirement is unmet', async () => {
    seed();
    // Certificate two levels down; level 3 still has no pass of any kind.
    certifyLevel(1);
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    // Level 4's predecessor is level 3, which is neither passed nor certified.
    expect(levels.find(l => l.id === 4).state).toBe('locked');
  });

  test('bd-2391 still holds — a module quiz alone unlocks nothing', async () => {
    seed();
    tableStates.training_certificates = { rows: [] };
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');
    const levels = await ep.loadVisibleLevelsWithProgress(UID);

    expect(levels.find(l => l.id === 4).state).toBe('locked');
  });
});
