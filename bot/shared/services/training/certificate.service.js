/**
 * Teacher Training — Certificate Issuance Service
 *
 * Single source of truth for issuing a level certificate after a passed
 * grand-quiz (level exam) attempt. Used by BOTH surfaces:
 *
 *   - WhatsApp: quiz-delivery.service.js gradeAttempt() (quiz_kind='grand')
 *   - Teacher portal: dashboard/routes/portal.routes.js grand-quiz submit
 *
 * The certificate is a durable `training_certificates` row:
 *   { user_id, program_id, level_id, attempt_id, certificate_code,
 *     teacher_name_snapshot, level_name_snapshot, issued_at, pdf_r2_key }
 *
 * PDF rendering lives in `certificate-pdf.service.js` and runs here as a
 * BEST-EFFORT step AFTER the row is written. It can never block or fail
 * issuance: if rendering or the upload throws, the row still stands and
 * `pdf_r2_key` simply stays null — the state every certificate issued before
 * this existed is in, and a permanently valid one.
 *
 * The Supabase client is injected by the caller so each surface uses its own
 * configured client (bot vs dashboard) against the same shared database —
 * requiring the bot's config from the dashboard would run the bot's
 * exit-on-missing-env boot gate in a process that has its own config.
 *
 * Deployment-neutral by design: the certificate-code prefix comes from env
 * (CERT_CODE_PREFIX, else BOT_NAME, else ORG_NAME), never a hardcoded
 * deployment name.
 */
const { logToFile } = require('../../utils/logger');

const FALLBACK_PREFIX = 'CERT';

/**
 * Resolve the certificate-code prefix from env. Uppercased, alphanumeric
 * only, capped at 12 chars so codes stay short and legible.
 * @returns {string}
 */
function certCodePrefix() {
  const raw = process.env.CERT_CODE_PREFIX || process.env.BOT_NAME || process.env.ORG_NAME || FALLBACK_PREFIX;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return cleaned || FALLBACK_PREFIX;
}

/**
 * Generate a certificate code: <PREFIX>-<YYYYMMDD>-<6 base36 chars>.
 * Same shape the WhatsApp path has always issued.
 * @param {Date} [now]
 * @returns {string}
 */
function generateCertificateCode(now = new Date()) {
  const datePart = now.toISOString().slice(0, 10).replaceAll('-', '');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
  return `${certCodePrefix()}-${datePart}-${rand}`;
}

/**
 * Issue (or return the already-issued) certificate for a passed grand-quiz
 * attempt. Idempotent per attempt_id: re-issuing for the same attempt returns
 * the existing row instead of minting a duplicate code.
 *
 * @param {object} supabase - configured Supabase client (caller-injected)
 * @param {object} params
 * @param {string} params.userId    - users.id (uuid)
 * @param {string} params.programId - training_programs.id (uuid)
 * @param {number} params.levelId   - training_levels.id
 * @param {string} params.attemptId - training_assessment_attempts.id (uuid)
 * @returns {Promise<{certificate_code: string, teacher_name: string, level_name: string, issued_at: string, already_issued: boolean, pdf_r2_key: string|null}>}
 */
async function issueCertificate(supabase, { userId, programId, levelId, attemptId }) {
  // Idempotency is per (user, level) — NOT per attempt. bd-2670: this used to
  // filter on attempt_id alone, so every fresh passing attempt at an
  // already-certified level minted another certificate. Production reached
  // 3,113 surplus rows across 830 teachers, one level holding 56.
  //
  // Deliberately a LIST read capped at 1, not `.maybeSingle()`. PostgREST
  // answers 406/PGRST116 when a single-object read matches several rows, so on
  // exactly the data this guard exists to catch, `.maybeSingle()` returns an
  // error, `existing` is undefined, and the guard fails OPEN — minting one
  // more and ratcheting the duplication. A list read cannot fail that way.
  //
  // Ordered oldest-first: the teacher keeps the certificate they FIRST earned,
  // which is the same row the backfill keeps, so code and data agree.
  const { data: existingRows } = await supabase
    .from('training_certificates')
    .select('certificate_code, teacher_name_snapshot, level_name_snapshot, issued_at, pdf_r2_key')
    .eq('user_id', userId)
    .eq('level_id', levelId)
    .order('issued_at', { ascending: true })
    .limit(1);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing) {
    return {
      certificate_code: existing.certificate_code,
      teacher_name: existing.teacher_name_snapshot,
      level_name: existing.level_name_snapshot,
      issued_at: existing.issued_at,
      already_issued: true,
      pdf_r2_key: existing.pdf_r2_key || null,
    };
  }

  const [{ data: user }, { data: level }] = await Promise.all([
    supabase.from('users').select('name, first_name, last_name').eq('id', userId).maybeSingle(),
    supabase.from('training_levels').select('name').eq('id', levelId).maybeSingle(),
  ]);
  const teacherName = user?.name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Teacher';
  const levelName = level?.name || 'Level';
  const code = generateCertificateCode();
  const issuedAt = new Date().toISOString();

  const { error } = await supabase.from('training_certificates').insert({
    user_id: userId,
    program_id: programId,
    level_id: levelId,
    attempt_id: attemptId,
    certificate_code: code,
    teacher_name_snapshot: teacherName,
    level_name_snapshot: levelName,
  });
  if (error) {
    // Same tolerance the WhatsApp path always had: the pass is already
    // recorded on the attempt row; a cert-row failure must not fail the pass.
    logToFile('❌ Certificate insert failed', { userId, levelId, attemptId, error: error.message });
  }

  // Best-effort PDF. Only attempted when the row actually landed — with no row
  // there is nothing to attach a key to. The whole thing is wrapped again here
  // (the service already swallows internally) so that even a require-time
  // failure — a clone without pdfkit installed, say — cannot cost a teacher
  // their certificate.
  let pdfKey = null;
  if (!error) {
    try {
      const { generateAndStoreCertificatePdf } = require('./certificate-pdf.service');
      pdfKey = await generateAndStoreCertificatePdf(supabase, {
        userId,
        levelId,
        certificateCode: code,
        teacherName,
        levelName,
        issuedAt,
      });
    } catch (err) {
      logToFile('❌ Certificate PDF step failed — row stands without a PDF', {
        userId, levelId, attemptId, error: err.message,
      });
      pdfKey = null;
    }
  }

  return {
    certificate_code: code,
    teacher_name: teacherName,
    level_name: levelName,
    issued_at: issuedAt,
    already_issued: false,
    pdf_r2_key: pdfKey || null,
  };
}

