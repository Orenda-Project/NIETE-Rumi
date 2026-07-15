/**
 * Exam Composer — turns a Flow-submitted request
 *   { user_id, type: 'WEEKLY'|'TERM', grade, subject, language, chapters: [1,2],
 *     question_types?: ['mcq', 'short_answer', ...] }
 * into a specific set of question picks.
 *
 * question_types is optional: absent / empty → all types included (back-compat
 * for old client caches that predate the picker screen).
 *
 * Reads: exam_question_bank (filtered), exam_question_groups.
 * Writes: exams + exam_questions rows (as snapshots).
 * Emits: the composed exam { exam, questions } for the renderer to consume.
 *
 * See docs/migration/05-exam-generator.md — this file implements the
 * "Composition — blueprints + algorithm" section.
 */

const { getBlueprint } = require('./exam-composer.blueprints');
const { validateQuestion, sourceHashOf } = require('./exam-composer.validators');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

// Cap the number of times we try to replace a single invalid pick within a
// bucket. Two retries keeps the algorithm bounded — if the pool is dry after
// three attempts (the original + two swaps), log + skip that slot.
const VALIDATION_MAX_RETRIES = 2;

// Failure thresholds — if a bucket can't fill above this % of its target,
// treat the whole compose call as insufficient-pool (D on the spec).
const MIN_BUCKET_FILL_PCT = 60;

// Skill-based criteria map their bucket names to Question.type values
// (see config.py in taleemabad-core exam_generator).
const SKILL_TYPE_MAP = {
  reading: ['Reading', 'Comprehension Passage', 'Brief Answers'],
  writing: ['Writing', 'Essay Writing', 'Letter Writing', 'Paragraph Writing',
            'Story Writing', 'Picture Description', 'Application Writing',
            'Simple Writing', 'Story Completion', 'Rewriting'],
  listening: ['Listening'],
  speaking: ['Speaking'],
};

// User-facing question-type IDs (from the QUESTION_TYPES flow screen) mapped to
// the granular `type` values that live in exam_question_bank.type. Any bank
// row whose `type` is not covered here is effectively "extra" and only reachable
// when the caller omits question_types (back-compat path).
const QUESTION_TYPE_MAP = {
  mcq:           ['MCQs', 'MSQs', 'Circle the Correct Answer'],
  short_answer:  ['Brief Answers', 'Short Answer'],
  long_answer:   ['Long Answer', 'Essay Writing', 'Letter Writing',
                  'Paragraph Writing', 'Story Writing', 'Picture Description',
                  'Application Writing', 'Simple Writing', 'Story Completion',
                  'Rewriting', 'Writing'],
  fill_blanks:   ['Fill in the Blanks', 'Missing Letters'],
  true_false:    ['True/False'],
  match_columns: ['Match the Column'],
  comprehension: ['Comprehension Passage', 'Reading', 'Listening', 'Speaking'],
};

/**
 * Given a list of user-facing question_type IDs, return the set of bank `type`
 * values that should be kept in the pool. Returns null when no filter should
 * apply (caller passed nothing, or an empty/unknown list) — the caller then
 * skips the filter step for back-compat.
 */
function bankTypesForQuestionTypes(questionTypes) {
  if (!Array.isArray(questionTypes) || questionTypes.length === 0) return null;
  const set = new Set();
  for (const id of questionTypes) {
    const mapped = QUESTION_TYPE_MAP[id];
    if (!mapped) continue;
    for (const t of mapped) set.add(t);
  }
  return set.size > 0 ? set : null;
}

/**
 * Section classifier — objective vs subjective, matching Taleemabad's convention
 * (see exam_json_extractor.py _SECTIONS).
 */
function sectionOf(qType) {
  const OBJECTIVE = new Set([
    'MCQs', 'MSQs', 'Fill in the Blanks', 'Missing Letters', 'True/False',
    'Match the Column', 'Circle the Correct Answer', 'Rewrite Sentences',
    'Brief Answers',
  ]);
  return OBJECTIVE.has(qType) ? 'objective' : 'subjective';
}

