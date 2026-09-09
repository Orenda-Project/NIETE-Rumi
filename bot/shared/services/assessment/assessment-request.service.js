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
 * same reasoning moved the lesson-plan enqueue here (bd-60063), and the same
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
    chapterNumber = null, pageRanges = null,
    contentSource = 'unseen',
    questionCount,
    questionTypes = [],
    includeAnswerKey = false,
    answerLines = true,
    outputFormat = 'pdf',
  } = spec;

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
      chapter_number: chapterNumber,
      page_ranges: pageRanges,
      content_source: contentSource,
      question_count: questionCount,
      question_types: questionTypes,
      has_answer_key: !!includeAnswerKey,
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
    pageRanges,
    contentSource,
    questionCount,
    questionTypes,
    includeAnswerKey: !!includeAnswerKey,
    answerLines: answerLines !== false,
    outputFormat,
    deliver: deliveryFor(surface),
  });

  logToFile('[assessment] queued', {
    userId, requestId: request.id, surface,
    grade, subject, chapter: chapterNumber,
  });

  return { requestId: request.id };
}

module.exports = { createAndQueue, deliveryFor, DELIVER, SURFACES };
