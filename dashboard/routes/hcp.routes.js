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
 * Phase 1 endpoint set (this file):
 *   GET  /teachers                    — list teachers with DC rollups
 *   GET  /teachers/:id/dc             — one teacher's full DC observation history
 *
 * Phase 1 remainder (subsequent commits, same file):
 *   GET  /teachers/:id                — teacher detail (+ principal, DC summary)
 *   GET  /teachers/:id/training       — training-module recommendations
 *   GET  /teachers/:id/coaching-plan  — per-indicator coaching actions
 *   GET  /training-modules            — all active training modules
 *   GET  /schedules                   — list visit schedules
 *   POST /schedules                   — create visit schedule (triggers WA flow, Phase 3)
 *   PATCH /schedules/:id              — update schedule status (WA button-response, Phase 3)
 *   POST /generate-feedback           — 6-box AI coaching feedback (Phase 3)
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

module.exports = router;