/**
 * Pull the bank pool for a given request. One query, indexed.
 */
async function loadPool({ grade, subject, language, chapters }) {
  // Supabase PostgREST enforces a 1000-row max-rows cap. A Grade Five + Math
  // + all-chapters filter can return ~2600 rows, so we page manually until
  // we get a short page (< pageSize) which signals end-of-set.
  const pageSize = 1000;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('exam_question_bank')
      .select('*')
      .eq('grade', grade)
      .eq('subject', subject)
      .eq('language', language)
      .in('chapter_index', chapters)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`exam bank pool query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    // Safety valve: bank has ~35k rows, refuse anything past 20k for one query.
    if (all.length >= 20000) break;
  }
  return all;
}

/**
 * Filter a pool to a single bucket of the blueprint's criteria.
 * For Blooms: match by bloom_tags containing the bucket name (upper).
 * For Skills: match by question.type ∈ SKILL_TYPE_MAP[bucket].
 */
function filterToBucket(pool, criterionType, bucketName) {
  if (criterionType === 'blooms') {
    const target = String(bucketName).toUpperCase();
    return pool.filter(q => (q.bloom_tags || []).includes(target));
  }
  if (criterionType === 'skills') {
    const allowed = new Set(SKILL_TYPE_MAP[bucketName] || []);
    return pool.filter(q => allowed.has(q.type));
  }
  return [];
}

/**
 * Random sample n items from an array, without replacement.
 */
function sample(arr, n) {
  if (n <= 0 || arr.length === 0) return [];
  if (arr.length <= n) return [...arr];
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * For each picked question that belongs to a group, expand the pick to include
 * ALL siblings from the same group. Groups are atomic — a comprehension passage
 * without its sub-questions is nonsense; a match-the-columns block with only 2 of 6
 * pairs is nonsense.
 */
async function expandGroups(picks, fullPool) {
  const groupIds = [...new Set(picks.map(q => q.group_ref).filter(Boolean))];
  if (groupIds.length === 0) return picks;

  // Pull siblings from the ALREADY-loaded pool first (avoid extra DB round-trip
  // when siblings match our grade/subject/language/chapter filter — which they
  // should, since the group is chapter-scoped).
  const pickedIds = new Set(picks.map(q => q.id));
  const additions = [];
  for (const gid of groupIds) {
    const siblings = fullPool.filter(q => q.group_ref === gid && !pickedIds.has(q.id));
    for (const s of siblings) {
      pickedIds.add(s.id);
      additions.push(s);
    }
  }
  return [...picks, ...additions];
}

/**
 * Fetch group metadata (title_text, media) for any picked-question's group_ref.
 * Returned as a Map<group_uuid, groupRow> for the renderer to look up passage
 * text when it hits the first question of a group.
 */
async function loadGroupMeta(picks) {
  const groupIds = [...new Set(picks.map(q => q.group_ref).filter(Boolean))];
  if (groupIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('exam_question_groups')
    .select('*')
    .in('id', groupIds);
  if (error) throw new Error(`group meta query failed: ${error.message}`);
  return new Map((data || []).map(g => [g.id, g]));
}

/**
 * Order picks by section (objective first) → source-cluster anchor →
 * chapter_index → index_in_chapter.
 *
 * "Source cluster" means questions sharing a group_ref, image, or long
 * passage (see exam-composer.validators.sourceHashOf) — those are kept
 * contiguous by anchoring on the first sibling's chapter/index.
 */
function orderPicks(picks) {
  // Precompute a stable per-source-cluster sort anchor:
  // min(chapter_index, index_in_chapter) across all cluster members. Applies
  // to both explicit groups (group_ref) and drift clusters (shared image /
  // shared passage).
  const clusterAnchor = new Map(); // sourceHash -> { chapter_index, index_in_chapter }
  const clusterOf = new Map();     // question id -> sourceHash
  for (const q of picks) {
    const h = sourceHashOf(q);
    clusterOf.set(q, h);
    const cur = clusterAnchor.get(h);
    const chap = q.chapter_index ?? 0;
    const idx = q.index_in_chapter ?? 0;
    if (!cur || chap < cur.chapter_index ||
        (chap === cur.chapter_index && idx < cur.index_in_chapter)) {
      clusterAnchor.set(h, { chapter_index: chap, index_in_chapter: idx });
    }
  }
  return [...picks].sort((a, b) => {
    // Section: objective first
    if (a._section !== b._section) return a._section === 'objective' ? -1 : 1;
    const aHash = clusterOf.get(a);
    const bHash = clusterOf.get(b);
    const aAnchor = clusterAnchor.get(aHash);
    const bAnchor = clusterAnchor.get(bHash);
    if (aAnchor.chapter_index !== bAnchor.chapter_index) return aAnchor.chapter_index - bAnchor.chapter_index;
    if (aAnchor.index_in_chapter !== bAnchor.index_in_chapter) return aAnchor.index_in_chapter - bAnchor.index_in_chapter;
    // Same anchor but different cluster (rare — same chapter, same index,
    // different sources). Break ties by hash so the ordering is deterministic.
    if (aHash !== bHash) return aHash < bHash ? -1 : 1;
    // Within a cluster: preserve the sibling ordering by index_in_chapter.
    return (a.index_in_chapter ?? 0) - (b.index_in_chapter ?? 0);
  });
}

/**
 * Sample a bucket honouring the seen/unseen split. Borrows across categories
 * when either subpool is short (weekly leans SEEN if UNSEEN is thin; term leans
 * UNSEEN if SEEN is thin).
 */
function sampleBucket(bucketPool, targetCount, seenPct, unseenPct) {
  const seenPool = bucketPool.filter(q => q.category === 'SEEN');
  const unseenPool = bucketPool.filter(q => q.category === 'UNSEEN');

  let seenTarget = Math.round((targetCount * seenPct) / 100);
  let unseenTarget = targetCount - seenTarget;

  // Borrow if either side is short.
  if (seenPool.length < seenTarget) {
    const short = seenTarget - seenPool.length;
    seenTarget = seenPool.length;
    unseenTarget += short;
  }
  if (unseenPool.length < unseenTarget) {
    const short = unseenTarget - unseenPool.length;
    unseenTarget = unseenPool.length;
    seenTarget = Math.min(seenPool.length, seenTarget + short);
  }

  return [...sample(seenPool, seenTarget), ...sample(unseenPool, unseenTarget)];
}

/**
 * Sample a bucket honouring the seen/unseen split AND the four
 * post-generation validators. Same signature as sampleBucket, but any pick
 * that fails validateQuestion() is swapped for a fresh sample from the same
 * subpool (up to VALIDATION_MAX_RETRIES per slot). If a slot can't be filled
 * with a valid question after retries, it's logged + dropped — better to
 * ship a shorter paper than one with a broken row.
 *
 * Non-destructive: doesn't mutate the input arrays.
 */
function sampleBucketValidated(bucketPool, targetCount, seenPct, unseenPct) {
  const seenPool = bucketPool.filter(q => q.category === 'SEEN');
  const unseenPool = bucketPool.filter(q => q.category === 'UNSEEN');

  let seenTarget = Math.round((targetCount * seenPct) / 100);
  let unseenTarget = targetCount - seenTarget;

  // Same borrow logic as sampleBucket — if one side is short, top up the
  // other. Prevents a seen-heavy shortfall from producing a smaller paper
  // when there's plenty of unseen material.
  if (seenPool.length < seenTarget) {
    const short = seenTarget - seenPool.length;
    seenTarget = seenPool.length;
    unseenTarget += short;
  }
  if (unseenPool.length < unseenTarget) {
    const short = unseenTarget - unseenPool.length;
    unseenTarget = unseenPool.length;
    seenTarget = Math.min(seenPool.length, seenTarget + short);
  }

  const pickWithRetries = (subpool, n) => {
    const remaining = [...subpool];
    const out = [];
    while (out.length < n && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      const candidate = remaining.splice(idx, 1)[0];
      const check = validateQuestion(candidate);
      if (check.valid) {
        out.push(candidate);
      } else {
        logToFile('[exam-composer] rejected pick', {
          id: candidate.id, type: candidate.type, reason: check.reason,
        });
        // Cap swaps per slot — we spent this iteration on a bad row, and the
        // remaining array is already reduced. Continue drawing until n or
        // pool exhausted, but don't spend more than VALIDATION_MAX_RETRIES
        // consecutive bad draws for one slot.
      }
    }
    return out;
  };

  return [
    ...pickWithRetries(seenPool, seenTarget),
    ...pickWithRetries(unseenPool, unseenTarget),
  ];
}

/**
 * Cluster same-source questions so they sort adjacent in the paper.
 *
 * A "source" is a group_ref, or (fallback) a shared image URL, or (fallback)
 * a shared long passage in the statement. See exam-composer.validators.js
 * sourceHashOf() for the precedence.
 *
 * Stable within each cluster — preserves the input order among siblings.
 */
function applySourceGrouping(picks) {
  // Bucket by sourceHash, remember the first-appearance order per bucket.
  const buckets = new Map(); // key -> { firstIdx, items: [] }
  picks.forEach((q, i) => {
    const key = sourceHashOf(q);
    if (!buckets.has(key)) buckets.set(key, { firstIdx: i, items: [] });
    buckets.get(key).items.push(q);
  });
  // Emit buckets in first-appearance order, preserving intra-bucket order.
  return [...buckets.values()]
    .sort((a, b) => a.firstIdx - b.firstIdx)
    .flatMap(b => b.items);
}

/**
 * Main entry point: compose a full exam from a Flow-submitted request.
 * Throws { code: 'INSUFFICIENT_POOL', bucket, needed, got } on pool shortage.
 */
async function composeExam({ userId, type, grade, subject, language, chapters, question_types }) {
  const blueprint = getBlueprint(grade, subject, type);
  logToFile('[exam-composer] blueprint resolved', {
    userId, type, grade, subject, language, chapters,
    questionTypes: Array.isArray(question_types) ? question_types : null,
    duration: blueprint.duration_minutes,
    criteriaType: blueprint.criteria.type,
  });

  let pool = await loadPool({ grade, subject, language, chapters });
  logToFile('[exam-composer] pool loaded', { total: pool.length });

  // Filter by user-picked question types (if any). Empty/unknown = no filter,
  // which is the back-compat behaviour for old client caches that submit a
  // request without the question_types field.
  const bankTypeFilter = bankTypesForQuestionTypes(question_types);
  if (bankTypeFilter) {
    const before = pool.length;
    pool = pool.filter(q => bankTypeFilter.has(q.type));
    logToFile('[exam-composer] pool filtered by question_types', {
      before, after: pool.length,
      types: [...bankTypeFilter],
    });
  }

  // If the pool is bone empty, fail fast with a specific error.
  if (pool.length === 0) {
    const err = new Error('empty pool');
    err.code = 'EMPTY_POOL';
    throw err;
  }

  // For each bucket in blueprint.criteria.breakdown, sample its share.
  const criterionType = blueprint.criteria.type;
  const breakdown = blueprint.criteria.breakdown;
  let allPicks = [];
  for (const [bucketName, count] of Object.entries(breakdown)) {
    if (!count || count <= 0) continue;
    const bucketPool = filterToBucket(pool, criterionType, bucketName);
    // Validated sampler — rejects rows failing any of the four post-generation
    // gates (missing images / MCQ < 4 opts / match-columns half-empty), swaps
    // with a fresh draw from the same subpool. See exam-composer.validators.js.
    const picked = sampleBucketValidated(bucketPool, count, blueprint.seen_pct, blueprint.unseen_pct);
    const gotPct = (picked.length / count) * 100;
    if (gotPct < MIN_BUCKET_FILL_PCT) {
      const err = new Error(`insufficient pool for bucket ${bucketName}`);
      err.code = 'INSUFFICIENT_POOL';
      err.bucket = bucketName;
      err.needed = count;
      err.got = picked.length;
      throw err;
    }
    allPicks.push(...picked);
  }

  // Expand groups so passages/etc are complete.
  allPicks = await expandGroups(allPicks, pool);

  // Tag each with its section for downstream ordering + rendering.
  for (const q of allPicks) q._section = sectionOf(q.type);

  // Source-grouping pass — cluster questions sharing an image / passage
  // BEFORE position assignment so same-source rows sort adjacent. The
  // existing orderPicks anchors on chapter/index but a shared image across
  // separate chapter bank rows would still scatter without this.
  allPicks = applySourceGrouping(allPicks);

  // Order for the paper.
  const ordered = orderPicks(allPicks);

  // Compute totals.
  const totalMarks = Math.round(ordered.reduce((s, q) => s + (q.score || 0), 0));

  // Persist: exams + exam_questions.
  const { data: examRow, error: examErr } = await supabase
    .from('exams')
    .insert({
      created_by_user_id: userId,
      type,
      grade,
      subject,
      language,
      chapters,
      total_questions: ordered.length,
      total_marks: totalMarks,
      duration_minutes: blueprint.duration_minutes,
      status: 'composing',
    })
    .select()
    .single();
  if (examErr) throw new Error(`insert exam failed: ${examErr.message}`);

  const snapshotRows = ordered.map((q, i) => ({
    exam_id: examRow.id,
    order_index: i + 1,
    source_bank_id: q.id,
    section: q._section,
    question_format: q.type, // question_format used for sub-heading grouping
    statement_snapshot: q.question_statement,
    options_snapshot: q.answer_options || [],
    correct_answer_snapshot: q.correct_answer,
    marking_scheme_snapshot: q.marking_scheme,
    media_snapshot: q.question_media || [],
    score: q.score,
    bloom_tags: q.bloom_tags || [],
    group_ref: q.group_ref || null,
  }));
  const { error: qErr } = await supabase.from('exam_questions').insert(snapshotRows);
  if (qErr) throw new Error(`insert exam_questions failed: ${qErr.message}`);

  const groupMeta = await loadGroupMeta(ordered);

  // Normalise the picks to snapshot shape so the renderer reads the same
  // field names it would read from an exam_questions row on a re-render.
  const renderable = ordered.map(q => ({
    order_index: null,
    source_bank_id: q.id,
    section: q._section,
    question_format: q.type,
    statement_snapshot: q.question_statement,
    options_snapshot: q.answer_options || [],
    correct_answer_snapshot: q.correct_answer,
    marking_scheme_snapshot: q.marking_scheme,
    media_snapshot: q.question_media || [],
    score: q.score,
    bloom_tags: q.bloom_tags || [],
    group_ref: q.group_ref || null,
  }));

  logToFile('[exam-composer] composed', {
    examId: examRow.id, totalQuestions: renderable.length, totalMarks,
    groups: groupMeta.size,
  });

  return { exam: examRow, questions: renderable, groupMeta };
}

module.exports = {
  composeExam,
  sectionOf,
  QUESTION_TYPE_MAP,
  bankTypesForQuestionTypes,
  // Post-generation validation surface (bd-2013).
  sampleBucketValidated,
  applySourceGrouping,
};
