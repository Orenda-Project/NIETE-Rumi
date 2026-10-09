'use strict';
/**
 * bd-fmf24g.15 — what a teacher asked for that takes a while, and where it has got to, kept on the server.
 *
 * WHY. The teacher app follows a paper or a grades 6-12 lesson plan app-wide (the strip, the ready banner),
 * and keeps a finished one on Home ("Ready for you"). Until now the only memory of it was the browser's, so a
 * refresh or a second phone lost it, and nothing recorded whether she had seen or opened it. This is that
 * record, and the read that rebuilds the strip and Home from it.
 *
 * NO NEW TABLE. Each item is a row that already exists per teacher:
 *   paper        assessment_requests (surface 'portal') + its latest attempt in assessment_papers
 *   lesson plan  niete_lp612_renders she is waiting on (waiters / requested_by), and — once written — her
 *                'portal' rows in niete_lp612_deliveries (the bot's per-teacher claim, bd-5rz1v.21)
 * and two nullable timestamps on the two per-teacher rows hold what only the app knows:
 *   notice_seen_at    she CLOSED the ready banner with its X (or went to Home from it). A banner that ran its 10
 *                     seconds untouched is not seen: nothing is written, so the WhatsApp fallback may still follow
 *   notice_opened_at  she opened it — or, for a failed paper, tapped it
 * A lesson plan opened ANY way (the viewer, WhatsApp's link, Recent) is already in niete_lp_opens; that counts
 * as opened too, so a teacher who opens it some other way never sees it again on Home.
 *
 * WHAT IS LISTED. Only what the app still needs:
 *   being made   for under 30 minutes (a worker that lost it must not leave "Being made" on her screen for ever;
 *                the waiting page can still ask about it)
 *   ready        not opened, and inside its 24 WEEKDAY hours (lib/weekday-hours), stamped `homeUntil`
 *   failed       a paper she has not tapped, from the last day. A failed lesson plan is not listed: its waiter
 *                list is emptied when it ends, so there is no per-teacher row to mark her tap on.
 * Ready lesson plans are the ones she WAITED for (delivered within two minutes of the render completing); one
 * that was already written when she asked she opens at once and is not "made for you".
 *
 * Every id is the session's user's; an id that is not hers is "not found", never an error that says it exists.
 * Reads THROW on a database error (the route answers 502): an empty list would tell her nothing is waiting.
 *
 * Nothing here sends a message. The WhatsApp fallback is the bot's, and reads these same two timestamps.
 */

const { weekdayDeadline } = require('../lib/weekday-hours');
// The assessment's own names for its subjects ("Science", "Maths"), as the paper list shows them.
const { subjectLabel } = require('../../bot/shared/services/assessment/assessment-vocabulary');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const MAKING_MAX_AGE = 30 * MIN;
const FAILED_MAX_AGE = DAY;
const HOME_WEEKDAY_HOURS = 24;
/** Far enough back to hold a Friday-evening item on Monday evening; the weekday rule does the exact cut. */
const READ_WINDOW = 4 * DAY;
/** A delivery within this of the render completing is one she waited for. */
const WAITED_SECONDS = 120;

const PAPERS_SQL = `
  SELECT r.id AS request_id, r.grade_code, r.subject_code, r.chapter_number,
         r.question_count AS requested_questions, r.created_at, r.notice_seen_at, r.notice_opened_at,
         p.id AS paper_id, p.status AS paper_status, p.error_code, p.ready_at, p.question_count AS paper_questions
    FROM assessment_requests r
    LEFT JOIN LATERAL (
      SELECT p.id, p.status, p.error_code, p.ready_at, p.question_count
        FROM assessment_papers p
       WHERE p.request_id = r.id AND p.edited_from IS NULL
       ORDER BY p.attempt DESC
       LIMIT 1) p ON true
   WHERE r.user_id = $1::uuid
     AND r.surface = 'portal'
     AND r.created_at > $2::timestamptz
   ORDER BY r.created_at DESC
   LIMIT 30`;

