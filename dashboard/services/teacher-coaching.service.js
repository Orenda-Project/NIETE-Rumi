'use strict';
/**
 * bd-fmf24g.4 — teacher app v2: the Digital Coaching + Observations reads the portal had no source for.
 * Pure over an injected `query(sql, params)` (the dashboard's pg pool), so every rule here is tested
 * without a database. Routes: dashboard/routes/portal-teacher-coaching.routes.js.
 *
 * What already exists and is NOT repeated here: a session's report content, recording, voice note,
 * photos and the Digital Coach pipeline stage come from GET /coaching-session/:id and
 * GET /coaching-session/:id/progress (portal.routes.js); her finished lessons and the coach visits
 * sent to her come from GET /coaching-sessions.
 *
 * Every statement carries a `teacher-coaching:<name>` comment so a test can answer it by name.
 */

const { getOverall } = require('./coaching-frameworks.service');
const LpHistory = require('./lp-history.service');
const { pkToday, pkInstantWindow } = require('../lib/pk-range');

const OBSERVATION = 'leader_observation';
const STOPPED = "('failed', 'cancelled', 'abandoned')";
/** Statuses before her audio was confirmed: not a lesson she sent yet. */
const NOT_STARTED = "('initiated', 'pending')";
const JOURNEY_POINTS = 12;
const IN_PROGRESS_DAYS = 60;
const HISTORY_LIMIT = 1000;

// NIETE's users table has ONE name column, `name`: never first_name / last_name.
const nameOf = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const dayOf = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const pkDayOf = (at) => (at ? pkToday(new Date(at)) : null);
const percentOf = (scores) => {
  if (!scores || typeof scores !== 'object') return null;
  const { percentage } = getOverall({ scores });
  return percentage == null || !Number.isFinite(Number(percentage)) ? null : Math.round(Number(percentage));
};

/* ── her next coach visit ──────────────────────────────────────────────── */

const PHONE_SQL = '/* teacher-coaching:phone */ SELECT phone_number FROM users WHERE id = $1';

// observation_schedules has no teacher user id: teacher_ext_id is her users.phone_number
// (leader-schedule-write.service.js). Compared as digits on both sides, so '+92 300-…' and
// '92300…' are the same teacher — and only ever her own number, read from her own row.
const NEXT_VISIT_SQL = `/* teacher-coaching:next-visit */
  SELECT s.scheduled_for, s.scheduled_slot, s.school_name, u.name AS coach_name
    FROM observation_schedules s
    LEFT JOIN users u ON u.id = s.leader_user_id
   WHERE regexp_replace(COALESCE(s.teacher_ext_id, ''), '\\D', '', 'g') = $1
     AND s.status = 'upcoming'
     AND s.scheduled_for >= $2::date
   ORDER BY s.scheduled_for ASC, s.created_at ASC
   LIMIT 1`;

async function nextVisit(query, userId, { today = pkToday() } = {}) {
  const { rows: who } = await query(PHONE_SQL, [userId]);
  const phone = digits(who && who[0] && who[0].phone_number);
  if (!phone) return null;
  const { rows } = await query(NEXT_VISIT_SQL, [phone, today]);
  const r = rows && rows[0];
  if (!r) return null;
  return {
    date: dayOf(r.scheduled_for),
    slot: r.scheduled_slot || null,
    coachName: nameOf(r.coach_name),
    schoolName: r.school_name || null,
  };
}

/* ── coach visits being worked on ──────────────────────────────────────── */

// Her coach visits not yet sent to her. Only the stage, the day and the coach leave the server:
// a draft's scores and notes are the coach's until the report is sent (teacher-observation.js).
const IN_PROGRESS_SQL = `/* teacher-coaching:in-progress */
  SELECT cs.id, cs.created_at, cs.status, cs.debrief_status, u.name AS coach_name
    FROM coaching_sessions cs
    LEFT JOIN users u ON u.id = cs.observer_user_id
   WHERE cs.user_id = $1
     AND cs.observation_type = '${OBSERVATION}'
     AND COALESCE(cs.analysis_data->'teacher_delivery'->>'status', '') <> 'sent'
     AND cs.status NOT IN ${STOPPED}
     AND cs.created_at >= now() - ($2::int * interval '1 day')
   ORDER BY cs.created_at DESC
   LIMIT 5`;

/** reviewing (the coach is checking the draft) → debrief (talk it through) → report (being sent). */
function hitlStage(row) {
  if (row && row.debrief_status === 'done') return 'report';
  if (row && row.status === 'observer_review_complete') return 'debrief';
  return 'reviewing';
}

