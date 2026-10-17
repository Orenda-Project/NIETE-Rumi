/**
 * Release the HELD I-SAPS written-answer (CRQ) results, silently (bd-s42dye.5).
 *
 * Background (bd-hxm7a): while app_settings.isaps_crq_results_released is not
 * true, an I-SAPS module exam that clears the MCQ bar is stored
 * status='pending_review', is_passed=null, and no certificate is issued.
 * Flipping the flag only changes NEW attempts; the already-held ones stay
 * pending_review with no retake. This resolves them from the grades they
 * already carry, then certifies each teacher through the SAME guard the
 * portal uses (maybeIssueQuizScoreCertificate — one per user and level, PDF
 * rendered).
 *
 * SILENT BY CONSTRUCTION. This file does not require WhatsApp, quiz-delivery
 * (gradeAttempt / sendCongratulation) or merged-sends, so nothing here CAN send.
 * The test asserts that, and that quiz-delivery is never even loaded.
 * Teachers see results and certificates when they next open training.
 *
 * What it writes, per attempt, mirrors gradeAttempt's released module-exam path
 * (quiz-delivery.service.js "const update = {...}"): status, score (marks),
 * is_passed, cooldown_until (vendor cooldown; I-SAPS 0 → null). completed_at is
 * left alone — the sitting finished when it finished. The verdict is
 * decideIsapsModuleExamPass over scoreMixedPaper, the same two functions.
 *
 * A held attempt whose background CRQ grading failed (answer_score null) is
 * re-scored through the existing scoreAnswer and stored exactly as the live
 * path stores it (answer_score + feedback_text on (attempt_id, question_index)).
 * The question is read WITH its rubric, i.e. as the rubric-grounded marking intends.
 * --dry-run never calls the LLM; it only counts those.
 *
 * Idempotent: only status='pending_review' rows are selected, and each update
 * is guarded on that status, so a re-run finds 0 and a concurrent writer is not
 * overwritten. The certificate guard itself refuses a second row per (user, level).
 */

const { crqResultsHeld, CRQ_RELEASE_SETTING_KEY, PENDING_REVIEW } = require('./isaps-crq-hold.rules');
const { scoreMixedPaper, decideIsapsModuleExamPass } = require('./isaps-crq-paper.rules');
const { isPerModuleQuiz, allModuleExamsPassed } = require('./isaps-module-exam.rules');
const { pointsPerQuestionFor } = require('./capstone-points.rules');
const { cooldownUntilFor } = require('./retry-cooldown.rules');
const { logError } = require('../../utils/logger');

/** The one SQL that releases. A separate, explicit step — never run by this file. */
const RELEASE_FLAG_SQL = [
  'insert into public.app_settings (key, value, description)',
  `values ('${CRQ_RELEASE_SETTING_KEY}', 'true'::jsonb, 'release I-SAPS CRQ results + certificates')`,
  'on conflict (key) do update set value = \'true\'::jsonb, updated_at = now();',
].join('\n');

class FlagStillHeldError extends Error {
  constructor() {
    super(
      `Refusing --apply: app_settings.${CRQ_RELEASE_SETTING_KEY} is not true, so new attempts would keep landing in pending_review mid-run, `
      + `and the certificate guard would refuse every teacher. Flip the flag first (separate, explicit step):\n\n${RELEASE_FLAG_SQL}\n`,
    );
    this.name = 'FlagStillHeldError';
    this.code = 'FLAG_STILL_HELD';
    this.sql = RELEASE_FLAG_SQL;
  }
}