const READY_LESSONS_SQL = `
  WITH d AS (
    SELECT dl.user_id, dl.render_id, dl.segment_id, dl.lang,
           MAX(dl.delivered_at) AS delivered_at,
           MAX(dl.notice_seen_at) AS notice_seen_at,
           MAX(dl.notice_opened_at) AS notice_opened_at
      FROM niete_lp612_deliveries dl
     WHERE dl.user_id = $1::uuid
       AND dl.surface = 'portal'
       AND dl.render_id IS NOT NULL
       AND dl.delivered_at > $2::timestamptz
     GROUP BY dl.user_id, dl.render_id, dl.segment_id, dl.lang)
  SELECT d.render_id, d.segment_id, d.lang, d.delivered_at, d.notice_seen_at, d.notice_opened_at,
         rn.started_at,
         (SELECT MIN(o.opened_at) FROM niete_lp_opens o
           WHERE o.user_id = d.user_id AND o.plan_kind = 'g612' AND o.plan_ref = d.segment_id
             AND o.lang IS NOT DISTINCT FROM d.lang AND o.opened_at >= d.delivered_at) AS opened_in_app,
         s.subtopic_title, s.menu_title, s.grade, s.subject
    FROM d
    JOIN niete_lp612_renders rn ON rn.id = d.render_id
    LEFT JOIN niete_lp612_segments s ON s.segment_id = d.segment_id
   WHERE rn.status = 'ready'
     AND rn.completed_at IS NOT NULL
     AND ABS(EXTRACT(EPOCH FROM (d.delivered_at - rn.completed_at))) < ${WAITED_SECONDS}
   ORDER BY d.delivered_at DESC
   LIMIT 20`;

const PENDING_LESSONS_SQL = `
  SELECT rn.id, rn.segment_id, rn.lang, rn.started_at,
         s.subtopic_title, s.menu_title, s.grade, s.subject
    FROM niete_lp612_renders rn
    LEFT JOIN niete_lp612_segments s ON s.segment_id = rn.segment_id
   WHERE rn.status = 'authoring'
     AND rn.started_at > $2::timestamptz
     AND (rn.requested_by = $1::uuid
          OR rn.waiters @> jsonb_build_array(jsonb_build_object('user_id', $1::text)))
   ORDER BY rn.started_at DESC
   LIMIT 20`;

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const ms = (v) => (v == null ? null : new Date(v).getTime());
const gradeOf = (code) => Number(String(code || '').replace(/^grade_/, '')) || null;

function assertUser(userId) {
  if (typeof userId !== 'string' || !UUID.test(userId)) throw new Error('teacher-notices: userId must be a uuid');
}

/** 'paper:<uuid>' | 'lesson:<uuid>' → { kind, ref }, else null. */
function parseId(id) {
  if (typeof id !== 'string') return null;
  const m = id.match(/^(paper|lesson):([0-9a-f-]{36})$/i);
  return m && UUID.test(m[2]) ? { kind: m[1], ref: m[2] } : null;
}

function paperItem(r, nowMs) {
  const status = r.paper_status;
  const state = status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : 'making';
  const startedAt = iso(r.created_at);
  const readyAt = state === 'ready' ? iso(r.ready_at || r.created_at) : null;
  const opened = r.notice_opened_at != null;
  if (state === 'making' && nowMs - ms(r.created_at) > MAKING_MAX_AGE) return null;
  if (state === 'failed' && (opened || nowMs - ms(r.created_at) > FAILED_MAX_AGE)) return null;
  let homeUntil = null;
  if (state === 'ready') {
    if (opened) return null;
    homeUntil = iso(weekdayDeadline(readyAt, HOME_WEEKDAY_HOURS));
    if (!homeUntil || ms(homeUntil) <= nowMs) return null;
  }
  const key = r.subject_code || null;
  return {
    id: `paper:${r.request_id}`,
    kind: 'paper',
    state,
    title: null,
    grade: gradeOf(r.grade_code),
    subject: key ? subjectLabel(key) : null,
    subjectKey: key,
    chapterNumber: r.chapter_number == null ? null : Number(r.chapter_number),
    questions: r.paper_questions ?? r.requested_questions ?? null,
    startedAt,
    readyAt,
    seenAt: iso(r.notice_seen_at),
    openedAt: iso(r.notice_opened_at),
    homeUntil,
    paperId: state === 'ready' ? r.paper_id : null,
    renderId: null,
    lessonId: null,
    lang: null,
    errorCode: state === 'failed' ? (r.error_code || 'UNKNOWN') : null,
  };
}

