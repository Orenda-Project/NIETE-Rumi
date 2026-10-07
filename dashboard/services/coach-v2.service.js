/**
 * bd-o15qnr.3 — the coach app v2's read side (behind app_settings.portal_coach_v2).
 *
 * Every number is computed from tables that already exist; nothing new is
 * stored (Rule 15, schema checked live 2026-10-06):
 *   observation_schedules      a coach's visits (scheduled_for, scheduled_slot, status, session_id)
 *   coaching_sessions          HITL = observation_type 'leader_observation' (observer_user_id is
 *                              the coach, user_id the observed teacher); DC = a teacher's own
 *                              recording (observation_type null)
 *   teacher_training_progress  completed_at per module, so "last training" is max(completed_at)
 *   leader_schools             the coach's schools
 *   the patch resolver         the coach's teachers and their lifetime counts
 *
 * Scores are framework-agnostic percentages via getOverall, counted only for
 * observations that reached review (TERMINAL — the same rule the patch and the
 * Observations page use). A visit still in flight counts as a visit, never as a
 * score.
 *
 * `query` is injected ((sql, params) => Promise<{rows}>) like every leader-*
 * service, so this is unit-testable without a live DB.
 */

const { getOverall } = require('./coaching-frameworks.service');
const { getPatchTeachers } = require('./leader-patch.service');
const { ACTIVITY_CTE } = require('./lp-activity.service');
// bd-o15qnr.23: "today" is the day in Pakistan, not the UTC date — overdue, Home's
// today, the week and the team schedule all count from it.
const { karachiToday } = require('../lib/visit-time');

const TERMINAL_STATUSES = ['completed', 'observer_review_complete'];
/** The teaching levels a coach may set, in canonical order (bot: utils/teacher-level VALID_LEVELS). */
const TEACHING_LEVELS = ['PRIMARY', 'MIDDLE', 'HIGH'];
const DEAD_STATUSES = ['failed', 'cancelled'];
const SCHOOL_VISIT_WINDOW_DAYS = 90;

/**
 * A coach observation started in the PORTAL can be opened in the portal; one
 * captured on WhatsApp cannot (the portal's observation view refuses it).
 * Kept in step with bot/shared/services/coaching/portal-coaching.service.js
 * PORTAL_KEY_RX — a test reads the bot source and compares the two.
 */
const PORTAL_KEY_RX = /\/classroom_audio\/[^/]+\/\d{4}-\d{2}\/portal_[A-Za-z0-9-]+\.[a-z0-9]+$/;

// ── SQL ──────────────────────────────────────────────────────────────────────
//
// analysis_data is never pulled whole (Class R: the 24/25-Aug wedge was full
// analysis_data pulls): only ->'scores' (what getOverall reads) and, for a
// report's name, ->'teacher_delivery', rebuilt into the same shape.
//
// DATE columns come back ::text. node-pg turns a DATE into a JS Date at LOCAL
// midnight, and toISOString() then moves it a day back on any server east of
// UTC (found live on a PKT machine: two 2026-10-05 visits counted on 10-04).