const PAGE = 500;
const CHUNK = 100;
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function mustRead(label, p) {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

/** Every pending_review attempt id (paged: PostgREST caps a plain read at 1000). */
async function loadPendingAttempts(supabase, onlyUserIds) {
  const out = [];
  for (let p = 0; ; p += 1) {
    let q = supabase
      .from('training_assessment_attempts')
      .select('id, user_id, level_id, program_id, grand_quiz_id, quiz_kind, total_questions')
      .eq('status', PENDING_REVIEW);
    if (Array.isArray(onlyUserIds) && onlyUserIds.length) q = q.in('user_id', onlyUserIds);
    const rows = await mustRead('read pending attempts', q.order('id').range(p * PAGE, p * PAGE + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * @param {object} p
 * @param {object} p.supabase
 * @param {boolean} [p.apply=false]  false → dry-run: read-only, no LLM
 * @param {function} p.scoreAnswer   (question, answerText, maxPoints) => {score, feedback}
 * @param {function} [p.certify]     (supabase, {userId, levelId, moduleId, attemptId, programId}) => {issued,...}
 * @param {function} [p.log]
 * @param {string[]} [p.onlyUserIds] restrict to these users (sandbox proofs); default: everyone held
 */
async function releaseHeldAttempts({ supabase, apply = false, scoreAnswer, certify, log = () => {}, onlyUserIds }) {
  const held = await crqResultsHeld(supabase);
  if (apply && held) throw new FlagStillHeldError();
  const doCertify = certify || require('./certificate.service').maybeIssueQuizScoreCertificate;

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    flag_held: held,
    attempts_seen: 0,
    would_rescore: 0,
    rescored: 0,
    passed: 0,          // dry-run: projected from the stored grades
    failed: 0,
    unknown_pending_rescore: 0,
    users_touched: 0,
    users_certified: 0,
    certificate_rows_created: 0,
    certificate_pdfs_rendered: 0,
    users_certifiable_min: 0,
    users_certifiable_max: 0,
    skipped_not_module_exam: 0,
    skipped_already_resolved: 0,
    errors: [],
  };
  const err = (attemptId, stage, e) => summary.errors.push({ attempt_id: attemptId, stage, message: e && e.message ? e.message : String(e) });

  const pending = await loadPendingAttempts(supabase, onlyUserIds);
  summary.attempts_seen = pending.length;
  if (pending.length === 0) return summary;

  // Answers for every pending attempt, in chunks.
  const answersByAttempt = new Map();
  for (const ids of chunks(pending.map(a => a.id), CHUNK)) {
    const rows = await mustRead('read answers', supabase
      .from('training_assessment_answers')
      .select('attempt_id, question_index, question_id, is_correct, answer_text, answer_score, feedback_text')
      .in('attempt_id', ids));
    rows.forEach(r => { if (!answersByAttempt.has(r.attempt_id)) answersByAttempt.set(r.attempt_id, []); answersByAttempt.get(r.attempt_id).push(r); });
  }

  // Quizzes (is this a per-module exam?) and per-level vendor facts, cached.
  const quizById = new Map();
  for (const ids of chunks([...new Set(pending.map(a => a.grand_quiz_id).filter(Boolean))], CHUNK)) {
    const rows = await mustRead('read quizzes', supabase
      .from('training_grand_quizzes').select('id, source_quiz_id, level_id, quiz_type, is_active').in('id', ids));
    rows.forEach(q => quizById.set(q.id, q));
  }
  const levelFacts = new Map();
  async function factsFor(levelId) {
    if (levelFacts.has(levelId)) return levelFacts.get(levelId);
    const [lvl] = await mustRead('read level', supabase.from('training_levels').select('id, vendor_id').eq('id', levelId).limit(1));
    let vendor = null;
    if (lvl && lvl.vendor_id) {
      [vendor] = await mustRead('read vendor', supabase
        .from('training_vendors').select('id, key, capstone_points_per_question, cooldown_hours').eq('id', lvl.vendor_id).limit(1));
    }
    const f = { crqMax: pointsPerQuestionFor(vendor), cooldownHours: vendor ? vendor.cooldown_hours : undefined };
    levelFacts.set(levelId, f);
    return f;
  }

  // verdicts[attemptId] = true | false | null (null: dry-run, awaiting a re-score)
  const verdicts = new Map();
  const resolvedPassedByUserLevel = new Map();   // key → attempt id of one passed attempt (for provenance)
  const touched = new Map();                      // key → {userId, levelId, programId, attemptId}

  for (const a of pending) {
    try {
      const quiz = quizById.get(a.grand_quiz_id);
      if (!quiz || !isPerModuleQuiz(quiz.source_quiz_id)) { summary.skipped_not_module_exam += 1; continue; }
      const key = `${a.user_id}|${a.level_id}`;
      if (!touched.has(key)) touched.set(key, { userId: a.user_id, levelId: a.level_id, programId: a.program_id, attemptId: a.id });

      const { crqMax, cooldownHours } = await factsFor(a.level_id);
      const mcqCount = Math.max(0, (Number(a.total_questions) || 0) - (crqMax > 0 ? 1 : 0));
      const answers = answersByAttempt.get(a.id) || [];

      // (a) a CRQ whose background grading failed has no mark yet.
      const crqRow = answers.find(r => Number(r.question_index) >= mcqCount && crqMax > 0);
      const needsRescore = Boolean(crqRow) && (crqRow.answer_score === null || crqRow.answer_score === undefined)
        && String(crqRow.answer_text || '').trim().length > 0;
      let rows = answers;
      if (needsRescore) {
        if (!apply) {
          summary.would_rescore += 1;
          summary.unknown_pending_rescore += 1;
          verdicts.set(a.id, null);
          continue;
        }
        const [question] = await mustRead('read CRQ question', supabase
          .from('training_questions').select('id, question_text, rubric').eq('id', crqRow.question_id).limit(1));
        if (!question) throw new Error(`CRQ question ${crqRow.question_id} not found`);
        const { score, feedback } = await scoreAnswer(question, String(crqRow.answer_text), crqMax);
        const { error } = await supabase.from('training_assessment_answers')
          .update({ answer_score: score, feedback_text: feedback })
          .eq('attempt_id', a.id).eq('question_index', crqRow.question_index);
        if (error) throw new Error(`store re-score: ${error.message}`);
        rows = answers.map(r => (r === crqRow ? { ...r, answer_score: score, feedback_text: feedback } : r));
        summary.rescored += 1;
      }

      // (b) the verdict — the same two functions gradeAttempt uses.
      const mixed = scoreMixedPaper({ answers: rows, mcqCount, crqMaxPoints: crqMax });
      const isPassed = decideIsapsModuleExamPass(mixed);
      verdicts.set(a.id, isPassed);
      if (isPassed) summary.passed += 1; else summary.failed += 1;

      if (!apply) continue;
      const { data: hit, error } = await supabase.from('training_assessment_attempts').update({
        status: isPassed ? 'passed' : 'failed',
        score: mixed.earned,
        is_passed: isPassed,
        cooldown_until: isPassed ? null : cooldownUntilFor(cooldownHours),
      }).eq('id', a.id).eq('status', PENDING_REVIEW).select('id');
      if (error) throw new Error(`write verdict: ${error.message}`);
      if (!hit || hit.length === 0) {
        summary.skipped_already_resolved += 1;
        if (isPassed) summary.passed -= 1; else summary.failed -= 1;
        continue;
      }
      if (isPassed && !resolvedPassedByUserLevel.has(key)) resolvedPassedByUserLevel.set(key, a.id);
    } catch (e) {
      err(a.id, 'attempt', e);
      logError('❌ isaps held release — attempt failed', { attemptId: a.id, error: e && e.message });
    }
  }
  summary.users_touched = touched.size;

  if (!apply) {
    await projectCertifiable({ supabase, touched, pending, verdicts, summary, err });
    return summary;
  }

  // (c) certificates, through the existing guard. One call per (user, level).
  const toCertify = [...touched.entries()].filter(([key]) => resolvedPassedByUserLevel.has(key));
  for (const [key, t] of toCertify) {
    try {
      const res = await doCertify(supabase, {
        userId: t.userId, levelId: t.levelId, moduleId: null,
        attemptId: resolvedPassedByUserLevel.get(key), programId: t.programId,
      });
      if (res && res.issued) {
        summary.users_certified += 1;
        summary.certificate_rows_created += 1;
        if (res.pdf_r2_key) summary.certificate_pdfs_rendered += 1;
        log(`certified ${t.userId} level ${t.levelId}`);
      }
    } catch (e) {
      err(resolvedPassedByUserLevel.get(key), 'certificate', e);
    }
  }
  return summary;
}

/**
 * Dry-run only: how many users the module-exam rule WOULD certify. min treats a
 * still-to-be-re-scored attempt as a fail, max as a pass. Mirrors the guard's
 * module-exam rule and its one-certificate-per-(user, level) rule; the guard
 * itself is what decides on --apply.
 */
async function projectCertifiable({ supabase, touched, pending, verdicts, summary, err }) {
  try {
    const levelIds = [...new Set([...touched.values()].map(t => t.levelId))];
    const quizzesByLevel = new Map();
    for (const lv of levelIds) {
      quizzesByLevel.set(lv, await mustRead('read level quizzes', supabase
        .from('training_grand_quizzes').select('id, source_quiz_id, quiz_type, is_active').eq('level_id', lv)));
    }
    const userIds = [...new Set([...touched.values()].map(t => t.userId))];
    const otherByUser = new Map();
    const certified = new Set();
    for (const ids of chunks(userIds, CHUNK)) {
      const others = await mustRead('read other attempts', supabase
        .from('training_assessment_attempts')
        .select('user_id, grand_quiz_id, is_passed, status').eq('quiz_kind', 'grand').in('user_id', ids));
      others.filter(o => o.status !== PENDING_REVIEW).forEach(o => {
        if (!otherByUser.has(o.user_id)) otherByUser.set(o.user_id, []);
        otherByUser.get(o.user_id).push(o);
      });
      const certs = await mustRead('read certificates', supabase
        .from('training_certificates').select('user_id, level_id').in('user_id', ids));
      certs.forEach(c => certified.add(`${c.user_id}|${c.level_id}`));
    }
    const pendingByKey = new Map();
    pending.forEach(a => {
      const k = `${a.user_id}|${a.level_id}`;
      if (!pendingByKey.has(k)) pendingByKey.set(k, []);
      pendingByKey.get(k).push(a);
    });
    for (const [key, t] of touched) {
      if (certified.has(key)) continue;
      const quizzes = quizzesByLevel.get(t.levelId) || [];
      const base = (otherByUser.get(t.userId) || []);
      const project = unknownAs => [
        ...base,
        ...(pendingByKey.get(key) || []).map(a => {
          const v = verdicts.has(a.id) ? verdicts.get(a.id) : false;
          return { grand_quiz_id: a.grand_quiz_id, is_passed: v === null ? unknownAs : v === true };
        }),
      ];
      if (allModuleExamsPassed(quizzes, project(false))) summary.users_certifiable_min += 1;
      if (allModuleExamsPassed(quizzes, project(true))) summary.users_certifiable_max += 1;
    }
  } catch (e) {
    err(null, 'projection', e);
  }
}

module.exports = { releaseHeldAttempts, FlagStillHeldError, RELEASE_FLAG_SQL };
