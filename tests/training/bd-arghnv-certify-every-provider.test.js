/**
 * bd-arghnv.1 / .2 — the app certifies every provider, once that provider's level is complete.
 *
 * Found walking the training as a teacher on staging (31 Oct), confirmed on production:
 *
 *   Beacon House  a written exam passed IN THE APP issued no certificate. The guard returned "no" for any level with
 *                 a capstone, because the WhatsApp capstone used to issue its own; the app's capstone asks the guard.
 *                 Production: 124 levels for 64 teachers uncertified, the last Beacon House certificate on 10 Oct.
 *   I-SAPS        one passed MODULE exam made the level list say "Certified" and open Level 2: the list counted the
 *                 nine per-module exams as level exams. Production: 235 teachers shown Certified with no certificate.
 *
 * The rules, as decided (operator, 2 Nov): exams happen in the app only; a certificate issues once all of that
 * provider's requirements for the level are met; I-SAPS locks the CERTIFICATE, not the level — Level 2 is open,
 * but its certificate needs the Level 1 certificate first. And the app fetches-or-issues: a level that qualifies
 * and has no certificate gets one the next time she looks, so a gap like the Beacon House one mends itself.
 *
 * Both halves run the REAL code against a stubbed Supabase (the bd-60139 lesson: rules-only tests passed over a
 * shipped bug).
 */

// ─── a PostgREST-shaped stub that returns real rows ─────────────────────────────────────────────────────────────
let tables;
let inserts;

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
      inserts.push({ table, row });
      (tables[table] = tables[table] || []).push({ ...row, issued_at: '2026-11-02T10:00:00Z' });
      return Promise.resolve({ error: null });
    },
    then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
  };
  return q;
}
const supabase = { from: (t) => from(t), rpc: jest.fn() };

function loadGuard() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  // The PDF is best-effort and has its own suites; here it must not touch R2.
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
    generateAndStoreCertificatePdf: jest.fn().mockResolvedValue(null),
  }));
  return require('../../bot/shared/services/training/certificate.service');
}
const issued = () => inserts.filter(i => i.table === 'training_certificates');

beforeEach(() => { inserts = []; });

// ─── Beacon House: the capstone pass certifies, in the app ───────────────────────────────────────────────────────
describe('Beacon House — a passed written exam plus every part done issues the certificate', () => {
  function seed({ passed = true, allParts = true } = {}) {
    tables = {
      training_levels: [{ id: 8, name: 'English', vendor_id: 'bh', order_index: 0 }],
      training_vendors: [{ id: 'bh', key: 'BEACONHOUSE', unlock_logic: 'all_modules', level_unlock_logic: 'parallel' }],
      training_grand_quizzes: [{ id: 11, level_id: 8, quiz_type: 'capstone', is_active: true, source_quiz_id: 8 }],
      training_courses: [{ id: 80, level_id: 8, is_active: true }],
      training_modules: [{ id: 801, course_id: 80, is_active: true }, { id: 802, course_id: 80, is_active: true }],
      teacher_training_progress: allParts
        ? [{ user_id: 'u1', module_id: 801 }, { user_id: 'u1', module_id: 802 }]
        : [{ user_id: 'u1', module_id: 801 }],
      training_assessment_attempts: [
        { id: 'cap-fail', user_id: 'u1', level_id: 8, quiz_kind: 'capstone', grand_quiz_id: 11, is_passed: false, program_id: 'p-mh', completed_at: '2026-10-20T09:00:00Z' },
        ...(passed ? [
          { id: 'cap-2', user_id: 'u1', level_id: 8, quiz_kind: 'capstone', grand_quiz_id: 11, is_passed: true, program_id: 'p-mh', completed_at: '2026-10-25T09:00:00Z' },
          { id: 'cap-1', user_id: 'u1', level_id: 8, quiz_kind: 'capstone', grand_quiz_id: 11, is_passed: true, program_id: 'p-mh', completed_at: '2026-10-21T09:00:00Z' },
        ] : []),
      ],
      training_certificates: [],
      users: [{ id: 'u1', name: 'Sana' }],
    };
  }

  test('THE BUG: a pass in the app with every part done is certified', async () => {
    seed();
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    const r = await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 8, programId: 'p-mh' });
    expect(r.issued).toBe(true);
    expect(issued()).toHaveLength(1);
    // Cites the FIRST passing attempt: the date she first earned it.
    expect(issued()[0].row.attempt_id).toBe('cap-1');
  });

  test('the programme comes from her passing attempt when the caller has none', async () => {
    seed();
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 8, programId: null });
    expect(issued()[0].row.program_id).toBe('p-mh');
  });

  test('no passed written exam → no certificate', async () => {
    seed({ passed: false });
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    const r = await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 8, programId: 'p-mh' });
    expect(r.issued).toBe(false);
    expect(issued()).toHaveLength(0);
  });

  test('a part not done → no certificate yet', async () => {
    seed({ allParts: false });
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    const r = await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 8, programId: 'p-mh' });
    expect(r.issued).toBe(false);
    expect(issued()).toHaveLength(0);
  });

  test('already certified → no second certificate', async () => {
    seed();
    tables.training_certificates.push({ user_id: 'u1', level_id: 8, certificate_code: 'X' });
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 8, programId: 'p-mh' });
    expect(issued()).toHaveLength(0);
  });
});