async function visitsInProgress(query, userId) {
  const { rows } = await query(IN_PROGRESS_SQL, [userId, IN_PROGRESS_DAYS]);
  return (rows || []).map((r) => ({
    sessionId: r.id,
    date: pkDayOf(r.created_at),
    coachName: nameOf(r.coach_name),
    stage: hitlStage(r),
  }));
}

/* ── the journey line on a report ──────────────────────────────────────── */

const OWNER_SQL = '/* teacher-coaching:owner */ SELECT id, created_at FROM coaching_sessions WHERE id = $1 AND user_id = $2';

const JOURNEY_SQL = `/* teacher-coaching:journey */
  SELECT created_at, analysis_data->'scores' AS scores
    FROM coaching_sessions
   WHERE user_id = $1
     AND status = 'completed'
     AND created_at <= $2
   ORDER BY created_at DESC
   LIMIT $3`;

/** Her scored sessions up to and including this one, oldest first; null when it is not hers. */
async function journey(query, userId, sessionId) {
  const { rows: own } = await query(OWNER_SQL, [sessionId, userId]);
  const session = own && own[0];
  if (!session) return null;
  const { rows } = await query(JOURNEY_SQL, [userId, session.created_at, JOURNEY_POINTS]);
  return (rows || [])
    .map((r) => ({ date: pkDayOf(r.created_at), pct: percentOf(r.scores) }))
    .filter((p) => p.pct != null && p.pct > 0)
    .reverse();
}

/* ── All DC observations ───────────────────────────────────────────────── */

// Her Digital Coach lessons (observation_type NULL — a coach visit is on Observations), from the
// moment she sent the audio, analysing ones included; stopped ones left out. Only the JSON paths the
// list shows are read — never the whole analysis_data (up to ~30 KB a row; class R).
const HISTORY_SQL = `/* teacher-coaching:history */
  SELECT id, created_at, status, audio_duration_seconds,
         analysis_data->'scores' AS scores,
         analysis_data->>'topic' AS topic,
         analysis_data->>'subject' AS subject,
         analysis_data->'subject_resolution'->>'grade' AS grade
    FROM coaching_sessions
   WHERE user_id = $1
     AND observation_type IS NULL
     AND status NOT IN ${STOPPED}
     AND status NOT IN ${NOT_STARTED}
     AND ${pkInstantWindow('created_at', '$2', '$3')}
   ORDER BY created_at DESC
   LIMIT $4`;

async function readHistory(query, userId, from, to) {
  const { rows } = await query(HISTORY_SQL, [userId, from, to, HISTORY_LIMIT]);
  return (rows || []).map((r) => {
    const grade = r.grade != null && r.grade !== '' ? Number(r.grade) : null;
    const seconds = Number(r.audio_duration_seconds);
    return {
      id: r.id,
      date: pkDayOf(r.created_at),
      topic: r.topic || null,
      subject: r.subject || null,
      grade: Number.isInteger(grade) ? grade : null,
      minutes: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : null,
      percentage: percentOf(r.scores),
      reportReady: r.status === 'completed',
    };
  });
}

function kpisOf(items) {
  return {
    sessions: items.length,
    minutes: items.reduce((t, i) => t + (i.minutes || 0), 0),
    reports: items.filter((i) => i.reportReady).length,
  };
}

function trendOf(items, range) {
  const from = range.from || (items.length ? items[items.length - 1].date : null);
  const to = range.to || (items.length ? items[0].date : null);
  if (!from || !to) return { bucketDays: 1, points: [] };
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  const bucketDays = LpHistory.bucketDaysFor(days);
  const points = new Array(Math.ceil(days / bucketDays)).fill(0);
  for (const i of items) {
    const at = Math.round((new Date(`${i.date}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
    const b = Math.floor(at / bucketDays);
    if (b >= 0 && b < points.length) points[b] += 1;
  }
  return { bucketDays, points };
}

/**
 * "All DC observations" for a resolved range (lib/pk-range resolveRange). `previous` is the client's
 * own period before when it sent one, else the same stretch one step back; All time has none.
 */
async function dcHistory(query, userId, { range, previous } = {}) {
  const items = await readHistory(query, userId, range.from || null, range.to || null);
  const before = previous || LpHistory.previousRange(range);
  const prevItems = before ? await readHistory(query, userId, before.from, before.to) : null;
  const now = kpisOf(items);
  const then = prevItems ? kpisOf(prevItems) : null;
  const pair = (k) => ({ value: now[k], previous: then ? then[k] : null });
  return {
    previous: before || null,
    kpis: { sessions: pair('sessions'), minutes: pair('minutes'), reports: pair('reports') },
    trend: trendOf(items, range),
    items,
    total: items.length,
    truncated: items.length >= HISTORY_LIMIT,
  };
}

module.exports = {
  hitlStage,
  nextVisit,
  visitsInProgress,
  journey,
  dcHistory,
};
