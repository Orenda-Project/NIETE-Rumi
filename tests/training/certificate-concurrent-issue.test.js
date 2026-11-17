/**
 * Two requests certify the same teacher's level at the same instant. The
 * database's one-per-(user, level) constraint lets exactly one insert land;
 * the other comes back "duplicate key". That second request must hand back
 * the certificate that now exists, not report a failure.
 *
 * Production (17 Nov): "Certificate insert failed — reporting NOT issued"
 * logged 41 times since 2 Nov for 32 teacher-levels, every one a duplicate
 * key on training_certificates_user_level_uniq, every one 0.1-0.3 s after the
 * winning row was written. All 32 certificates exist. The level list
 * fetches-or-issues on view, so two screens loading together race.
 *
 * What the lost race cost:
 *  - an ERROR line for a certificate that was in fact issued;
 *  - on the WhatsApp grand-quiz and capstone paths (which read the result
 *    without checking `issued`), a congratulation built from an empty result:
 *    "Congratulations, undefined! ... Certificate code: `undefined`".
 *
 * The guard (`maybeIssueQuizScoreCertificate`) keeps its contract: `issued`
 * means THIS call minted the certificate, exactly as when its own pre-read
 * finds one, so no caller sends a second congratulation.
 */

const MODULE = '../../bot/shared/services/training/certificate.service';

const DUPLICATE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "training_certificates_user_level_uniq"',
};

const WINNER = {
  certificate_code: 'CERT-20261117-WINNER',
  teacher_name_snapshot: 'Amina',
  level_name_snapshot: 'Level 2: Intermediate',
  issued_at: '2026-11-17T17:13:32.499Z',
  pdf_r2_key: 'certificates/winner.pdf',
};

/**
 * A supabase stub where training_certificates reads empty until an insert has
 * been attempted (the other request's row lands in between), then holds the
 * winner. `insertError` is what this request's insert gets back.
 */
function makeSupabase({ insertError, rows = {}, winnerAppears = true }) {
  const state = { inserted: false };
  return {
    state,
    from(table) {
      const read = () => {
        if (table === 'training_certificates') {
          return state.inserted && winnerAppears ? [WINNER] : [];
        }
        return rows[table] ? rows[table].slice() : [];
      };
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return Promise.resolve({ data: read()[0] || null, error: null }); },
        single() { return Promise.resolve({ data: read()[0] || null, error: null }); },
        insert() {
          state.inserted = true;
          return Promise.resolve({ data: null, error: insertError });
        },
        then(res, rej) { return Promise.resolve({ data: read(), error: null }).then(res, rej); },
      };
      return chain;
    },
  };
}

function load() {
  jest.resetModules();
  const logger = { logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() };
  jest.doMock('../../bot/shared/utils/logger', () => logger);
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
    generateAndStoreCertificatePdf: jest.fn().mockResolvedValue(null),
  }));
  return { svc: require(MODULE), logger };
}

const BASE_ROWS = {
  users: [{ name: 'Amina' }],
  training_levels: [{ id: 31, name: 'Level 2: Intermediate', vendor_id: 'v-chain', order_index: 2 }],
};
const ARGS = { userId: 'u-1', programId: 'p-1', levelId: 31, attemptId: null };

describe('certificate issued by a concurrent request', () => {
  afterEach(() => jest.resetModules());

  test('a duplicate-key insert returns the certificate that now exists', async () => {
    const { svc } = load();
    const sb = makeSupabase({ insertError: DUPLICATE, rows: BASE_ROWS });
    const out = await svc.issueCertificate(sb, ARGS);
    expect(out.issued).not.toBe(false);
    expect(out.already_issued).toBe(true);
    expect(out.certificate_code).toBe(WINNER.certificate_code);
    expect(out.teacher_name).toBe(WINNER.teacher_name_snapshot);
    expect(out.level_name).toBe(WINNER.level_name_snapshot);
    expect(out.pdf_r2_key).toBe(WINNER.pdf_r2_key);
  });

  test('a lost race is not logged as a failed insert', async () => {
    const { svc, logger } = load();
    const sb = makeSupabase({ insertError: DUPLICATE, rows: BASE_ROWS });
    await svc.issueCertificate(sb, ARGS);
    const errorLines = logger.logError.mock.calls.map(c => c[0]);
    expect(errorLines).not.toContain('Certificate insert failed — reporting NOT issued');
  });

  test('a duplicate key with no row to read back is still reported as not issued', async () => {
    const { svc, logger } = load();
    const sb = makeSupabase({ insertError: DUPLICATE, rows: BASE_ROWS, winnerAppears: false });
    const out = await svc.issueCertificate(sb, ARGS);
    expect(out.issued).toBe(false);
    expect(out.reason).toBe('insert_failed');
    expect(out.certificate_code).toBeUndefined();
    expect(logger.logError).toHaveBeenCalled();
  });

  test('any other insert error is still reported as not issued', async () => {
    const { svc } = load();
    const sb = makeSupabase({
      insertError: { code: '23502', message: 'null value in column "program_id" violates not-null constraint' },
      rows: BASE_ROWS,
    });
    const out = await svc.issueCertificate(sb, ARGS);
    expect(out.issued).toBe(false);
    expect(out.reason).toBe('insert_failed');
  });

  test('the guard does not report a race it lost as a new certificate (no second congratulation)', async () => {
    const { svc } = load();
    const sb = makeSupabase({
      insertError: DUPLICATE,
      rows: {
        ...BASE_ROWS,
        training_vendors: [{ id: 'v-chain', unlock_logic: 'chain' }],
        training_grand_quizzes: [{ id: 'gq-1', quiz_type: 'grand_quiz' }],
        training_assessment_attempts: [{ id: 'att-1', program_id: 'p-1', completed_at: '2026-11-17T17:00:00Z', grand_quiz_id: 'gq-1' }],
      },
    });
    const out = await svc.maybeIssueQuizScoreCertificate(sb, { userId: 'u-1', levelId: 31, attemptId: null, programId: 'p-1' });
    expect(out.issued).toBe(false);
    // ...but it does say she holds it, so a screen can show the level certified.
    expect(out.already_issued).toBe(true);
  });
});

