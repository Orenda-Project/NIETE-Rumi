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
  });
});
