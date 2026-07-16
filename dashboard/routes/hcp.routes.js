/**
 * Human Coach Platform (HCP) — Portal API routes
 *
 * Ports the Human Coach Platform's coach-facing REST API onto Rumi's portal
 * stack. Endpoint parity for the HCP web app that human coaches use to prep
 * for and log classroom-observation visits.
 *
 * All routes are mounted at /api/portal/hcp/* by dashboard/index.js and gated
 * by requirePortalAuth — an authenticated portal session is required for
 * every read. Data source is Rumi's Supabase (users + coaching_sessions), not
 * HCP's archival PostgreSQL. The HCP prototype's historical database is
 * discarded per the integration brief.
 *
 * Phase 1 endpoint set (this file, complete):
 *   GET   /teachers                    — list teachers with DC rollups
 *   GET   /teachers/:id                — teacher detail (+ DC summary)
 *   GET   /teachers/:id/dc             — one teacher's full DC observation history
 *   GET   /teachers/:id/training       — training-module recommendations
 *   GET   /teachers/:id/coaching-plan  — per-indicator coaching actions
 *   GET   /training-modules            — all active training modules
 *   GET   /schedules                   — list visit schedules
 *   POST  /schedules                   — create visit schedule (Phase 3 wires the WA send)
 *   PATCH /schedules/:id               — update schedule status (Phase 3 wires WA button-reply)
 *   POST  /generate-feedback           — 6-box AI coaching feedback (Green / Orange / Purple /
 *                                        OrangeRed / Yellow / Blue), English/Urdu/Roman-Urdu
 *
 * The full multi-phase build plan lives in
 * 06_Logs & Misc/Reports/Active/HCP Integration/PLAN.md (private ops docs).
 */

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------
// Duplicated with intent: dashboard/routes/portal.routes.js exports a similar
// guard, but not from an importable module. Reproducing the minimal contract
// here keeps this router self-contained and avoids reaching into another
// route file's internals.

function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Please log in.',
    });
  }
  return next();
}

// ---------------------------------------------------------------------------
// Config — thresholds ported 1:1 from HCP
// ---------------------------------------------------------------------------
const WEAK_INDICATOR_THRESHOLD = 0.55;      // scores below this are "weak"
const FLAGGED_INDICATOR_COUNT = 6;          // 6+ weak indicators = flagged teacher
const RED_INDICATOR_FREQ_THRESHOLD = 0.60;  // weak in 60%+ of sessions = RED
const CRITICAL_SCORE_THRESHOLD = 0.45;      // session score < 0.45 = critical
const BELOW_AVG_THRESHOLD = 0.55;           // session score 0.45-0.55 = below_average

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreToPct(score) {
  if (score == null || Number.isNaN(score)) return null;
  return Math.round(score * 100);
}

function sessionStatus(scorePct) {
  if (scorePct == null) return null;
  if (scorePct < CRITICAL_SCORE_THRESHOLD * 100) return 'critical';
  if (scorePct < BELOW_AVG_THRESHOLD * 100) return 'below_average';
  return 'above_average';
}

/**
 * Given an array of coaching_sessions rows for one teacher, compute the
 * per-indicator rollup: for each indicator code, avg score and weak_session_count.
 */
function buildIndicatorRollup(sessions) {
  const byCode = new Map();
  for (const s of sessions) {
    const inds = (s.analysis_data && Array.isArray(s.analysis_data.indicators))
      ? s.analysis_data.indicators
      : [];
    for (const ind of inds) {
      if (!ind || typeof ind.code !== 'string') continue;
      const entry = byCode.get(ind.code) || {
        code: ind.code,
        scores: [],
        weak_session_count: 0,
      };
      const score = typeof ind.score === 'number' ? ind.score : null;
      if (score != null) {
        entry.scores.push(score);
        if (score < WEAK_INDICATOR_THRESHOLD) entry.weak_session_count += 1;
      }
      byCode.set(ind.code, entry);
    }
  }

  const totalSessions = sessions.length;
  const rollups = [];
  for (const [, entry] of byCode) {
    const avg = entry.scores.length
      ? entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length
      : null;
    rollups.push({
      code: entry.code,
      avg_score_pct: scoreToPct(avg),
      weak_session_count: entry.weak_session_count,
      weak_frequency_pct: totalSessions > 0
        ? Math.round((entry.weak_session_count / totalSessions) * 100)
        : 0,
    });
  }
  return rollups;
}