// ─── the level list that LOST the race still reads "certified" ───────────────────────────────────────────────────
// The real endpoint and the real guard, against a PostgREST-shaped stub whose insert behaves like the race: the
// other request's row lands first and this insert gets the duplicate key. Same harness as the certify-on-view suite.
describe('the level list that lost the race', () => {
  let tables;
  function from(table) {
    const eqs = {}; const ins = {};
    let order = null;
    const run = () => {
      let out = tables[table] || [];
      for (const [c, v] of Object.entries(eqs)) out = out.filter(r => r[c] === v);
      for (const [c, v] of Object.entries(ins)) out = out.filter(r => v.includes(r[c]));
      if (order) out = [...out].sort((a, b) => (a[order] < b[order] ? -1 : a[order] > b[order] ? 1 : 0));
      return out;
    };
    const q = {
      select() { return q; },
      eq(c, v) { eqs[c] = v; return q; },
      in(c, v) { ins[c] = v; return q; },
      order(c) { order = c; return q; },
      limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: run()[0] || null, error: null }); },
      insert(row) {
        if (table === 'training_certificates') {
          // The other request's row lands first; this one is the duplicate.
          tables.training_certificates.push({ ...row, certificate_code: WINNER.certificate_code, issued_at: WINNER.issued_at });
          return Promise.resolve({ error: DUPLICATE });
        }
        return Promise.resolve({ error: null });
      },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return q;
  }

  function loadEndpoint() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({
      logEvent: jest.fn(), getCurrentCorrelationId: () => null,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: (t) => from(t), rpc: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
    jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
      generateAndStoreCertificatePdf: jest.fn().mockResolvedValue(null),
    }));
    return require('../../bot/shared/routes/teacher-training-endpoint');
  }

  test('a level another request just certified reads certified, not open', async () => {
    const exams = []; const passes = [];
    for (let i = 1; i <= 9; i += 1) {
      exams.push({ id: 100 + i, level_id: 27, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 900 + i });
      passes.push({ user_id: 'u1', level_id: 27, quiz_kind: 'grand', grand_quiz_id: 100 + i, is_passed: true, status: 'passed' });
    }
    tables = {
      teacher_training_assignments: [{ user_id: 'u1', program_id: 'p-mh', is_active: true }],
      training_program_scopes: [{ program_id: 'p-mh', vendor_id: 'is', level_ids: null }],
      training_vendors: [{ id: 'is', key: 'ISAPS', name: 'I-SAPS', unlock_logic: 'all_modules', level_unlock_logic: 'parallel' }],
      training_levels: [
        { id: 27, name: 'Level 1: Novice', vendor_id: 'is', order_index: 0, is_active: true },
        { id: 28, name: 'Level 2: Intermediate', vendor_id: 'is', order_index: 1, is_active: true },
      ],
      training_courses: [{ id: 270, level_id: 27, is_active: true }, { id: 280, level_id: 28, is_active: true }],
      training_modules: [{ id: 2701, course_id: 270, is_active: true }, { id: 2801, course_id: 280, is_active: true }],
      teacher_training_progress: [{ user_id: 'u1', module_id: 2701 }],
      training_assessment_attempts: passes,
      training_grand_quizzes: exams,
      training_certificates: [],
      training_questions: [],
      app_settings: [{ key: 'isaps_crq_results_released', value: true }],
      users: [{ id: 'u1', name: 'Sana' }],
    };
    const levels = await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    expect(tables.training_certificates).toHaveLength(1);
    expect(levels.find(l => l.id === 27).state).toBe('certified');
  });
});
