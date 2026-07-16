/**
 * Teacher Attendance — Portal API routes (NIETE STEPS-P: Teacher Presence)
 *
 * Backs Round 1 of the NIETE Teacher Attendance system. Principal (of a school)
 * marks daily attendance for teachers under them; teachers read their own
 * records; the STEPS framework consumes a clean presence rollup for each
 * teacher's ACR (Annual Confidential Report).
 *
 * Mounted at /api/portal/attendance/* by dashboard/index.js. All routes gated
 * by requirePortalAuth (portal session cookie). Principal-only routes add a
 * role check + a "principal-of-teacher's-school" check.
 *
 * Endpoints:
 *   GET  /api/portal/attendance/school            — teachers in principal's school + today's marks
 *   POST /api/portal/attendance/mark              — upsert one teacher's mark for a date
 *   GET  /api/portal/attendance/school/history    — school-wide history + per-teacher %
 *   GET  /api/portal/attendance/me                — authenticated teacher's own records
 *   GET  /api/portal/attendance/presence          — STEPS-facing presence read (teacher_id | mobile | school_id)
 *
 * Locked decisions from Hasnat's Notion card (39fd4a97-15e9-8025-a271-c4be03828e6f):
 *   * Principal marks ALL teachers (no self-check-in).
 *   * No accountability tech (geo-fence, photo, biometric) — audit trail only via marked_by_user_id.
 *   * Mark captures Present / Absent / Leave (+ sub-type casual/sick/official).
 *   * Web only (Round 2 = WhatsApp).
 *
 * Presence API shape (approved verbatim):
 *   { teacher_id, mobile, school_id, period_start, period_end,
 *     present_days, absent_days, leave_days, working_days, presence_pct }
 */

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const {
  RealAttendanceRepository,
  MockAttendanceRepository,
  computePresence,
} = require('../../bot/shared/services/attendance-repository.service');

// ---------------------------------------------------------------------------
// Repository resolution
// ---------------------------------------------------------------------------
// The factory in attendance-repository.service returns a Mock repo when
// NODE_ENV=test or ATTENDANCE_REPO=mock. Routes always call
// getRepo() lazily so tests can inject a mock supabase after module load.
function getRepo() {
  const useMock = process.env.ATTENDANCE_REPO === 'mock';
  if (useMock) return new MockAttendanceRepository();
  return new RealAttendanceRepository(supabase);
}

// ---------------------------------------------------------------------------
// Auth guards
// ---------------------------------------------------------------------------
// Same shape as dashboard/routes/hcp.routes.js — self-contained duplicate of
// the requirePortalAuth guard in portal.routes.js (not exported from there).

function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Please log in.',
    });
  }
  return next();
}

/**
 * Loads the authenticated user's {id, role, school_id, first_name, phone_number}
 * onto req.portalUser. All downstream role/school checks read from this.
 */
async function loadPortalUser(req, res, next) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, phone_number, role, school_id')
      .eq('id', req.session.portalUserId)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found.' });
    }
    req.portalUser = user;
    return next();
  } catch (err) {
    console.error('[attendance] loadPortalUser error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load user context.' });
  }
}