// ─── I-SAPS: the certificate is the lock — Level 2's needs Level 1's ─────────────────────────────────────────────
describe('I-SAPS — a level certificate needs the previous level certificate', () => {
  function seed({ l1Cert }) {
    const exams = [];
    const passes = [];
    for (let i = 1; i <= 9; i += 1) {
      exams.push({ id: 100 + i, level_id: 28, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 909 + i });
      passes.push({ user_id: 'u1', level_id: 28, quiz_kind: 'grand', grand_quiz_id: 100 + i, is_passed: true });
    }
    tables = {
      training_levels: [
        { id: 27, name: 'Level 1: Novice', vendor_id: 'is', order_index: 0, is_active: true },
        { id: 28, name: 'Level 2: Intermediate', vendor_id: 'is', order_index: 1, is_active: true },
      ],
      training_vendors: [{ id: 'is', key: 'ISAPS', unlock_logic: 'all_modules', level_unlock_logic: 'parallel' }],
      training_grand_quizzes: exams,
      training_assessment_attempts: passes,
      training_certificates: l1Cert ? [{ user_id: 'u1', level_id: 27, certificate_code: 'L1' }] : [],
      app_settings: [{ key: 'isaps_crq_results_released', value: true }],
      users: [{ id: 'u1', name: 'Sana' }],
    };
  }

  test('THE RULE: all nine Level 2 exams passed but no Level 1 certificate → not issued', async () => {
    seed({ l1Cert: false });
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    const r = await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 28, programId: 'p-is' });
    expect(r.issued).toBe(false);
    expect(r.reason).toBe('previous_level');
    expect(issued()).toHaveLength(0);
  });

  test('with the Level 1 certificate → Level 2 is issued', async () => {
    seed({ l1Cert: true });
    const { maybeIssueQuizScoreCertificate } = loadGuard();
    const r = await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 28, programId: 'p-is' });
    expect(r.issued).toBe(true);
    expect(issued()).toHaveLength(1);
  });
});

