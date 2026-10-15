'use strict';
/**
 * One definition of "a teacher asked for an assessment".
 *
 * A request becoming a job is eleven fields agreeing with each other twice: the
 * assessment_requests row and the queued payload describe the same paper, in
 * different vocabularies (grade_code vs grade, has_answer_key vs
 * includeAnswerKey). Until this file existed that agreement lived halfway down
 * the WhatsApp Flow endpoint, hardcoded to `surface: 'whatsapp'` and exported
 * only under `_internal` for tests.
 *
 * A second surface could not call that, and copying it is worse than calling
 * it: a copy agrees on the day it is written and drifts every day after. The
 * same reasoning moved the lesson-plan enqueue to a shared service, and the same
 * reasoning is why the portal will reach this over the internal API rather than
 * writing its own row.
 *
 * ORDER MATTERS. The row is written first and the job queued second, because
 * the row is what the worker is handed and what the watchdog looks for: a
 * queued job that refers to nothing is a job that fails at pickup with nothing
 * to record it against, while a row with no job is a visible, retryable stall.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

/**
 * Where the paper goes when it is built.
 *
 *   'whatsapp'  push it to her chat — the default, and what every job written
 *               before this flag existed meant. An old message still in the
 *               queue carries no `deliver` at all, so the orchestrator's own
 *               default has to agree with this one.
 *   'none'      build it and stop. The portal polls and downloads; there is
 *               nobody to message, and trying would either fail (no 24-hour
 *               window) or cost a template she did not ask for.
 */
const DELIVER = { WHATSAPP: 'whatsapp', NONE: 'none' };

/** Which surfaces may ask. Mirrors the CHECK on assessment_requests.surface. */
const SURFACES = ['whatsapp', 'portal', 'api'];

/**
 * Delivery follows from the surface, and is not a caller's choice.
 *
 * Deliberately derived rather than accepted as a parameter: a caller that could
 * pass both would eventually pass a portal request that messages her, or a
 * WhatsApp request that silently does not. There is exactly one sensible
 * mapping and it belongs here.
 */
function deliveryFor(surface) {
  return surface === 'whatsapp' ? DELIVER.WHATSAPP : DELIVER.NONE;
}

/**
 * Write the request down, then queue the work.
 *
 * Throws when the row cannot be written — and does NOT queue in that case. A
 * caller that gets an exception knows nothing happened; a caller that got a
 * silent partial success would poll forever on a request id that does not
 * exist.
 *
 * @returns {Promise<{requestId: string}>}
 */
async function createAndQueue(spec) {
  const {
    userId, surface = 'whatsapp',
    grade, subject, textbookId,
    chapterNumber = null, chapterNumbers = null, pageRanges = null,
    contentSource = 'unseen',
    questionCount,
    totalMarks = null,
    // Both only: the Seen number she typed. Job payload only, like totalMarks —
    // no column holds it, and question_count on the row is still the whole paper.
    seenCount = null,
    questionTypes = [],
    answerLines = true,
    outputFormat = 'pdf',
    // A board-pattern paper: the pattern id and where its pages came from
    // ({ kind: 'fde'|'chapters'|'pages', chapters, pages }). Job payload ONLY —
    // the row already says everything a pattern changes (the slot-tagged
    // question_types, the pages, the count), and no column is added for it.
    pattern = null,
    scope = null,
  } = spec;

  // Every paper gets an answer key, and she is no longer asked (bd-bfnsk). A
  // caller that still passes includeAnswerKey=false is overruled HERE, the one
  // place both the row and the job are shaped, so no surface can drift.
  const includeAnswerKey = true;

  if (!SURFACES.includes(surface)) {
    throw new Error(`unknown surface: ${surface}`);
  }

  const { data: request, error } = await supabase
    .from('assessment_requests')
    .insert({
      user_id: userId,
      surface,
      // grade_code / subject_code are FKs to grade_levels(code) and
      // subjects(code) — not the bare numbers the generator works in.
      grade_code: `grade_${grade}`,
      subject_code: subject,
      textbook_id: textbookId,
      // INTEGER column. A multi-chapter request names no single chapter and
      // records its coverage in page_ranges instead; the CHECK constraint
      // (chapter_number IS NOT NULL OR page_ranges IS NOT NULL) still holds.
      chapter_number: Array.isArray(chapterNumber) ? null : chapterNumber,
      page_ranges: pageRanges,
      content_source: contentSource,
      question_count: questionCount,
      question_types: questionTypes,
      has_answer_key: includeAnswerKey,
      has_answer_lines: answerLines !== false,
      output_format: outputFormat,
    })
    .select('id')
    .single();

  if (error || !request) {
    throw new Error(`could not record the request: ${error?.message}`);
  }

  // Required late, not at module load: the queue pulls in the AWS SDK, and this
  // module is required by route files that must stay loadable in a test process
  // with no AWS configuration at all.
  const SQSQueueService = require('../queue');

  await SQSQueueService.queueJob(userId, 'assessment_generate', {
    userId,
    requestId: request.id,
    grade,
    subject,
    chapterNumber,
    chapterNumbers,
    pageRanges,
    contentSource,
    questionCount,
    totalMarks,
    seenCount,
    questionTypes,
    includeAnswerKey,
    answerLines: answerLines !== false,
    outputFormat,
    deliver: deliveryFor(surface),
    // Spread in only when set: an ordinary paper's payload must not gain even
    // an undefined key, so it stays byte-for-byte the job it was before.
    ...(pattern ? { pattern, scope } : {}),
  });

  logToFile('[assessment] queued', {
    userId, requestId: request.id, surface,
    grade, subject, chapter: chapterNumber, chapters: chapterNumbers,
    ...(pattern ? { pattern, scopeKind: scope ? scope.kind : null } : {}),
  });

  return { requestId: request.id };
}