const lessonTitle = (r) => r.subtopic_title || r.menu_title || null;

function pendingLessonItem(r, nowMs) {
  if (nowMs - ms(r.started_at) > MAKING_MAX_AGE) return null;
  return {
    id: `lesson:${r.id}`,
    kind: 'lesson',
    state: 'making',
    title: lessonTitle(r),
    grade: r.grade == null ? null : Number(r.grade),
    subject: r.subject || null,
    subjectKey: null,
    chapterNumber: null,
    questions: null,
    startedAt: iso(r.started_at),
    readyAt: null,
    seenAt: null,
    openedAt: null,
    homeUntil: null,
    paperId: null,
    renderId: r.id,
    lessonId: r.segment_id,
    lang: r.lang || null,
    errorCode: null,
  };
}

function readyLessonItem(r, nowMs) {
  const openedAt = r.notice_opened_at || r.opened_in_app || null;
  if (openedAt) return null;
  const readyAt = iso(r.delivered_at);
  const homeUntil = iso(weekdayDeadline(readyAt, HOME_WEEKDAY_HOURS));
  if (!homeUntil || ms(homeUntil) <= nowMs) return null;
  return {
    id: `lesson:${r.render_id}`,
    kind: 'lesson',
    state: 'ready',
    title: lessonTitle(r),
    grade: r.grade == null ? null : Number(r.grade),
    subject: r.subject || null,
    subjectKey: null,
    chapterNumber: null,
    questions: null,
    startedAt: iso(r.started_at || r.delivered_at),
    readyAt,
    seenAt: iso(r.notice_seen_at),
    openedAt: null,
    homeUntil,
    paperId: null,
    renderId: r.render_id,
    lessonId: r.segment_id,
    lang: r.lang || null,
    errorCode: null,
  };
}

/**
 * Her items, newest first.
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 * @returns {Promise<{ items: object[] }>}
 */
async function listNotices(query, userId, { now = new Date() } = {}) {
  assertUser(userId);
  const nowMs = now.getTime();
  const since = new Date(nowMs - READ_WINDOW).toISOString();
  const [papers, ready, pending] = await Promise.all([
    query(PAPERS_SQL, [userId, since]),
    query(READY_LESSONS_SQL, [userId, since]),
    query(PENDING_LESSONS_SQL, [userId, since]),
  ]);
  const items = [
    ...(papers.rows || []).map((r) => paperItem(r, nowMs)),
    ...(ready.rows || []).map((r) => readyLessonItem(r, nowMs)),
    ...(pending.rows || []).map((r) => pendingLessonItem(r, nowMs)),
  ].filter(Boolean);
  items.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return { items };
}

const SEEN_SET = 'notice_seen_at = COALESCE(notice_seen_at, now())';
const OPENED_SET = `notice_opened_at = COALESCE(notice_opened_at, now()), ${SEEN_SET}`;

function updateSql(kind, set) {
  return kind === 'paper'
    ? `UPDATE assessment_requests SET ${set}
        WHERE id = $1::uuid AND user_id = $2::uuid AND surface = 'portal'
        RETURNING id`
    : `UPDATE niete_lp612_deliveries SET ${set}
        WHERE render_id = $1::uuid AND user_id = $2::uuid AND surface = 'portal'
        RETURNING id`;
}

async function mark(query, userId, id, set) {
  assertUser(userId);
  const parsed = parseId(id);
  if (!parsed) return { ok: false, code: 'BAD_ID' };
  const { rows } = await query(updateSql(parsed.kind, set), [parsed.ref, userId]);
  return (rows || []).length ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
}

/** She closed the banner (X, or went to Home from it). Written once; a later call changes nothing. */
const markSeen = (query, userId, id) => mark(query, userId, id, SEEN_SET);
/** She opened it (or tapped a failed paper). Also means seen. Written once. */
const markOpened = (query, userId, id) => mark(query, userId, id, OPENED_SET);

module.exports = {
  listNotices, markSeen, markOpened, parseId,
  HOME_WEEKDAY_HOURS, MAKING_MAX_AGE,
};
