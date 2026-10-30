'use strict';
/**
 * bd-jtgjt8.1 — a passed LEVEL EXAM on a chain vendor (NIETE L0-L3) must certify the level when the
 * decision goes through the shared guard, maybeIssueQuizScoreCertificate.
 *
 * Since 6 Oct the portal's level-exam submit no longer calls issueCertificate itself: it asks the bot
 * (POST /api/internal/training/certify-level), which runs this guard. The guard returned
 * { issued: false } for every chain vendor, so no NIETE level passed in the teacher app was certified —
 * 158 passes by 125 teachers, none at all since 12 Oct (ICT feedback sheet, Primary TT rows 26-27).
 */
jest.mock('../../shared/services/training/certificate-pdf.service', () => ({
  generateAndStoreCertificatePdf: jest.fn(async () => null),
}));

const { tableDouble } = require('../helpers/table-double');
const { maybeIssueQuizScoreCertificate } = require('../../shared/services/training/certificate.service');

const USER = 'u-peroz';
const CHAIN = 'v-niete';
const OXBRIDGE = 'v-oxbridge';

function world(extra = {}) {
  return tableDouble({
    users: [{ id: USER, name: 'Peroz Ahmad' }],
    training_vendors: [
      { id: CHAIN, key: 'TALEEMABAD', unlock_logic: 'chain' },
      { id: OXBRIDGE, key: 'OXBRIDGE', unlock_logic: 'all_modules' },
    ],
    training_levels: [
      { id: 3, name: 'Skilled Practitioner', vendor_id: CHAIN },
      { id: 17, name: 'Game-Based Teaching', vendor_id: OXBRIDGE },
    ],
    training_courses: [
      { id: 30, level_id: 3, is_active: true },
      { id: 170, level_id: 17, is_active: true },
    ],
    training_modules: [
      { id: 301, course_id: 30, is_active: true },
      { id: 1701, course_id: 170, is_active: true },
    ],
    training_grand_quizzes: [
      { id: 'gq-l2', level_id: 3, quiz_type: 'grand_quiz', source_quiz_id: 12, is_active: true },
      { id: 'dq-l2', level_id: 3, quiz_type: 'diagnostic', source_quiz_id: 13, is_active: true },
    ],
    teacher_training_progress: [],
    training_assessment_attempts: [],
    training_certificates: [],
    ...extra,
  });
}

const passedExam = (over = {}) => ({
  id: 'att-l2-pass', user_id: USER, level_id: 3, program_id: 'p-primary', quiz_kind: 'grand',
  grand_quiz_id: 'gq-l2', status: 'passed', is_passed: true, score: 17, total_questions: 20,
  completed_at: '2026-10-25T10:28:38.071Z', ...over,
});