// ─── the level list: "Certified" means certified, and a qualifying level is issued on view ───────────────────────
// The REAL guard runs here too, against the same stub: the signal is the certificate row written (or not), and the
// state the list returns. (A mocked guard was tried first; reading its calls proved order-sensitive in a full run.)
describe('the level list (app + WhatsApp)', () => {
  function loadEndpoint() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({
      logEvent: jest.fn(), getCurrentCorrelationId: () => null,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    }));
    jest.doMock('../../bot/shared/config/supabase', () => supabase);
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
    jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
      generateAndStoreCertificatePdf: jest.fn().mockResolvedValue(null),
    }));
    return require('../../bot/shared/routes/teacher-training-endpoint');
  }

  function seedIsaps({ examsPassed }) {
    const exams = [];
    const passes = [];
    for (let i = 1; i <= 9; i += 1) {
      exams.push({ id: 100 + i, level_id: 27, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 900 + i });
      if (i <= examsPassed) passes.push({ user_id: 'u1', level_id: 27, quiz_kind: 'grand', grand_quiz_id: 100 + i, is_passed: true, status: 'passed' });
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
  }

  test('THE BUG: one module exam of nine passed is NOT "certified"', async () => {
    seedIsaps({ examsPassed: 1 });
    const levels = await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    expect(levels.find(l => l.id === 27).state).not.toBe('certified');
    expect(issued()).toHaveLength(0);
  });

  test('Level 2 stays open: the lock is on the certificate, not the level', async () => {
    seedIsaps({ examsPassed: 1 });
    const levels = await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    expect(levels.find(l => l.id === 28).state).not.toBe('locked');
  });

  test('fetch-or-issue: all nine passed and no certificate → issued on view, and the level reads certified', async () => {
    seedIsaps({ examsPassed: 9 });
    const levels = await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    expect(issued()).toHaveLength(1);
    expect(issued()[0].row).toEqual(expect.objectContaining({ user_id: 'u1', level_id: 27, program_id: 'p-mh' }));
    expect(levels.find(l => l.id === 27).state).toBe('certified');
  });

  test('fetch-or-issue asks only about levels that could qualify', async () => {
    seedIsaps({ examsPassed: 3 });
    const touched = [];
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => { touched.push(t); return from(t); });
    await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    spy.mockRestore();
    // The list reads training_certificates once (its own read); the guard would read it again.
    expect(touched.filter(t => t === 'training_certificates')).toHaveLength(1);
    expect(issued()).toHaveLength(0);
  });

  test('a level that already holds its certificate is a fetch, not a re-check', async () => {
    seedIsaps({ examsPassed: 9 });
    tables.training_certificates.push({ user_id: 'u1', level_id: 27, certificate_code: 'OLD' });
    const touched = [];
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => { touched.push(t); return from(t); });
    const levels = await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    spy.mockRestore();
    expect(touched.filter(t => t === 'training_certificates')).toHaveLength(1);
    expect(issued()).toHaveLength(0);
    expect(levels.find(l => l.id === 27).state).toBe('certified');
  });

  test('Beacon House: a passed written exam with no certificate is issued on view', async () => {
    tables = {
      teacher_training_assignments: [{ user_id: 'u1', program_id: 'p-mh', is_active: true }],
      training_program_scopes: [{ program_id: 'p-mh', vendor_id: 'bh', level_ids: null }],
      training_vendors: [{ id: 'bh', key: 'BEACONHOUSE', name: 'BH', unlock_logic: 'all_modules', level_unlock_logic: 'parallel' }],
      training_levels: [{ id: 8, name: 'English', vendor_id: 'bh', order_index: 0, is_active: true }],
      training_courses: [{ id: 80, level_id: 8, is_active: true }],
      training_modules: [{ id: 801, course_id: 80, is_active: true }],
      teacher_training_progress: [{ user_id: 'u1', module_id: 801 }],
      training_assessment_attempts: [{ id: 'cap-1', user_id: 'u1', level_id: 8, quiz_kind: 'capstone', grand_quiz_id: 11, is_passed: true, status: 'passed', program_id: 'p-mh', completed_at: '2026-10-21T09:00:00Z' }],
      training_grand_quizzes: [{ id: 11, level_id: 8, quiz_type: 'capstone', is_active: true, source_quiz_id: 8 }],
      training_certificates: [],
      training_questions: [],
      users: [{ id: 'u1', name: 'Sana' }],
    };
    const levels = await loadEndpoint().loadVisibleLevelsWithProgress('u1');
    expect(issued()).toHaveLength(1);
    expect(issued()[0].row).toEqual(expect.objectContaining({ level_id: 8, program_id: 'p-mh', attempt_id: 'cap-1' }));
    expect(levels.find(l => l.id === 8).state).toBe('certified');
  });
});
