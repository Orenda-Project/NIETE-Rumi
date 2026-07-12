/**
 * Exam Composer — turns a Flow-submitted request
 *   { user_id, type: 'WEEKLY'|'TERM', grade, subject, language, chapters: [1,2] }
 * into a specific set of question picks.
 *
 * Reads: exam_question_bank (filtered), exam_question_groups.
 * Writes: exams + exam_questions rows (as snapshots).
 * Emits: the composed exam { exam, questions } for the renderer to consume.
 *
 * See docs/migration/05-exam-generator.md — this file implements the
 * "Composition — blueprints + algorithm" section.
 */

const { getBlueprint } = require('./exam-composer.blueprints');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

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
 * Order picks by section (objective first) → chapter_index → index_in_chapter.
 * Groups are kept contiguous by anchoring on the first sibling's chapter/index.
 */
function orderPicks(picks) {
  // Precompute a stable per-group sort anchor: min(chapter_index, index_in_chapter)
  // across all group members, then sort all rows by (section, anchor).
  const groupAnchor = new Map(); // group_ref -> { chapter_index, index_in_chapter }
  for (const q of picks) {
    if (!q.group_ref) continue;
    const cur = groupAnchor.get(q.group_ref);
    const key = [q.chapter_index, q.index_in_chapter];
    if (!cur || key < [cur.chapter_index, cur.index_in_chapter]) {
      groupAnchor.set(q.group_ref, { chapter_index: q.chapter_index, index_in_chapter: q.index_in_chapter });
    }
  }
  return [...picks].sort((a, b) => {
    // Section: objective first
    if (a._section !== b._section) return a._section === 'objective' ? -1 : 1;
    // Group anchor
    const aAnchor = a.group_ref ? groupAnchor.get(a.group_ref) : { chapter_index: a.chapter_index, index_in_chapter: a.index_in_chapter };
    const bAnchor = b.group_ref ? groupAnchor.get(b.group_ref) : { chapter_index: b.chapter_index, index_in_chapter: b.index_in_chapter };
    if (aAnchor.chapter_index !== bAnchor.chapter_index) return aAnchor.chapter_index - bAnchor.chapter_index;
    if (aAnchor.index_in_chapter !== bAnchor.index_in_chapter) return aAnchor.index_in_chapter - bAnchor.index_in_chapter;
    // Within a group: preserve the sibling ordering
    return a.index_in_chapter - b.index_in_chapter;
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
 * Main entry point: compose a full exam from a Flow-submitted request.
 * Throws { code: 'INSUFFICIENT_POOL', bucket, needed, got } on pool shortage.
 */
async function composeExam({ userId, type, grade, subject, language, chapters }) {
  const blueprint = getBlueprint(grade, subject, type);
  logToFile('[exam-composer] blueprint resolved', {
    userId, type, grade, subject, language, chapters,
    duration: blueprint.duration_minutes,
    criteriaType: blueprint.criteria.type,
  });

  const pool = await loadPool({ grade, subject, language, chapters });
  logToFile('[exam-composer] pool loaded', { total: pool.length });

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
    const picked = sampleBucket(bucketPool, count, blueprint.seen_pct, blueprint.unseen_pct);
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

module.exports = { composeExam, sectionOf };