const SQL = {
  LEADER_SCHOOLS: `
    SELECT school_ext_id, school_name, emis
    FROM leader_schools
    WHERE leader_user_id = $1
    ORDER BY school_name ASC NULLS LAST
  `,

  // Every HITL visit of these teachers, by any coach; failed/cancelled never count.
  // bd-o15qnr.9: id, observer (and name), debrief status and audio key too, for
  // the Visit page's Last visit row ("HITL · You", "Report sent", opens or not).
  TEACHER_FACTS: `
    SELECT c.id, c.user_id, c.created_at, c.status, c.debrief_status, c.audio_url,
           c.observer_user_id, ou.name AS observer_name,
           jsonb_build_object('scores', c.analysis_data->'scores') AS analysis_data
    FROM coaching_sessions c
    LEFT JOIN users ou ON ou.id = c.observer_user_id
    WHERE c.user_id = ANY($1::uuid[])
      AND c.observation_type = 'leader_observation'
      AND c.status NOT IN ('failed', 'cancelled')
  `,

  TEACHER_TRAINING: `
    SELECT user_id, max(completed_at) AS last_training_at
    FROM teacher_training_progress
    WHERE user_id = ANY($1::uuid[])
    GROUP BY user_id
  `,

  // THIS coach's observations. The schedule join mirrors
  // leader-observations.service: LATERAL + LIMIT 1 because markDone stamps
  // session_id on every matching upcoming row.
  COACH_SESSIONS: `
    SELECT c.id, c.user_id, c.created_at, c.status, c.debrief_status, c.audio_url,
           jsonb_build_object('scores', c.analysis_data->'scores',
                              'teacher_delivery', c.analysis_data->'teacher_delivery') AS analysis_data,
           u.name           AS teacher_name,
           u.phone_number   AS teacher_phone,
           os.teacher_name  AS sched_teacher_name,
           os.school_name   AS sched_school_name,
           os.school_ext_id AS sched_school_ext_id,
           os.teacher_ext_id AS sched_teacher_ext_id
    FROM coaching_sessions c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN LATERAL (
      SELECT s.teacher_name, s.school_name, s.school_ext_id, s.teacher_ext_id
      FROM observation_schedules s
      WHERE s.session_id = c.id
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1
    ) os ON true
    WHERE c.observer_user_id = $1 AND c.observation_type = 'leader_observation'
    ORDER BY c.created_at DESC
  `,

  // Her visits in [from, to], plus every still-upcoming visit before today (overdue).
  MY_SCHEDULES: `
    SELECT id, leader_user_id, teacher_name, school_name, school_ext_id, teacher_ext_id,
           scheduled_for::text AS scheduled_for, scheduled_slot, status, session_id
    FROM observation_schedules
    WHERE leader_user_id = $1 AND status <> 'cancelled'
      AND ((scheduled_for BETWEEN $2::date AND $3::date)
           OR (status = 'upcoming' AND scheduled_for < $4::date))
    ORDER BY scheduled_for ASC, scheduled_slot ASC NULLS LAST, created_at ASC
  `,

  // bd-o15qnr.8 — her next upcoming visit on or after today, whatever its date
  // (the Observe hub's "Next: …" chip). Overdue ones (before today) are not "next".
  NEXT_VISIT: `
    SELECT id, leader_user_id, teacher_name, school_name, school_ext_id, teacher_ext_id,
           scheduled_for::text AS scheduled_for, scheduled_slot, status, session_id
    FROM observation_schedules
    WHERE leader_user_id = $1 AND status = 'upcoming' AND scheduled_for >= $2::date
    ORDER BY scheduled_for ASC, scheduled_slot ASC NULLS LAST, created_at ASC
    LIMIT 1
  `,

  // bd-o15qnr.20 — "Lesson plans opened": the distinct plans one teacher used,
  // all time, through lp-activity's OWN definition (portal opens + plans that
  // reached her on WhatsApp — the count her Home shows). $1 user, $2/$3 null.
  LP_OPENED: `
    WITH ${ACTIVITY_CTE}
    SELECT count(DISTINCT kind || ':' || ref) AS n FROM lp_activity
  `,

  SCHEDULE_BY_ID: `
    SELECT id, leader_user_id, teacher_name, school_name, school_ext_id, teacher_ext_id,
           scheduled_for::text AS scheduled_for, scheduled_slot, status, session_id
    FROM observation_schedules
    WHERE id = $1::uuid
    LIMIT 1
  `,

  TEACHER_HISTORY: `
    SELECT id, created_at, status, debrief_status, observation_type, observer_user_id, audio_url,
           jsonb_build_object('scores', analysis_data->'scores') AS analysis_data
    FROM coaching_sessions
    WHERE user_id = $1::uuid AND status NOT IN ('failed', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 30
  `,

  // The team view: every coach in the deployment, or one ($last = coach id).
  TEAM_TOTALS: `
    SELECT count(*) FILTER (WHERE scheduled_for = $1::date)                     AS today,
           count(*) FILTER (WHERE scheduled_for BETWEEN $2::date AND $3::date)  AS week,
           count(*) FILTER (WHERE scheduled_for BETWEEN $4::date AND $5::date)  AS month
    FROM observation_schedules
    WHERE status <> 'cancelled' AND ($6::uuid IS NULL OR leader_user_id = $6::uuid)
  `,

  TEAM_DAYS: `
    SELECT scheduled_for::text AS day, count(*) AS n
    FROM observation_schedules
    WHERE status <> 'cancelled' AND scheduled_for BETWEEN $1::date AND $2::date
      AND ($3::uuid IS NULL OR leader_user_id = $3::uuid)
    GROUP BY scheduled_for
  `,

  TEAM_VISITS: `
    SELECT s.id, s.leader_user_id, s.teacher_name, s.school_name, s.scheduled_slot, s.status,
           u.name AS coach_name
    FROM observation_schedules s
    LEFT JOIN users u ON u.id = s.leader_user_id
    WHERE s.status <> 'cancelled' AND s.scheduled_for = $1::date
      AND ($2::uuid IS NULL OR s.leader_user_id = $2::uuid)
    ORDER BY s.scheduled_slot ASC NULLS LAST, u.name ASC
    LIMIT 2000
  `,

  COACHES: `
    SELECT id, name FROM users WHERE role = 'coach' ORDER BY name ASC NULLS LAST
  `,

  // bd-o15qnr.10 — one HITL observation, for its read-only report. The caller
  // re-checks that its teacher is in the coach's patch before serving it.
  OBSERVATION_BY_ID: `
    SELECT id, created_at, status, debrief_status, observation_type, user_id, observer_user_id, audio_url,
           analysis_data->'scores'                AS scores,
           analysis_data->>'executive_summary'    AS summary,
           analysis_data->'teacher_delivery'      AS delivery
    FROM coaching_sessions
    WHERE id = $1::uuid AND observation_type = 'leader_observation'
    LIMIT 1
  `,

  // bd-o15qnr.13 — her teaching levels for Edit teacher's multi-select, from
  // users.teacher_level (bd-60095), the column staging and main carry.
  TEACHER_LEVELS: `
    SELECT teacher_level FROM users WHERE id = $1::uuid LIMIT 1
  `,

  USER_NAME: `
    SELECT name FROM users WHERE id = $1::uuid LIMIT 1
  `,
};

