'use strict';
/**
 * The delivery marker (bd-wpupy F5).
 *
 * WHY THIS EXISTS. On production, 58 of 60 lesson deliveries wrote NO row to
 * `conversations`. The hand-over was invisible in the dialogue the model reads,
 * so there was a hole exactly where the lesson should be — and when a teacher
 * then said "give me this in text form", the nearest antecedent for "this" was
 * whatever she happened to discuss days earlier. One operator got a Grade 5
 * fractions plan from 17 days back; another teacher got a job-application letter
 * template 17 seconds after receiving a Grade 3 maths lesson.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY. Grade, chapter and segment only — no
 * chapter title, no topic, no lesson content. A marker naming
 * "Ch 1 Green Guardians of Earth" hands the model a title to elaborate from
 * when it lacks the body, which is the grounding-drift pattern (bd-1581 on the
 * sibling bot) in miniature. The marker's job is to ANCHOR a pronoun, not to
 * inform an answer; the answer comes from lp-context's <lesson_reference>.
 *
 * DEDUPED. The same lesson is routinely delivered several times in a couple of
 * minutes (real: `grade_5_math_ch5_seg8` four times in two minutes). Four
 * identical markers would burn history budget and imply four different lessons.
 */

const { storeConversation } = require('../database/bot-helpers');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * The marker text. Stable and parseable on purpose: it is matched back for the
 * dedup check, so it must not vary with time, language or teacher.
 */
function markerText({ grade, subject, chapterNumber, segmentLabel }) {
  const bits = [`Grade ${grade}`, subject].filter(Boolean).join(' ');
  const ch = chapterNumber != null ? `, Chapter ${chapterNumber}` : '';
  const seg = segmentLabel ? ` (${segmentLabel})` : '';
  return `[lesson plan sent] ${bits}${ch}${seg}`;
}

/**
 * Record that a lesson plan was handed over, once.
 * NEVER throws: the PDF has already reached her by the time this runs, and a
 * bookkeeping failure must not turn a successful delivery into a failed one.
 */
async function recordDeliveryMarker({ userId, grade, subject, chapterNumber, segmentLabel, lessonId }) {
  if (!userId) return false;
  try {
    const text = markerText({ grade, subject, chapterNumber, segmentLabel });

    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('role', 'assistant')
      .eq('content', text)
      .gte('created_at', since)
      .limit(1);
    if (error) throw new Error(error.message);
    if (data && data.length) {
      logEvent('lp_delivery_marker.deduped', { userId, lessonId });
      return false;
    }

    await storeConversation(userId, 'assistant', text, 'text');
    logEvent('lp_delivery_marker.written', { userId, lessonId });
    return true;
  } catch (err) {
    logToFile('LP delivery marker failed (non-blocking)', { userId, lessonId, error: err.message });
    return false;
  }
}

module.exports = { recordDeliveryMarker, markerText, DEDUP_WINDOW_MS };