/** Paper statuses that mean "still being made". */
const BUSY_STATUSES = ['queued', 'generating'];

/**
 * How long a request with no paper row yet still counts as waiting in the queue. A worker opens
 * the row within seconds of picking the job up; one with no row after this long never reached a
 * worker (its enqueue failed after the row was written), and must not lock her out.
 */
const QUEUED_BUSY_MS = 3 * 60 * 1000;

/**
 * The board-pattern request this teacher already has in flight for this class,
 * if any: `{ id }` or null. One paper per class at a time — a second tap on
 * Make while the first is still being written would otherwise queue a second
 * three-minute job for the same paper.
 *
 * assessment_requests carries neither a status (that lives on the paper row)
 * nor a pattern column, so: one read on (user_id, created_at) — the index the
 * table already has — for this grade and subject over the last few minutes,
 * with each request's papers embedded. In JS, a request is a PATTERN request
 * when its question_types carry a `slot` (only pattern requests write them),
 * and it is busy when it has no generated paper yet and was asked for in the last
 * three minutes (still queued), or its
 * generated paper (edited_from null; later versions are edits, not the
 * original job) is queued or generating. A ready or failed paper never blocks.
 *
 * FAILS OPEN: a read error returns null and is logged. A database hiccup must
 * never stop a teacher making a paper; the worst case is the duplicate this
 * guard exists to prevent, which the worker's own duplicate check still bounds.
 * `pattern` is accepted for the caller's clarity; with one pattern in the
 * registry a slot identifies it.
 */
// eslint-disable-next-line no-unused-vars
async function findGenerating({ userId, grade, subject, pattern = null, withinMinutes = 10, now = Date.now() } = {}) {
  try {
    const nowMs = Number(now instanceof Date ? now.getTime() : now);
    const since = new Date(nowMs - withinMinutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('assessment_requests')
      .select('id, question_types, created_at, assessment_papers(status, edited_from)')
      .eq('user_id', userId)
      .eq('grade_code', `grade_${grade}`)
      .eq('subject_code', subject)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const types = Array.isArray(row.question_types) ? row.question_types : [];
      if (!types.some((t) => t && t.slot)) continue;
      const papers = [].concat(row.assessment_papers || []);
      const generated = papers.find((p) => p && p.edited_from == null);
      if (generated && BUSY_STATUSES.includes(generated.status)) return { id: row.id };
      const age = nowMs - new Date(row.created_at).getTime();
      if (!generated && Number.isFinite(age) && age < QUEUED_BUSY_MS) return { id: row.id };
    }
    return null;
  } catch (err) {
    logToFile('[assessment] generating check failed — allowing the request', {
      userId, grade, subject, error: err?.message,
    });
    return null;
  }
}

module.exports = { createAndQueue, findGenerating, deliveryFor, DELIVER, SURFACES };