/**
 * bd-2234 — quiz-score certificate for all_modules vendors WITHOUT a
 * capstone (Oxbridge). NIETE team rule (21 Jul): complete every module of
 * the level with a best module-quiz score of >= 70% each → certificate.
 * Beacon House levels certify through the capstone path instead
 * (capstone-delivery.service), so levels WITH an active capstone quiz are
 * excluded here.
 *
 * Fires after a module quiz is graded; cheap early-outs, never throws.
 * @returns {Promise<{issued: boolean, certificate_code?: string, level_name?: string, teacher_name?: string}>}
 */
const QUIZ_CERT_PASS_PCT = 0.7;

async function maybeIssueQuizScoreCertificate(supabase, { userId, moduleId, attemptId, programId }) {
  try {
    const { data: mod } = await supabase
      .from('training_modules').select('id, course_id').eq('id', moduleId).maybeSingle();
    if (!mod || !mod.course_id) return { issued: false };
    const { data: course } = await supabase
      .from('training_courses').select('id, level_id').eq('id', mod.course_id).maybeSingle();
    if (!course) return { issued: false };
    const { data: level } = await supabase
      .from('training_levels').select('id, name, vendor_id').eq('id', course.level_id).maybeSingle();
    if (!level) return { issued: false };
    const { data: vendor } = await supabase
      .from('training_vendors').select('id, unlock_logic').eq('id', level.vendor_id).maybeSingle();
    if ((vendor?.unlock_logic || 'chain') === 'chain') return { issued: false };

    // Capstone levels certify via the capstone pass.
    const { data: capstone } = await supabase
      .from('training_grand_quizzes')
      .select('id')
      .eq('level_id', level.id)
      .eq('quiz_type', 'capstone')
      .eq('is_active', true)
      .maybeSingle();
    if (capstone) return { issued: false };

    // One certificate per (user, level). bd-2670: this was a `.maybeSingle()`,
    // which 406s once duplicates exist — the throw was swallowed and the guard
    // failed open, minting more. A capped list read holds even on dirty data.
    // (`issueCertificate` now enforces the same rule, so this is the cheap
    // early-out rather than the only line of defence.)
    const { data: existingRows } = await supabase
      .from('training_certificates')
      .select('certificate_code')
      .eq('user_id', userId)
      .eq('level_id', level.id)
      .limit(1);
    if (Array.isArray(existingRows) && existingRows.length > 0) return { issued: false };

    // Every active module of the level complete?
    const { data: courses } = await supabase
      .from('training_courses').select('id').eq('level_id', level.id).eq('is_active', true);
    const courseIds = (courses || []).map(c => c.id);
    const { data: modules } = await supabase
      .from('training_modules').select('id').eq('is_active', true).in('course_id', courseIds);
    const moduleIds = (modules || []).map(m => m.id);
    if (moduleIds.length === 0) return { issued: false };
    const { data: progress } = await supabase
      .from('teacher_training_progress').select('module_id').eq('user_id', userId).in('module_id', moduleIds);
    const done = new Set((progress || []).map(p => p.module_id));
    if (!moduleIds.every(id => done.has(id))) return { issued: false };

    // Best quiz score per module must clear the bar.
    const { data: attempts } = await supabase
      .from('training_assessment_attempts')
      .select('training_module_id, score, total_questions')
      .eq('user_id', userId)
      .eq('quiz_kind', 'training_module')
      .in('training_module_id', moduleIds);
    const bestPct = new Map();
    for (const a of attempts || []) {
      const pct = (a.score || 0) / Math.max(1, a.total_questions || 0);
      const cur = bestPct.get(a.training_module_id) || 0;
      if (pct > cur) bestPct.set(a.training_module_id, pct);
    }
    const allClear = moduleIds.every(id => (bestPct.get(id) || 0) >= QUIZ_CERT_PASS_PCT);
    if (!allClear) return { issued: false };

    const cert = await issueCertificate(supabase, {
      userId, programId, levelId: level.id, attemptId,
    });
    return {
      issued: true,
      certificate_code: cert.certificate_code,
      level_name: cert.level_name,
      teacher_name: cert.teacher_name,
      pdf_r2_key: cert.pdf_r2_key || null,
    };
  } catch (err) {
    logToFile('❌ maybeIssueQuizScoreCertificate failed', { userId, moduleId, error: err.message });
    return { issued: false };
  }
}

module.exports = { issueCertificate, generateCertificateCode, certCodePrefix, maybeIssueQuizScoreCertificate };
