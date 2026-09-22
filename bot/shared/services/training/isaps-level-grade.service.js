/**
 * The I-SAPS level composite: count the three streams, then grade them.
 *
 * The arithmetic and the bars live in isaps-grading.rules (pure, tested). This
 * module is only the COUNTING — which rows feed which component — and it is
 * the part that is easy to get quietly wrong, so each choice is recorded.
 *
 * ONE implementation, two callers: certificate.service gates on it and the
 * portal renders it through the internal API. A second copy portal-side is the
 * drift that made the first Beacon House certificate invisible there.
 */

const {
  gradeIsapsLevel,
  collectIsapsLevelTotals,
} = require('./isaps-grading.rules');

/** Summative questions live at order_index >= 901; below that they are MCQs. */
const CRQ_ORDER_FLOOR = 901;

/**
 * Count and grade one teacher's level.
 *
 * @param {object} supabase
 * @param {object} args
 * @param {string} args.userId
 * @param {number} args.levelId
 * @returns {Promise<null|{is_passed:boolean, composite_pct:number,
 *   failed_components:string[], components:object, counts:object}>}
 *   null when the level has no per-module exams — i.e. it is not an I-SAPS
 *   shaped level and this composite does not apply to it.
 */
async function gradeLevelForUser(supabase, { userId, levelId }) {
  const { data: quizzes } = await supabase
    .from('training_grand_quizzes')
    .select('id, source_quiz_id, quiz_type, is_active')
    .eq('level_id', levelId);

  // Per-module exams are the marker for this grading model. A level without
  // them (Beacon House capstone, Oxbridge) must fall through to its own rule,
  // never be graded 0 by a composite that does not describe it.
  const exams = (quizzes || []).filter(
    q => q.is_active === true && Number(q.source_quiz_id) > 900,
  );
  if (exams.length === 0) return null;

  const examIds = exams.map(q => q.id);

  // ── Formative: every active question on every active unit of the level.
  //
  // `possible` is the WHOLE pool, not what she answered. Formative is 25% of
  // the composite, so counting only answered items would let someone who
  // answered 2 of 97 items post 100% formative and certify on it. Stated in
  // collectIsapsLevelTotals and enforced here.
  const { data: courses } = await supabase
    .from('training_courses').select('id').eq('level_id', levelId).eq('is_active', true);
  const courseIds = (courses || []).map(c => c.id);
  const { data: units } = courseIds.length
    ? await supabase.from('training_modules').select('id')
      .in('course_id', courseIds).eq('is_active', true)
    : { data: [] };
  const unitIds = (units || []).map(u => u.id);

  const { data: formativeQs } = unitIds.length
    ? await supabase.from('training_questions').select('id')
      .in('training_module_id', unitIds).eq('is_active', true)
    : { data: [] };
  const formativeItemCount = (formativeQs || []).length;

  // Her unit-quiz attempts, and the answers under them.
  const { data: unitAttempts } = unitIds.length
    ? await supabase.from('training_assessment_attempts').select('id')
      .eq('user_id', userId).eq('quiz_kind', 'training_module')
      .in('training_module_id', unitIds)
    : { data: [] };
  const unitAttemptIds = (unitAttempts || []).map(a => a.id);

  // BEST PER QUESTION, not a sum over attempts: re-takes are unlimited, so
  // summing would let three attempts at one item earn three marks and push a
  // component past its own pool. One correct answer ever = that item earned.
  const formativeCorrect = await countDistinctCorrect(supabase, unitAttemptIds);

  // ── Summative: counted from the PAPERS SHE SAT, not the authored bank.
  //
  // The banks are deliberately larger than the papers (63 MCQs authored, 2
  // served per module; 36 CRQs authored, 1 served). Using the bank as
  // `possible` would make the composite unreachable — 18 of 63 MCQ marks is
  // 29%, below the 60% bar, for a teacher who answered every question put to
  // her correctly. So `possible` is what her attempts actually served.
  const { data: examAttempts } = examIds.length
    ? await supabase.from('training_assessment_attempts')
      .select('id, grand_quiz_id, total_questions, total_score')
      .eq('user_id', userId).eq('quiz_kind', 'grand').in('grand_quiz_id', examIds)
    : { data: [] };

  const examAttemptIds = (examAttempts || []).map(a => a.id);
  const { data: examAnswers } = examAttemptIds.length
    ? await supabase.from('training_assessment_answers')
      .select('question_id, is_correct, answer_score, attempt_id')
      .in('attempt_id', examAttemptIds)
    : { data: [] };

  // Split by the question's own order_index — the same boundary the paper
  // builder uses, so a question cannot be counted in the wrong stream.
  const qIds = [...new Set((examAnswers || []).map(a => a.question_id).filter(Boolean))];
  const { data: qRows } = qIds.length
    ? await supabase.from('training_questions').select('id, order_index').in('id', qIds)
    : { data: [] };
  const orderOf = new Map((qRows || []).map(q => [q.id, Number(q.order_index) || 0]));

  // Best result per question, for the same re-take reason as formative.
  const mcqBest = new Map();
  const crqBest = new Map();
  for (const a of examAnswers || []) {
    const isCrq = (orderOf.get(a.question_id) || 0) >= CRQ_ORDER_FLOOR;
    if (isCrq) {
      const s = Number(a.answer_score);
      if (Number.isFinite(s)) {
        crqBest.set(a.question_id, Math.max(crqBest.get(a.question_id) ?? 0, s));
      }
    } else if (a.is_correct === true) {
      mcqBest.set(a.question_id, 1);
    }
  }

  // Per-module denominators: each module contributes one paper's worth,
  // whether or not she has sat it yet. An unsat module counts as 0 earned out
  // of its paper size — it is outstanding work, not an absent component.
  const { MODULE_EXAM_MCQ_COUNT } = require('./isaps-crq-paper.rules');
  const CRQ_MARKS_PER_MODULE = 10;
  const mcqItemCount = exams.length * MODULE_EXAM_MCQ_COUNT;
  const crqPossible = exams.length * CRQ_MARKS_PER_MODULE;

  const counts = {
    formativeItemCount,
    formativeCorrect,
    mcqItemCount,
    mcqCorrect: mcqBest.size,
    crqEarned: [...crqBest.values()].reduce((s, v) => s + v, 0),
    crqPossible,
  };

  const verdict = gradeIsapsLevel(collectIsapsLevelTotals(counts));
  return { ...verdict, counts };
}

/**
 * Distinct questions ever answered correctly across these attempts.
 *
 * Chunked because an `.in()` over every attempt a teacher has ever made can
 * outgrow the URL length Supabase accepts.
 */
async function countDistinctCorrect(supabase, attemptIds) {
  if (!attemptIds || attemptIds.length === 0) return 0;
  const seen = new Set();
  const CHUNK = 80;
  for (let i = 0; i < attemptIds.length; i += CHUNK) {
    const slice = attemptIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from('training_assessment_answers')
      .select('question_id, is_correct')
      .in('attempt_id', slice)
      .eq('is_correct', true);
    for (const r of data || []) if (r.question_id) seen.add(r.question_id);
  }
  return seen.size;
}

module.exports = { gradeLevelForUser, CRQ_ORDER_FLOOR };