// ── small helpers ────────────────────────────────────────────────────────────

function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function isoStamp(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` (a date or timestamp) to `today` (YYYY-MM-DD); null when unknown. */
function daysSince(from, today) {
  const day = isoDay(from);
  if (!day) return null;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 86400000));
}

/** Monday to Sunday around `day`. */
function weekBounds(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  const from = addDays(day, -back);
  return { from, to: addDays(from, 6) };
}

function monthBounds(day) {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

function mean(values) {
  const xs = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

function scoreOf(row) {
  if (!row || !TERMINAL_STATUSES.includes(row.status) || !row.analysis_data) return null;
  const o = getOverall(row.analysis_data);
  return o && o.percentage != null ? o.percentage : null;
}

function emisOf(schoolExtId) {
  if (!schoolExtId) return null;
  const s = String(schoolExtId);
  const code = s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s;
  return code.trim() || null;
}

/** "HH:MM" sorts as time; anything else (null, a legacy word) after the times. */
function slotKey(slot) {
  return /^\d{2}:\d{2}$/.test(String(slot || '')) ? String(slot) : '~';
}

function digitsOf(s) {
  return String(s || '').replace(/\D/g, '');
}

/** A searched phone in any local form, as the E.164-without-plus the users table holds. */
function normalisePhone(digits) {
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('3')) return `92${digits}`;
  return digits;
}

// ── teachers: the patch plus the three new numbers ──────────────────────────

async function loadTeachers(query, leaderUserId, today) {
  const patch = await getPatchTeachers(query, leaderUserId, { role: 'coach' });
  const ids = [...new Set(patch.map((t) => t.rumiUserId).filter(Boolean))];

  const facts = new Map();
  const training = new Map();
  if (ids.length) {
    const [f, t] = await Promise.all([
      query(SQL.TEACHER_FACTS, [ids]),
      query(SQL.TEACHER_TRAINING, [ids]),
    ]);
    for (const r of f.rows || []) {
      if (!facts.has(r.user_id)) facts.set(r.user_id, []);
      facts.get(r.user_id).push(r);
    }
    for (const r of t.rows || []) training.set(r.user_id, r.last_training_at);
  }

  const teachers = patch.map((p) => {
    const mine = (p.rumiUserId && facts.get(p.rumiUserId)) || [];
    const latest = mine.reduce((acc, r) => (!acc || isoStamp(r.created_at) > isoStamp(acc.created_at) ? r : acc), null);
    const lastTrainingAt = (p.rumiUserId && training.get(p.rumiUserId)) || null;
    return {
      teacherExtId: p.teacherExtId,
      name: p.name,
      phone: p.phone,
      onRumi: p.onRumi,
      rumiUserId: p.rumiUserId,
      schoolName: p.schoolName,
      emis: p.emis,
      schoolExtId: p.emis ? `niete:${p.emis}` : null,
      hitl: p.observations,
      dc: p.coachingSessions,
      avgHitl: mean(mine.map(scoreOf)),
      lastVisitAt: latest ? isoStamp(latest.created_at) : null,
      daysSinceVisit: latest ? daysSince(latest.created_at, today) : null,
      lastVisitScore: latest ? scoreOf(latest) : null,
      lastTrainingAt: isoStamp(lastTrainingAt),
      daysSinceTraining: lastTrainingAt ? daysSince(lastTrainingAt, today) : null,
      trainingModules: p.trainingModules,
      examsGenerated: p.examsGenerated,
      // bd-o15qnr.11 — shown (not edited) on Edit teacher
      isPrincipal: !!p.isPrincipal,
      scores: mine.map(scoreOf).filter((s) => s != null),
      latest,
    };
  });
  return teachers;
}

/** bd-o15qnr.20 — the plans one teacher has used (null when she is not on Rumi). */
async function lpOpenedOf(query, teacher) {
  if (!teacher || !teacher.rumiUserId) return null;
  const { rows } = await query(SQL.LP_OPENED, [teacher.rumiUserId, null, null]);
  return Number((rows && rows[0] && rows[0].n) || 0);
}

/** Strip the internal `scores` list and `latest` row before a teacher leaves the service. */
function publicTeacher(t) {
  if (!t) return t;
  const { scores, latest, ...rest } = t;
  return rest;
}

/** bd-o15qnr.9 — her latest HITL visit, as the Visit page's Last visit row shows it. */
function lastVisitOf(teacher, leaderUserId) {
  const r = teacher && teacher.latest;
  if (!r) return null;
  const audio = r.audio_url ? String(r.audio_url).split('?')[0] : '';
  return {
    id: r.id || null,
    date: isoStamp(r.created_at),
    score: scoreOf(r),
    step: stepOf(r),
    byMe: !!r.observer_user_id && r.observer_user_id === leaderUserId,
    observerName: r.observer_name || null,
    portal: PORTAL_KEY_RX.test(audio),
  };
}

// ── report classification ───────────────────────────────────────────────────

/** Where an observation stands for the coach: draft · talk · analysing · sent. */
function stepOf(r) {
  if (r.status === 'awaiting_observer_review' || r.status === 'observe2_checked') return 'draft';
  if (r.status === 'observer_review_complete' && r.debrief_status === 'pending') return 'talk';
  if (TERMINAL_STATUSES.includes(r.status)) return 'sent';
  return 'analysing';
}

function shapeReport(r, leaderUserId, teacherByUser) {
  const selfOwned = r.user_id && r.user_id === leaderUserId;
  const delivered = ((r.analysis_data || {}).teacher_delivery || {}).teacher_name;
  const patchTeacher = !selfOwned && r.user_id ? teacherByUser.get(r.user_id) : null;
  const audio = r.audio_url ? String(r.audio_url).split('?')[0] : '';
  return {
    id: r.id,
    createdAt: isoStamp(r.created_at),
    teacherName: r.sched_teacher_name || delivered || (selfOwned ? null : r.teacher_name) || null,
    teacherPhone: (selfOwned ? r.sched_teacher_ext_id : r.teacher_phone) || r.sched_teacher_ext_id || null,
    teacherExtId: r.sched_teacher_ext_id || (patchTeacher && patchTeacher.teacherExtId) || null,
    schoolName: r.sched_school_name || (patchTeacher && patchTeacher.schoolName) || null,
    schoolExtId: r.sched_school_ext_id || (patchTeacher && patchTeacher.schoolExtId) || null,
    status: r.status,
    step: stepOf(r),
    score: scoreOf(r),
    portal: PORTAL_KEY_RX.test(audio),
  };
}

// ── public API ───────────────────────────────────────────────────────────────

/** The Teachers and Schools tabs. */
async function getCoachPeople(query, leaderUserId, opts = {}) {
  const today = opts.today || karachiToday();
  const [teachers, schoolsRes, sessionsRes] = await Promise.all([
    loadTeachers(query, leaderUserId, today),
    query(SQL.LEADER_SCHOOLS, [leaderUserId]),
    query(SQL.COACH_SESSIONS, [leaderUserId]),
  ]);

  const teacherByUser = new Map(teachers.filter((t) => t.rumiUserId).map((t) => [t.rumiUserId, t]));
  const since = addDays(today, -SCHOOL_VISIT_WINDOW_DAYS);
  const visitsBySchool = new Map();
  for (const r of sessionsRes.rows || []) {
    if (DEAD_STATUSES.includes(r.status)) continue;
    const t = r.user_id ? teacherByUser.get(r.user_id) : null;
    const key = r.sched_school_ext_id || (t && t.schoolExtId);
    if (!key) continue;
    if (!visitsBySchool.has(key)) visitsBySchool.set(key, []);
    visitsBySchool.get(key).push(r);
  }

  const schools = (schoolsRes.rows || []).map((s) => {
    const key = s.school_ext_id;
    const emis = s.emis || emisOf(key);
    const own = teachers.filter((t) => t.schoolExtId === key || (emis && t.emis === emis));
    const visits = visitsBySchool.get(key) || [];
    const latest = visits.reduce((acc, r) => (!acc || isoStamp(r.created_at) > isoStamp(acc.created_at) ? r : acc), null);
    return {
      schoolExtId: key,
      emis,
      name: s.school_name || null,
      teachers: own.length,
      visits: visits.filter((r) => isoDay(r.created_at) >= since).length,
      daysSinceVisit: latest ? daysSince(latest.created_at, today) : null,
      avgHitl: mean(own.flatMap((t) => t.scores)),
    };
  });

  return { teachers: teachers.map(publicTeacher), schools };
}

/** One school (by EMIS) and its teachers; null when it is not one of hers. */
async function getCoachSchool(query, leaderUserId, emis, opts = {}) {
  const { teachers, schools } = await getCoachPeople(query, leaderUserId, opts);
  const school = schools.find((s) => s.emis === String(emis));
  if (!school) return null;
  return {
    school,
    teachers: teachers.filter((t) => t.schoolExtId === school.schoolExtId || t.emis === school.emis),
  };
}

/** One teacher in her patch: numbers, history (HITL + DC), next visit; null otherwise. */
async function getCoachTeacher(query, leaderUserId, teacherExtId, opts = {}) {
  const today = opts.today || karachiToday();
  const teachers = await loadTeachers(query, leaderUserId, today);
  const teacher = teachers.find((t) => t.teacherExtId === teacherExtId);
  if (!teacher) return null;

  const [historyRes, schedRes, lpOpened] = await Promise.all([
    teacher.rumiUserId ? query(SQL.TEACHER_HISTORY, [teacher.rumiUserId]) : Promise.resolve({ rows: [] }),
    query(SQL.MY_SCHEDULES, [leaderUserId, today, addDays(today, 120), today]),
    lpOpenedOf(query, teacher),
  ]);
  const history = (historyRes.rows || []).map((r) => historyRow(r, leaderUserId));
  const next = (schedRes.rows || []).find((r) => r.status === 'upcoming' && r.teacher_ext_id === teacherExtId
    && isoDay(r.scheduled_for) >= today);
  // Primary / Middle / High only — early years is not a teacher level (operator).
  let levels = [];
  if (teacher.rumiUserId) {
    const lv = await query(SQL.TEACHER_LEVELS, [teacher.rumiUserId]);
    const raw = ((lv.rows || [])[0] || {}).teacher_level;
    const have = new Set((Array.isArray(raw) ? raw : []).map((b) => String(b || '').trim().toUpperCase()));
    levels = TEACHING_LEVELS.filter((b) => have.has(b));
  }
  return {
    teacher: { ...publicTeacher(teacher), levels, lpOpened },
    history,
    nextVisit: next ? shapeVisit(next, today) : null,
  };
}

/**
 * bd-o15qnr.10 — one History row and what it opens.
 *
 *   'observe' — her own portal-started observation: its existing page, which
 *               shows the step it is at (portal-observe.service `loadOwn`
 *               opens only these);
 *   'report'  — any other HITL whose report is out: the v2 read-only report;
 *   null      — a HITL still at draft/talk on WhatsApp, and every DC session
 *               (a DC report is the teacher's own: /coaching-session/:id).
 */
function historyRow(r, leaderUserId) {
  const hitl = r.observation_type === 'leader_observation';
  const step = hitl ? stepOf(r) : null;
  const audio = r.audio_url ? String(r.audio_url).split('?')[0] : '';
  const ownPortal = hitl && r.observer_user_id === leaderUserId && PORTAL_KEY_RX.test(audio);
  let open = null;
  if (ownPortal) open = 'observe';
  else if (hitl && step === 'sent') open = 'report';
  return {
    id: r.id,
    date: isoStamp(r.created_at),
    kind: hitl ? 'HITL' : 'DC',
    score: scoreOf(r),
    step,
    open,
  };
}

/**
 * bd-o15qnr.10 / bd-o15qnr.19 — one HITL observation for the v2 observation
 * page: when it was, where it stands (step, and whether it is her own portal
 * observation — the portal can take only those through each step), the Digital
 * Coach score (the draft's, before her check) and the final score, its summary,
 * who observed, the lesson audio key and — once the report is out — the stored
 * key of the report image the teacher received (the route signs both). Null
 * unless the observation's teacher is in this coach's patch, the same guard as
 * getCoachTeacher. Before bd-o15qnr.19 only sent reports were served.
 */
async function getCoachObservation(query, leaderUserId, sessionId, opts = {}) {
  const today = opts.today || karachiToday();
  const res = await query(SQL.OBSERVATION_BY_ID, [sessionId]);
  const row = (res.rows || [])[0];
  if (!row || !row.user_id) return null;
  const step = stepOf(row);

  const teachers = await loadTeachers(query, leaderUserId, today);
  const teacher = teachers.find((t) => t.rumiUserId && t.rumiUserId === row.user_id);
  if (!teacher) return null;

  const self = !!row.observer_user_id && row.observer_user_id === leaderUserId;
  let observerName = null;
  if (row.observer_user_id) {
    const n = await query(SQL.USER_NAME, [row.observer_user_id]);
    observerName = ((n.rows || [])[0] || {}).name || null;
  }
  const sent = step === 'sent';
  const delivery = sent ? (row.delivery || {}) : {};
  const audio = row.audio_url ? String(row.audio_url).split('?')[0] : '';
  const overall = row.scores ? getOverall({ scores: row.scores }) : null;
  return {
    id: row.id,
    date: isoStamp(row.created_at),
    step,
    portal: PORTAL_KEY_RX.test(audio),
    mine: self,
    score: scoreOf({ status: row.status, analysis_data: { scores: row.scores } }),
    dcScore: overall && overall.percentage != null ? overall.percentage : null,
    summary: row.summary || null,
    teacher: { name: teacher.name, teacherExtId: teacher.teacherExtId, schoolName: teacher.schoolName },
    observer: { self, name: observerName },
    sentAt: delivery.sent_at || delivery.send_requested_at || null,
    caption: delivery.caption || null,
    reportKey: delivery.report_key || null,
    audioKey: row.audio_url || null,
  };
}

function shapeVisit(r, today) {
  const scheduledFor = isoDay(r.scheduled_for);
  return {
    id: r.id,
    teacherName: r.teacher_name || null,
    schoolName: r.school_name || null,
    schoolExtId: r.school_ext_id || null,
    teacherExtId: r.teacher_ext_id || null,
    scheduledFor,
    scheduledSlot: r.scheduled_slot || null,
    status: r.status,
    sessionId: r.session_id || null,
    overdue: r.status === 'upcoming' && !!scheduledFor && scheduledFor < today,
  };
}

function byWhen(a, b) {
  if (a.scheduledFor !== b.scheduledFor) return a.scheduledFor < b.scheduledFor ? -1 : 1;
  const ka = slotKey(a.scheduledSlot);
  const kb = slotKey(b.scheduledSlot);
  return ka === kb ? 0 : (ka < kb ? -1 : 1);
}

/** My schedule: visits in [from, to] and the overdue ones. */
async function getCoachSchedule(query, leaderUserId, opts = {}) {
  const today = opts.today || karachiToday();
  const week = weekBounds(today);
  const from = opts.from || week.from;
  const to = opts.to || week.to;
  const { rows } = await query(SQL.MY_SCHEDULES, [leaderUserId, from, to, today]);
  const all = (rows || []).map((r) => shapeVisit(r, today));
  return {
    from,
    to,
    overdue: all.filter((v) => v.overdue).sort(byWhen),
    visits: all.filter((v) => !v.overdue && v.scheduledFor >= from && v.scheduledFor <= to).sort(byWhen),
  };
}

/** Home: today's visits (the next upcoming one is `current`), her next visit on any day, and the tile numbers. */
async function getCoachHome(query, leaderUserId, opts = {}) {
  const today = opts.today || karachiToday();
  const [schedule, sessionsRes, patch, schoolsRes, nextRes] = await Promise.all([
    getCoachSchedule(query, leaderUserId, { today }),
    query(SQL.COACH_SESSIONS, [leaderUserId]),
    getPatchTeachers(query, leaderUserId, { role: 'coach' }),
    query(SQL.LEADER_SCHOOLS, [leaderUserId]),
    query(SQL.NEXT_VISIT, [leaderUserId, today]),
  ]);
  const nextRow = nextRes && nextRes.rows && nextRes.rows[0];
  const todays = schedule.visits.filter((v) => v.scheduledFor === today);
  const currentId = (todays.find((v) => v.status === 'upcoming') || {}).id;
  const steps = (sessionsRes.rows || []).filter((r) => !DEAD_STATUSES.includes(r.status)).map(stepOf);
  return {
    today: todays.map((v) => ({ ...v, current: v.id === currentId })),
    next: nextRow ? shapeVisit(nextRow, today) : null,
    counts: {
      week: schedule.visits.length,
      overdue: schedule.overdue.length,
      waiting: steps.filter((s) => s === 'draft' || s === 'talk').length,
      inProgress: steps.filter((s) => s === 'analysing').length,
      teachers: patch.length,
      schools: (schoolsRes.rows || []).length,
    },
  };
}

/**
 * bd-o15qnr.21 — what waits on HER (the pending banner on every v2 page): the
 * observations at the Feedback Form (draft) or Debrief (talk) step — Home's own
 * waiting rule — newest first, with their ids. The existing COACH_SESSIONS
 * query only; nothing new is read.
 */
async function getCoachPending(query, leaderUserId) {
  const { rows } = await query(SQL.COACH_SESSIONS, [leaderUserId]);
  const ids = (rows || [])
    .filter((r) => !DEAD_STATUSES.includes(r.status))
    .filter((r) => { const st = stepOf(r); return st === 'draft' || st === 'talk'; })
    .map((r) => r.id);
  return { waiting: ids.length, ids };
}

/** One schedule entry of hers, with the teacher's numbers; null for anyone else's. */
async function getCoachVisit(query, leaderUserId, scheduleId, opts = {}) {
  const today = opts.today || karachiToday();
  const { rows } = await query(SQL.SCHEDULE_BY_ID, [scheduleId]);
  const row = rows && rows[0];
  if (!row || row.leader_user_id !== leaderUserId) return null;
  const teachers = await loadTeachers(query, leaderUserId, today);
  const teacher = teachers.find((t) => t.teacherExtId === row.teacher_ext_id) || null;
  const lpOpened = await lpOpenedOf(query, teacher);
  return {
    visit: shapeVisit(row, today),
    teacher: teacher ? { ...publicTeacher(teacher), lpOpened } : null,
    lastVisit: lastVisitOf(teacher, leaderUserId),
  };
}

/** The team: totals, a count per day of the week, the day's visits grouped by time. */
async function getTeamSchedule(query, opts = {}) {
  const today = opts.today || karachiToday();
  const date = opts.date || today;
  const coachId = opts.coachId || null;
  const week = weekBounds(today);
  const month = monthBounds(today);
  const shown = weekBounds(date);

  const [totalsRes, daysRes, visitsRes, coachesRes] = await Promise.all([
    query(SQL.TEAM_TOTALS, [today, week.from, week.to, month.from, month.to, coachId]),
    query(SQL.TEAM_DAYS, [shown.from, shown.to, coachId]),
    query(SQL.TEAM_VISITS, [date, coachId]),
    query(SQL.COACHES, []),
  ]);

  const t = (totalsRes.rows && totalsRes.rows[0]) || {};
  const counts = new Map((daysRes.rows || []).map((r) => [isoDay(r.day), Number(r.n) || 0]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(shown.from, i);
    return { date: d, count: counts.get(d) || 0 };
  });

  const groups = [];
  const bySlot = new Map();
  for (const r of visitsRes.rows || []) {
    const slot = r.scheduled_slot || null;
    if (!bySlot.has(slot)) {
      const g = { slot, visits: [] };
      bySlot.set(slot, g);
      groups.push(g);
    }
    bySlot.get(slot).visits.push({
      id: r.id,
      coachId: r.leader_user_id,
      coachName: r.coach_name || null,
      mine: !!opts.me && r.leader_user_id === opts.me,
      teacherName: r.teacher_name || null,
      schoolName: r.school_name || null,
      status: r.status,
      done: r.status === 'done',
    });
  }
  groups.sort((a, b) => {
    const ka = slotKey(a.slot);
    const kb = slotKey(b.slot);
    return ka === kb ? 0 : (ka < kb ? -1 : 1);
  });

  return {
    date,
    totals: { today: Number(t.today) || 0, week: Number(t.week) || 0, month: Number(t.month) || 0 },
    days,
    groups,
    coaches: (coachesRes.rows || []).map((c) => ({ id: c.id, name: c.name || null, me: c.id === opts.me })),
  };
}

/** Reports: waiting for her, in progress, then every observation (search + pages). */
async function getCoachReports(query, leaderUserId, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 30));
  const [sessionsRes, patch] = await Promise.all([
    query(SQL.COACH_SESSIONS, [leaderUserId]),
    getPatchTeachers(query, leaderUserId, { role: 'coach' }),
  ]);
  const teacherByUser = new Map(patch.filter((t) => t.rumiUserId).map((t) => [t.rumiUserId, {
    teacherExtId: t.teacherExtId, schoolName: t.schoolName, schoolExtId: t.emis ? `niete:${t.emis}` : null,
  }]));
  const live = (sessionsRes.rows || []).filter((r) => !DEAD_STATUSES.includes(r.status));
  const shaped = live.map((r) => shapeReport(r, leaderUserId, teacherByUser));

  const q = String(opts.q || '').trim();
  let matched = shaped;
  if (q) {
    const digits = digitsOf(q);
    const lower = q.toLowerCase();
    matched = shaped.filter((r) => {
      if (digits.length >= 4) {
        const phone = digitsOf(r.teacherPhone);
        return phone.includes(normalisePhone(digits)) || phone.includes(digits);
      }
      return String(r.teacherName || '').toLowerCase().includes(lower)
        || String(r.schoolName || '').toLowerCase().includes(lower);
    });
  }

  return {
    waiting: shaped.filter((r) => r.step === 'draft' || r.step === 'talk'),
    inProgress: shaped.filter((r) => r.step === 'analysing'),
    all: {
      total: matched.length,
      page,
      pageSize,
      items: matched.slice((page - 1) * pageSize, page * pageSize),
    },
  };
}

module.exports = {
  SQL,
  PORTAL_KEY_RX,
  weekBounds,
  monthBounds,
  getCoachPeople,
  getCoachSchool,
  getCoachTeacher,
  getCoachObservation,
  getCoachPending,
  getCoachSchedule,
  getCoachHome,
  getCoachVisit,
  getTeamSchedule,
  getCoachReports,
};
