'use strict';
/**
 * bd-pw1ccr.26 — the chapter a teacher's topic-end nudge is held on, for the portal's "Make my paper" card.
 *
 * Held = a topic_end_nudge row skipped because her WhatsApp window was shut (the bot books a retry for the next
 * school day), in the last week, for a teacher whose school is in group B of the topic-nudge draw. It stops being
 * held once a nudge for that topic got through, or once she made a paper for that grade/subject/chapter after
 * taking the plan.
 *
 * skipHeldTopicNudge (bd-pw1ccr.39) is the card tap's write. It used to call the bot's teacher-nudges.store, but the
 * portal build installs none of the bot's packages (dotenv, pino, @supabase/supabase-js under bot/), so on prod every
 * tap 2-13 Nov was a 502 and no retry was skipped. It does the store's skipPendingForTopic through the portal's own
 * Supabase client: pending → skipped, context merged with skip_reason, guarded on status so a claimed row is left alone.
 */

const HELD_SQL = `
SELECT tn.context
  FROM teacher_nudges tn
  JOIN users u ON u.id = tn.user_id
  JOIN niete_topic_nudge_ab_assignment ab ON ab.school_id = u.school_id AND ab.ab_group = 'B'
 WHERE tn.user_id = $1
   AND tn.kind = 'topic_end_nudge'
   AND tn.status = 'skipped'
   AND tn.context->>'skip_reason' = 'window_closed'
   AND tn.nudge_date >= ((now() AT TIME ZONE 'Asia/Karachi')::date - 6)
   AND NOT EXISTS (
     SELECT 1 FROM teacher_nudges s
      WHERE s.user_id = tn.user_id AND s.kind = tn.kind AND s.status = 'sent'
        AND s.context->>'topic_id' = tn.context->>'topic_id')
   AND NOT EXISTS (
     SELECT 1 FROM assessment_requests r
      WHERE r.user_id = tn.user_id
        AND r.grade_code = 'grade_' || (tn.context->>'grade')
        AND r.subject_code = tn.context->>'subject'
        AND r.chapter_number::text = tn.context->>'chapter'
        AND r.created_at >= CASE WHEN tn.context->>'taken_at' ~ '^\\d{4}-'
                                 THEN (tn.context->>'taken_at')::timestamptz ELSE tn.created_at END)
 ORDER BY tn.nudge_date DESC, tn.created_at DESC
 LIMIT 1`;

/** { topicId, topicName, grade, subject, chapter } or null. A database error is thrown, never read as null. */
async function heldTopicNudge(dbQuery, userId) {
  if (!userId) return null;
  const { rows } = await dbQuery(HELD_SQL, [userId]);
  const c = rows && rows[0] && rows[0].context;
  if (!c) return null;
  const grade = Number(c.grade);
  const chapter = Number(c.chapter);
  if (!c.topic_id || !c.subject || !Number.isInteger(grade) || !Number.isInteger(chapter) || chapter < 1) return null;
  return { topicId: String(c.topic_id), topicName: c.topic_name || null, grade, subject: String(c.subject), chapter };
}

const TABLE = 'teacher_nudges';
const KIND = 'topic_end_nudge';
const CARD_USED = 'card_used';

/** Skips her pending topic-end retries for one topic as card_used; returns how many. A database error is thrown. */
async function skipHeldTopicNudge(supabase, userId, topicId) {
  if (!userId || !topicId) return 0;
  const { data, error } = await supabase.from(TABLE).select('id, context')
    .eq('user_id', userId).eq('kind', KIND).eq('status', 'pending').eq('context->>topic_id', topicId);
  if (error) throw new Error(`teacher_nudges read failed: ${error.message}`);
  let skipped = 0;
  for (const row of data || []) {
    const context = { ...(row.context || {}), skip_reason: CARD_USED };
    // eslint-disable-next-line no-await-in-loop
    const { data: updated, error: upErr } = await supabase.from(TABLE)
      .update({ status: 'skipped', context, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending').select('id');
    if (upErr) throw new Error(`teacher_nudges update failed: ${upErr.message}`);
    if ((updated || []).length > 0) skipped += 1;
  }
  return skipped;
}

module.exports = { HELD_SQL, heldTopicNudge, skipHeldTopicNudge };