function countAvgWeakIndicators(indicatorRollups) {
  return indicatorRollups.filter(
    (r) => r.avg_score_pct != null && r.avg_score_pct < WEAK_INDICATOR_THRESHOLD * 100,
  ).length;
}

/**
 * Simple trend: compare mean of first-half sessions to mean of second-half.
 * Needs 4+ sessions to say anything; below that, "insufficient".
 */
function computeTrend(sessions) {
  const scores = sessions
    .map((s) => (s.analysis_data && typeof s.analysis_data.overall_score === 'number')
      ? s.analysis_data.overall_score
      : null)
    .filter((v) => v != null);
  if (scores.length < 4) return 'insufficient';
  // Chronological — sessions passed in should already be oldest→newest for
  // trend, but be defensive and re-sort by index (they were derived from a
  // created_at-ordered array).
  const half = Math.floor(scores.length / 2);
  const early = scores.slice(0, half);
  const late = scores.slice(-half);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const delta = mean(late) - mean(early);
  if (delta > 0.05) return 'improving';
  if (delta < -0.05) return 'declining';
  return 'flat';
}

// ---------------------------------------------------------------------------
// GET /teachers[?region=<region>]
// ---------------------------------------------------------------------------
router.get('/teachers', requirePortalAuth, async (req, res) => {
  try {
    const { region } = req.query;

    let teachersQuery = supabase
      .from('users')
      .select('id, first_name, last_name, phone_number, school_name, region, registration_completed')
      .eq('registration_completed', true);

    if (region) teachersQuery = teachersQuery.eq('region', region);

    const { data: teacherRows, error: teacherErr } = await teachersQuery;
    if (teacherErr) throw teacherErr;

    const teacherIds = (teacherRows || []).map((t) => t.id);
    let sessionRows = [];
    if (teacherIds.length > 0) {
      const { data: sr, error: sErr } = await supabase
        .from('coaching_sessions')
        .select('id, user_id, created_at, analysis_data')
        .in('user_id', teacherIds);
      if (sErr) throw sErr;
      sessionRows = sr || [];
    }

    // Group sessions per teacher
    const sessionsByTeacher = new Map();
    for (const s of sessionRows) {
      if (!sessionsByTeacher.has(s.user_id)) sessionsByTeacher.set(s.user_id, []);
      sessionsByTeacher.get(s.user_id).push(s);
    }

    const teachers = (teacherRows || []).map((t) => {
      const sessions = sessionsByTeacher.get(t.id) || [];
      const overallScores = sessions
        .map((s) => (s.analysis_data && typeof s.analysis_data.overall_score === 'number')
          ? s.analysis_data.overall_score
          : null)
        .filter((v) => v != null);
      const avgScore = overallScores.length
        ? overallScores.reduce((a, b) => a + b, 0) / overallScores.length
        : null;
      const indicatorRollups = buildIndicatorRollup(sessions);
      const weakIndicatorCount = countAvgWeakIndicators(indicatorRollups);
      const lastSessionAt = sessions.length
        ? sessions
            .map((s) => s.created_at)
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || null
        : null;

      return {
        id: t.id,
        first_name: t.first_name,
        last_name: t.last_name,
        phone_number: t.phone_number,
        school_name: t.school_name,
        region: t.region,
        avg_dc_score_pct: scoreToPct(avgScore),
        session_count: sessions.length,
        last_session_at: lastSessionAt,
        weak_indicator_count: weakIndicatorCount,
        is_flagged: weakIndicatorCount >= FLAGGED_INDICATOR_COUNT,
      };
    });

    // Sort: flagged first, then worst-score first (nulls last within each group)
    teachers.sort((a, b) => {
      if (a.is_flagged !== b.is_flagged) return a.is_flagged ? -1 : 1;
      const av = a.avg_dc_score_pct;
      const bv = b.avg_dc_score_pct;
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });

    return res.status(200).json({ success: true, teachers });
  } catch (err) {
    console.error('GET /api/portal/hcp/teachers error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /teachers/:id/dc
// ---------------------------------------------------------------------------
router.get('/teachers/:id/dc', requirePortalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: teacher, error: tErr } = await supabase
      .from('users')
      .select('id, first_name, last_name, phone_number, school_name, region')
      .eq('id', id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!teacher) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const { data: sessionsRaw, error: sErr } = await supabase
      .from('coaching_sessions')
      .select('id, user_id, created_at, analysis_data')
      .eq('user_id', id)
      .order('created_at', { ascending: true });
    if (sErr) throw sErr;
    const sessions = sessionsRaw || [];

    if (sessions.length === 0) {
      return res.status(200).json({
        success: true,
        teacher,
        summary: {
          avg_dc_score_pct: null,
          session_count: 0,
          first_session_at: null,
          last_session_at: null,
          trend: 'insufficient',
          critical_area_count: 0,
        },
        sessions: [],
        indicators: { red: [], green: [] },
      });
    }

    // Chronological (oldest first) for trend + delta computation
    const chrono = [...sessions].sort((a, b) => {
      if (a.created_at === b.created_at) return 0;
      if (!a.created_at) return -1;
      if (!b.created_at) return 1;
      return a.created_at < b.created_at ? -1 : 1;
    });

    const overallScores = chrono
      .map((s) => (s.analysis_data && typeof s.analysis_data.overall_score === 'number')
        ? s.analysis_data.overall_score
        : null);

    const validScores = overallScores.filter((v) => v != null);
    const avgScore = validScores.length
      ? validScores.reduce((a, b) => a + b, 0) / validScores.length
      : null;

    const indicatorRollups = buildIndicatorRollup(chrono);
    const criticalAreaCount = countAvgWeakIndicators(indicatorRollups);

    // Session table — newest first, with delta_from_prev
    const sessionsOut = chrono.map((s, idx) => {
      const current = overallScores[idx];
      const prev = idx > 0 ? overallScores[idx - 1] : null;
      const scorePct = scoreToPct(current);
      const deltaPct = (current != null && prev != null)
        ? Math.round((current - prev) * 100)
        : null;
      return {
        id: s.id,
        created_at: s.created_at,
        score_pct: scorePct,
        delta_from_prev_pct: deltaPct,
        status: sessionStatus(scorePct),
      };
    }).reverse();

    // RED / GREEN split by weak_frequency
    const red = indicatorRollups.filter(
      (r) => r.weak_frequency_pct >= RED_INDICATOR_FREQ_THRESHOLD * 100,
    );
    const green = indicatorRollups.filter(
      (r) => r.weak_frequency_pct < RED_INDICATOR_FREQ_THRESHOLD * 100,
    );

    return res.status(200).json({
      success: true,
      teacher,
      summary: {
        avg_dc_score_pct: scoreToPct(avgScore),
        session_count: chrono.length,
        first_session_at: chrono[0].created_at || null,
        last_session_at: chrono[chrono.length - 1].created_at || null,
        trend: computeTrend(chrono),
        critical_area_count: criticalAreaCount,
      },
      sessions: sessionsOut,
      indicators: { red, green },
    });
  } catch (err) {
    console.error('GET /api/portal/hcp/teachers/:id/dc error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Helper — compute weak indicator codes for one teacher (avg < 55% across
// their coaching_sessions). Used by both /teachers/:id/training and
// /teachers/:id/coaching-plan.
// ---------------------------------------------------------------------------
async function loadWeakIndicators(teacherId) {
  const { data: sessions, error } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, analysis_data')
    .eq('user_id', teacherId);
  if (error) throw error;
  const rollups = buildIndicatorRollup(sessions || []);
  return rollups
    .filter((r) => r.avg_score_pct != null && r.avg_score_pct < WEAK_INDICATOR_THRESHOLD * 100)
    .map((r) => ({ code: r.code, avg_score_pct: r.avg_score_pct }));
}

// ---------------------------------------------------------------------------
// GET /teachers/:id  — teacher detail + DC summary
// ---------------------------------------------------------------------------
router.get('/teachers/:id', requirePortalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: teacher, error: tErr } = await supabase
      .from('users')
      .select('id, first_name, last_name, phone_number, school_name, region')
      .eq('id', id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!teacher) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const { data: sessionsRaw, error: sErr } = await supabase
      .from('coaching_sessions')
      .select('id, user_id, created_at, analysis_data')
      .eq('user_id', id);
    if (sErr) throw sErr;
    const sessions = sessionsRaw || [];

    const overallScores = sessions
      .map((s) => (s.analysis_data && typeof s.analysis_data.overall_score === 'number')
        ? s.analysis_data.overall_score
        : null)
      .filter((v) => v != null);
    const avgScore = overallScores.length
      ? overallScores.reduce((a, b) => a + b, 0) / overallScores.length
      : null;

    const rollups = buildIndicatorRollup(sessions);
    const weakCount = countAvgWeakIndicators(rollups);

    const lastSessionAt = sessions.length
      ? sessions.map((s) => s.created_at).filter(Boolean).sort().slice(-1)[0] || null
      : null;
    const firstSessionAt = sessions.length
      ? sessions.map((s) => s.created_at).filter(Boolean).sort()[0] || null
      : null;

    // Latest schedule for this teacher (any status) — informational
    const { data: schedRows, error: schErr } = await supabase
      .from('hcp_visit_schedules')
      .select('id, coach_id, teacher_id, scheduled_at, observation_tool, status, confirmed_at')
      .eq('teacher_id', id)
      .order('scheduled_at', { ascending: false });
    if (schErr) throw schErr;
    const latestSchedule = (schedRows && schedRows[0]) || null;

    return res.status(200).json({
      success: true,
      teacher,
      summary: {
        session_count: sessions.length,
        avg_dc_score_pct: scoreToPct(avgScore),
        first_session_at: firstSessionAt,
        last_session_at: lastSessionAt,
        weak_indicator_count: weakCount,
        is_flagged: weakCount >= FLAGGED_INDICATOR_COUNT,
      },
      latest_schedule: latestSchedule,
    });
  } catch (err) {
    console.error('GET /api/portal/hcp/teachers/:id error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /teachers/:id/training  — module recommendations
// ---------------------------------------------------------------------------
router.get('/teachers/:id/training', requirePortalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: teacher, error: tErr } = await supabase
      .from('users')
      .select('id, first_name, last_name, region')
      .eq('id', id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!teacher) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const weak = await loadWeakIndicators(id);
    const weakCodes = weak.map((w) => w.code);

    const { data: modulesRaw, error: mErr } = await supabase
      .from('training_modules')
      .select('id, title, content_html, course_id, order_index, is_active, duration_seconds')
      .eq('is_active', true);
    if (mErr) throw mErr;

    let modules = modulesRaw || [];
    if (weakCodes.length > 0) {
      modules = modules.filter((m) => {
        const haystack = `${m.title || ''}\n${m.content_html || ''}`;
        return weakCodes.some((code) => haystack.includes(code));
      });
    }

    return res.status(200).json({
      success: true,
      teacher,
      weak_indicators: weakCodes,
      modules,
    });
  } catch (err) {
    console.error('GET /api/portal/hcp/teachers/:id/training error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /teachers/:id/coaching-plan  — per-indicator action plan
// ---------------------------------------------------------------------------
router.get('/teachers/:id/coaching-plan', requirePortalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: teacher, error: tErr } = await supabase
      .from('users')
      .select('id, first_name, last_name, region')
      .eq('id', id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!teacher) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const weak = await loadWeakIndicators(id);
    const weakCodes = weak.map((w) => w.code);

    let actionsByCode = new Map();
    if (weakCodes.length > 0) {
      const { data: actions, error: aErr } = await supabase
        .from('hcp_coaching_actions')
        .select('id, indicator_code, action_text, priority_order')
        .in('indicator_code', weakCodes);
      if (aErr) throw aErr;
      for (const a of (actions || [])) {
        if (!actionsByCode.has(a.indicator_code)) actionsByCode.set(a.indicator_code, []);
        actionsByCode.get(a.indicator_code).push(a);
      }
      for (const list of actionsByCode.values()) {
        list.sort((x, y) => (x.priority_order || 0) - (y.priority_order || 0));
      }
    }

    const plan = weak.map((w) => ({
      indicator_code: w.code,
      avg_score_pct: w.avg_score_pct,
      actions: actionsByCode.get(w.code) || [],
    }));

    return res.status(200).json({ success: true, teacher, plan });
  } catch (err) {
    console.error('GET /api/portal/hcp/teachers/:id/coaching-plan error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /training-modules  — all active modules
// ---------------------------------------------------------------------------
router.get('/training-modules', requirePortalAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('training_modules')
      .select('id, title, content_html, course_id, order_index, is_active, duration_seconds, audio_url, video_url')
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ success: true, modules: data || [] });
  } catch (err) {
    console.error('GET /api/portal/hcp/training-modules error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /schedules  — coach's own schedules
// ---------------------------------------------------------------------------
router.get('/schedules', requirePortalAuth, async (req, res) => {
  try {
    const coachId = req.session.portalUserId;
    let q = supabase
      .from('hcp_visit_schedules')
      .select('id, coach_id, teacher_id, scheduled_at, observation_tool, notes, status, confirmed_at, created_at, updated_at')
      .eq('coach_id', coachId);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.teacher_id) q = q.eq('teacher_id', req.query.teacher_id);
    q = q.order('scheduled_at', { ascending: false });

    const { data, error } = await q;
    if (error) throw error;
    return res.status(200).json({ success: true, schedules: data || [] });
  } catch (err) {
    console.error('GET /api/portal/hcp/schedules error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /schedules  — create a visit schedule
// ---------------------------------------------------------------------------
const VALID_OBSERVATION_TOOLS = new Set(['FICO', 'HOTs', 'COTs']);

router.post('/schedules', requirePortalAuth, async (req, res) => {
  try {
    const { teacher_id, scheduled_at, observation_tool, notes } = req.body || {};
    if (!teacher_id || !scheduled_at || !observation_tool) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: teacher_id, scheduled_at, observation_tool.',
      });
    }
    if (!VALID_OBSERVATION_TOOLS.has(observation_tool)) {
      return res.status(400).json({
        success: false,
        error: `Invalid observation_tool. Must be one of: ${[...VALID_OBSERVATION_TOOLS].join(', ')}.`,
      });
    }

    const insertRow = {
      coach_id: req.session.portalUserId,
      teacher_id,
      scheduled_at,
      observation_tool,
      notes: notes || null,
      status: 'upcoming',
    };

    const { data, error } = await supabase
      .from('hcp_visit_schedules')
      .insert(insertRow)
      .select('id, coach_id, teacher_id, scheduled_at, observation_tool, notes, status, confirmed_at, created_at, updated_at')
      .single();
    if (error) throw error;

    // Phase 3 will trigger the WhatsApp 3-button interactive send here.

    return res.status(201).json({ success: true, schedule: data });
  } catch (err) {
    console.error('POST /api/portal/hcp/schedules error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /schedules/:id  — update schedule status
// ---------------------------------------------------------------------------
const VALID_SCHEDULE_STATES = new Set([
  'upcoming', 'confirmed', 'reschedule_requested', 'medical_leave', 'completed', 'cancelled',
]);
// Allowed forward transitions. Anything not in this map (per source state) is a 409.
const ALLOWED_TRANSITIONS = {
  upcoming: new Set(['confirmed', 'reschedule_requested', 'medical_leave', 'cancelled', 'completed']),
  confirmed: new Set(['completed', 'cancelled', 'reschedule_requested', 'medical_leave']),
  reschedule_requested: new Set(['upcoming', 'confirmed', 'cancelled']),
  medical_leave: new Set(['upcoming', 'cancelled', 'completed']),
  completed: new Set(),  // terminal
  cancelled: new Set(),  // terminal
};

router.patch('/schedules/:id', requirePortalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status: nextStatus, notes } = req.body || {};

    if (nextStatus && !VALID_SCHEDULE_STATES.has(nextStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${[...VALID_SCHEDULE_STATES].join(', ')}.`,
      });
    }

    const { data: existing, error: exErr } = await supabase
      .from('hcp_visit_schedules')
      .select('id, coach_id, teacher_id, status, scheduled_at, observation_tool, confirmed_at')
      .eq('id', id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    if (nextStatus && nextStatus !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status] || new Set();
      if (!allowed.has(nextStatus)) {
        return res.status(409).json({
          success: false,
          error: `Invalid state transition: ${existing.status} -> ${nextStatus}.`,
        });
      }
    }

    const update = {};
    if (nextStatus) update.status = nextStatus;
    if (notes !== undefined) update.notes = notes;
    if (nextStatus === 'confirmed' && !existing.confirmed_at) {
      update.confirmed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('hcp_visit_schedules')
      .update(update)
      .eq('id', id)
      .select('id, coach_id, teacher_id, scheduled_at, observation_tool, notes, status, confirmed_at, created_at, updated_at')
      .single();
    if (error) throw error;

    return res.status(200).json({ success: true, schedule: data });
  } catch (err) {
    console.error('PATCH /api/portal/hcp/schedules/:id error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /generate-feedback  — 6-box coaching feedback via LLM
// ---------------------------------------------------------------------------
const VALID_FEEDBACK_LANGUAGES = new Set(['english', 'urdu', 'roman_urdu']);

function buildFeedbackPrompt({ observationData, language }) {
  const tool = observationData.observation_tool || 'FICO';
  const langLabel = language === 'urdu'
    ? 'Urdu'
    : language === 'roman_urdu' ? 'Roman Urdu' : 'English';

  // 6-box schema ported 1:1 from the HCP prototype's Step2 prompt.
  return `Generate ${tool} coaching feedback as JSON only. Return ONLY valid JSON with exactly these 6 boxes:

{
  "header": {
    "teacher_name": "${observationData.teacher_name || ''}",
    "subject": "${observationData.subject || ''}",
    "school_name": "${observationData.school_name || ''}",
    "class": "${observationData.class || ''}",
    "coach_name": "${observationData.coach_name || ''}",
    "region": "${observationData.region || ''}",
    "observation_tool": "${tool}"
  },
  "strengths_box": {
    "title": "Strengths",
    "points": ["strength 1", "strength 2", "strength 3"]
  },
  "areas_of_growth_box": {
    "title": "Areas of Growth",
    "points": ["growth 1", "growth 2"]
  },
  "student_learning_box": {
    "title": "Student Learning Priorities",
    "summary": "summary",
    "key_learning_gaps": ["gap 1", "gap 2"],
    "recommended_practices": ["practice 1", "practice 2"]
  },
  "student_engagement_box": {
    "title": "Student Engagement & Participation",
    "summary": "summary",
    "engagement_strengths": ["strength 1"],
    "engagement_gaps": ["gap 1"],
    "strategies_to_improve": ["strategy 1"]
  },
  "action_items_box": {
    "title": "Action Items",
    "points": ["action 1", "action 2", "action 3"]
  },
  "encouragement_box": {
    "title": "Coach's Note",
    "message": "encouraging message",
    "signed_by": "${observationData.coach_name || 'Coach'}"
  }
}

Observation Tool: ${tool}
Language: ${langLabel}

# OBSERVATION DATA:
${JSON.stringify(observationData, null, 2)}

Generate feedback specific to ${tool} indicators by filling the JSON above. RETURN ONLY THE JSON OBJECT.`;
}

function parseFeedbackJson(raw) {
  // Strip common markdown code fences before trying to parse.
  const cleaned = String(raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    // Fallback: extract the outermost JSON object.
    const m = cleaned.match(/\{[\s\S]*\}$/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (_e2) { return null; }
  }
}

router.post('/generate-feedback', requirePortalAuth, async (req, res) => {
  try {
    const {
      teacher_id, coaching_session_id, observation_data, language, prompt: overridePrompt,
    } = req.body || {};

    if (!teacher_id) {
      return res.status(400).json({ success: false, error: 'Missing teacher_id.' });
    }
    if (!observation_data || typeof observation_data !== 'object') {
      return res.status(400).json({ success: false, error: 'Missing observation_data.' });
    }

    const lang = VALID_FEEDBACK_LANGUAGES.has(language) ? language : 'english';
    const prompt = overridePrompt || buildFeedbackPrompt({ observationData: observation_data, language: lang });

    // Lazy-require so tests can mock the module cleanly.
    let llmResponse;
    try {
      const { getClient, getDefaultModel } = require('../../bot/shared/services/llm-client');
      const client = getClient();
      llmResponse = await client.chat.completions.create({
        model: process.env.HCP_FEEDBACK_MODEL || getDefaultModel(),
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      });
    } catch (llmErr) {
      console.error('POST /generate-feedback llm error:', llmErr);
      return res.status(502).json({
        success: false,
        error: 'LLM request failed',
        details: llmErr.message,
      });
    }

    const raw = llmResponse && llmResponse.choices && llmResponse.choices[0]
      && llmResponse.choices[0].message && llmResponse.choices[0].message.content;
    const feedback = parseFeedbackJson(raw);
    if (!feedback || typeof feedback !== 'object') {
      return res.status(502).json({
        success: false,
        error: 'LLM returned malformed JSON',
      });
    }

    // Version the delivery: previous rows for this (teacher, session) => next version.
    let nextVersion = 1;
    try {
      const { data: prior } = await supabase
        .from('hcp_feedback_deliveries')
        .select('id, version')
        .eq('teacher_id', teacher_id);
      if (Array.isArray(prior) && prior.length > 0) {
        nextVersion = 1 + prior.reduce((mx, r) => Math.max(mx, r.version || 0), 0);
      }
    } catch (_e) { /* if the count fails, still write v1 */ }

    const insertRow = {
      teacher_id,
      coaching_session_id: coaching_session_id || null,
      coach_id: req.session.portalUserId,
      language: lang,
      feedback_json: feedback,
      version: nextVersion,
      prompt_used: prompt,
    };

    const { data: saved, error: saveErr } = await supabase
      .from('hcp_feedback_deliveries')
      .insert(insertRow)
      .select('id, teacher_id, coach_id, language, version, generated_at')
      .single();
    if (saveErr) throw saveErr;

    return res.status(200).json({
      success: true,
      delivery_id: saved && saved.id,
      version: nextVersion,
      language: lang,
      feedback,
    });
  } catch (err) {
    console.error('POST /api/portal/hcp/generate-feedback error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