function requirePrincipal(req, res, next) {
  if (!req.portalUser || req.portalUser.role !== 'principal') {
    return res.status(403).json({
      success: false,
      error: 'Principal role required.',
    });
  }
  if (!req.portalUser.school_id) {
    return res.status(403).json({
      success: false,
      error: 'Principal is not linked to a school. Contact NIETE support.',
    });
  }
  return next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function isValidIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Load the school row (name, region) for the given id.
 */
async function loadSchool(schoolId) {
  const { data, error } = await supabase
    .from('schools')
    .select('id, name, region, principal_user_id')
    .eq('id', schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/portal/attendance/school
 *
 * Returns the list of teachers in the principal's school, along with today's
 * attendance state per teacher (if marked). Powers the daily mark screen.
 *
 * Response:
 *   {
 *     school: { id, name, region },
 *     date: 'YYYY-MM-DD',
 *     teachers: [
 *       { id, first_name, last_name, phone_number, today: { status, leave_type } | null }
 *     ]
 *   }
 */
router.get('/school', requirePortalAuth, loadPortalUser, requirePrincipal, async (req, res) => {
  try {
    const repo = getRepo();
    const school_id = req.portalUser.school_id;
    const date = isValidIsoDate(req.query.date) ? req.query.date : todayIsoDate();

    const [school, teachers, todayRecs] = await Promise.all([
      loadSchool(school_id),
      repo.getTeachersBySchool(school_id),
      repo.getAttendanceForSchool(school_id, date, date),
    ]);

    const marksByTeacher = new Map(todayRecs.map((r) => [r.teacher_id, r]));
    const enriched = teachers.map((t) => ({
      id: t.id,
      first_name: t.first_name,
      last_name: t.last_name,
      phone_number: t.phone_number,
      today: marksByTeacher.has(t.id)
        ? { status: marksByTeacher.get(t.id).status, leave_type: marksByTeacher.get(t.id).leave_type }
        : null,
    }));

    return res.json({
      success: true,
      school: school ? { id: school.id, name: school.name, region: school.region } : { id: school_id, name: null, region: null },
      date,
      teachers: enriched,
    });
  } catch (err) {
    console.error('[attendance] GET /school error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/portal/attendance/mark
 *
 * Body: { teacher_id, date, status, leave_type? }
 * Upserts the attendance record for (teacher_id, date). Rejects if the caller
 * is not the principal of the teacher's school.
 */
router.post('/mark', requirePortalAuth, loadPortalUser, requirePrincipal, async (req, res) => {
  try {
    const { teacher_id, date, status, leave_type } = req.body || {};
    if (!teacher_id || !isValidIsoDate(date) || !status) {
      return res.status(400).json({
        success: false,
        error: 'teacher_id, date (YYYY-MM-DD) and status are required.',
      });
    }

    // Verify the teacher belongs to the principal's school.
    const { data: teacher, error: teacherErr } = await supabase
      .from('users')
      .select('id, school_id, role')
      .eq('id', teacher_id)
      .maybeSingle();
    if (teacherErr) throw teacherErr;
    if (!teacher) return res.status(404).json({ success: false, error: 'Teacher not found.' });
    if (teacher.school_id !== req.portalUser.school_id) {
      return res.status(403).json({
        success: false,
        error: 'Teacher does not belong to your school.',
      });
    }

    const repo = getRepo();
    const record = await repo.saveAttendance({
      teacher_id,
      school_id: req.portalUser.school_id,
      date,
      status,
      leave_type: leave_type || null,
      marked_by_user_id: req.portalUser.id,
    });

    return res.json({ success: true, record });
  } catch (err) {
    console.error('[attendance] POST /mark error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/portal/attendance/school/history?period=Nd|monthly
 *
 * Principal-only. Returns school-wide history + per-teacher presence % over
 * the requested window. `period` defaults to `30d`.
 */
router.get('/school/history', requirePortalAuth, loadPortalUser, requirePrincipal, async (req, res) => {
  try {
    const school_id = req.portalUser.school_id;
    const period = String(req.query.period || '30d');
    const end = new Date();
    const start = new Date();
    if (period === 'monthly') {
      start.setDate(1);
    } else {
      const m = period.match(/^(\d+)d$/);
      const days = m ? parseInt(m[1], 10) : 30;
      start.setDate(start.getDate() - (days - 1));
    }
    const start_date = start.toISOString().slice(0, 10);
    const end_date = end.toISOString().slice(0, 10);

    const repo = getRepo();
    const presenceRows = await repo.getPresence({ school_id, start_date, end_date });
    const records = await repo.getAttendanceForSchool(school_id, start_date, end_date);

    return res.json({
      success: true,
      school_id,
      period_start: start_date,
      period_end: end_date,
      teachers: presenceRows,
      records, // full per-day records — Round 1 UI can group client-side
    });
  } catch (err) {
    console.error('[attendance] GET /school/history error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/portal/attendance/me?start_date=&end_date=
 *
 * Any authenticated portal user — returns their own attendance records +
 * presence rollup. Teachers use this to view their record; principals see
 * their own record too (they may also be a teacher in the org hierarchy).
 */
router.get('/me', requirePortalAuth, loadPortalUser, async (req, res) => {
  try {
    const repo = getRepo();
    const start_date = isValidIsoDate(req.query.start_date) ? req.query.start_date : null;
    const end_date = isValidIsoDate(req.query.end_date) ? req.query.end_date : null;

    const records = await repo.getAttendanceForTeacher(req.portalUser.id, start_date, end_date);
    const rollup = computePresence(records);

    return res.json({
      success: true,
      teacher_id: req.portalUser.id,
      mobile: req.portalUser.phone_number,
      school_id: req.portalUser.school_id,
      period_start: start_date,
      period_end: end_date,
      ...rollup,
      records,
    });
  } catch (err) {
    console.error('[attendance] GET /me error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/portal/attendance/presence?teacher_id=|mobile=|school_id=
 *
 * The STEPS-facing read endpoint. Response shape approved verbatim by Hasnat:
 *   { teacher_id, mobile, school_id, period_start, period_end,
 *     present_days, absent_days, leave_days, working_days, presence_pct }
 *
 * school_id → array of the above (one per teacher). teacher_id / mobile →
 * a single object.
 *
 * Auth: portal session (Round 1). Round 2 will add a service-token path for
 * BigQuery / STEPS internal callers.
 */
router.get('/presence', requirePortalAuth, loadPortalUser, async (req, res) => {
  try {
    const { teacher_id, mobile, school_id, start_date, end_date } = req.query;
    if (!teacher_id && !mobile && !school_id) {
      return res.status(400).json({
        success: false,
        error: 'One of teacher_id, mobile, or school_id is required.',
      });
    }

    // Auth: if querying a specific teacher_id or mobile that isn't the caller,
    // require the caller to be the principal of that teacher's school. If
    // querying school_id, require principal of that school. Otherwise any
    // authenticated user can query their own record.
    if (school_id) {
      if (req.portalUser.role !== 'principal' || req.portalUser.school_id !== school_id) {
        return res.status(403).json({
          success: false,
          error: 'Principal of the requested school required.',
        });
      }
    } else if (teacher_id && teacher_id !== req.portalUser.id) {
      // Principal reading another teacher — verify same school.
      if (req.portalUser.role !== 'principal') {
        return res.status(403).json({
          success: false,
          error: 'You can only read your own attendance.',
        });
      }
      const { data: t } = await supabase
        .from('users').select('school_id').eq('id', teacher_id).maybeSingle();
      if (!t || t.school_id !== req.portalUser.school_id) {
        return res.status(403).json({
          success: false,
          error: 'Teacher does not belong to your school.',
        });
      }
    }

    const repo = getRepo();
    const result = await repo.getPresence({
      teacher_id, mobile, school_id,
      start_date: isValidIsoDate(start_date) ? start_date : null,
      end_date: isValidIsoDate(end_date) ? end_date : null,
    });

    return res.json({ success: true, ...(Array.isArray(result) ? { teachers: result } : result) });
  } catch (err) {
    console.error('[attendance] GET /presence error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