describe('bd-jtgjt8.1 chain vendor: the level exam is the certification rule', () => {
  test('a passed level exam certifies the level (the portal certify-level call)', async () => {
    const db = world({ training_assessment_attempts: [passedExam()] });

    const res = await maybeIssueQuizScoreCertificate(db, {
      userId: USER, levelId: 3, moduleId: null, attemptId: 'att-l2-pass', programId: 'p-primary',
    });

    expect(res.issued).toBe(true);
    expect(res.level_name).toBe('Skilled Practitioner');
    const certs = db.tables.training_certificates;
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ user_id: USER, level_id: 3, attempt_id: 'att-l2-pass', program_id: 'p-primary' });
  });

  test('a failed level exam certifies nothing', async () => {
    const db = world({
      training_assessment_attempts: [passedExam({ id: 'att-fail', status: 'failed', is_passed: false })],
    });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: 'att-fail' });

    expect(res.issued).toBe(false);
    expect(db.tables.training_certificates).toHaveLength(0);
  });

  test('finishing units without passing the level exam certifies nothing (unit quick-check path)', async () => {
    const db = world({
      teacher_training_progress: [{ user_id: USER, module_id: 301, completed_at: '2026-10-20T00:00:00Z' }],
      training_assessment_attempts: [{
        id: 'qc-1', user_id: USER, quiz_kind: 'training_module', training_module_id: 301,
        is_passed: true, score: 5, total_questions: 5,
      }],
    });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, moduleId: 301, attemptId: 'qc-1' });

    expect(res.issued).toBe(false);
    expect(db.tables.training_certificates).toHaveLength(0);
  });

  test('a pass at ANOTHER level does not certify this one', async () => {
    const db = world({ training_assessment_attempts: [passedExam({ level_id: 2 })] });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: 'att-l2-pass' });

    expect(res.issued).toBe(false);
    expect(db.tables.training_certificates).toHaveLength(0);
  });

  test('an already-certified level is not certified twice', async () => {
    const db = world({
      training_assessment_attempts: [passedExam(), passedExam({ id: 'att-l2-repass' })],
      training_certificates: [{ id: 'c1', user_id: USER, level_id: 3, certificate_code: 'NIETE-X', issued_at: '2026-10-25T10:29:00Z' }],
    });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: 'att-l2-repass' });

    expect(res.issued).toBe(false);
    expect(db.tables.training_certificates).toHaveLength(1);
  });

  // A diagnostic is stored as quiz_kind 'grand' too, but it is a placement check, not the level exam
  // (bd-43491). 1,358 NIETE teacher-levels on prod hold a diagnostic pass and nothing else; any
  // certify-level call (a module finished in the app) must not certify them.
  test('a passed DIAGNOSTIC at the level certifies nothing', async () => {
    const db = world({
      training_assessment_attempts: [passedExam({ id: 'att-diag', grand_quiz_id: 'dq-l2', completed_at: '2026-03-01T00:00:00Z' })],
    });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: null });

    expect(res.issued).toBe(false);
    expect(db.tables.training_certificates).toHaveLength(0);
  });

  test('an earlier diagnostic pass is ignored: the certificate cites the level exam', async () => {
    const db = world({
      training_assessment_attempts: [
        passedExam({ id: 'att-diag', grand_quiz_id: 'dq-l2', completed_at: '2026-03-01T00:00:00Z' }),
        passedExam(),
      ],
    });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: 'att-l2-pass' });

    expect(res.issued).toBe(true);
    expect(db.tables.training_certificates[0]).toMatchObject({ attempt_id: 'att-l2-pass' });
  });

  test('a pass from before diagnostics existed (no grand_quiz_id) still counts', async () => {
    const db = world({ training_assessment_attempts: [passedExam({ id: 'att-old', grand_quiz_id: null })] });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: null });

    expect(res.issued).toBe(true);
  });

  test('a certificate write that fails is reported as NOT issued', async () => {
    const db = tableDouble({
      users: [{ id: USER, name: 'Peroz Ahmad' }],
      training_vendors: [{ id: CHAIN, unlock_logic: 'chain' }],
      training_levels: [{ id: 3, name: 'Skilled Practitioner', vendor_id: CHAIN }],
      training_assessment_attempts: [passedExam()],
    }, { failTables: { training_certificates: 'insert refused' } });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, levelId: 3, attemptId: 'att-l2-pass' });

    expect(res.issued).toBe(false);
  });

  test('an all_modules vendor (Oxbridge) still certifies on completed units, unchanged', async () => {
    const db = world({
      teacher_training_progress: [{ user_id: USER, module_id: 1701, completed_at: '2026-10-20T00:00:00Z' }],
    });

    const res = await maybeIssueQuizScoreCertificate(db, { userId: USER, moduleId: 1701, attemptId: null });

    expect(res.issued).toBe(true);
    expect(db.tables.training_certificates).toHaveLength(1);
    expect(db.tables.training_certificates[0]).toMatchObject({ user_id: USER, level_id: 17 });
  });
});
