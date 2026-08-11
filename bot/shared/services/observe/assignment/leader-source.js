'use strict';
/**
 * FEAT-116 (bd-2298) — the leader assignment source.
 *
 * Reads the CLEAN Rumi model (`leader_schools` / `leader_teachers`) plus
 * `coaching_sessions`, and hands the visit Flow three shapes:
 *   listSchools(leader)                    → schools with teacherCount + dueCount
 *   listTeachers(leader, schoolExtId)      → prioritised teacher rows (via prioritise.js)
 *   buildBrief(leader, teacherExt, school) → the Support Brief payload
 *
 * TWO CLEAN SOURCES (operator 2026-07-22, plan §3), never mixed:
 *   - recency / "due" = the LEADER'S OWN /observe visits
 *     (coaching_sessions observation_type='leader_observation', observer_user_id=leader).
 *   - score trend + the moves = the TEACHER'S AI-coaching
 *     (loadTrendData(user_id) — status='completed'; analysis_data for the moves).
 *
 * The teacher's Rumi user_id is resolved via leader_teachers.teacher_phone_e164
 * = users.phone_number. Every method degrades on missing data — buildBrief NEVER
 * throws (falls back to first-visit copy).
 */

const supabase = require('../../../config/supabase');
const { orderTeachers, classify } = require('./prioritise');
const { loadTrendData } = require('../../coaching/coaching-trend.service');
const { buildMoves, openingTips, KNOWN_AREAS } = require('../observe-support-moves');
const { logToFile } = require('../../../utils/logger');
const { clampLanguage } = require('../../../config/ux-strings');

// Leader-facing area labels (FIX 2 — the brief is read by the LEADER, so
// strength/growth labels resolve in the LEADER'S language, not the teacher's).
// NIETE adaptation (bd-2430): the FOUR FICO V3 sections are first-class here
// (this market analyses on FICO — reading only HOTS keys would make every FICO
// teacher look like no-data, the exact bd-2300 regression class). The upstream
// HOTS keys are kept below for parity. NIETE languages: en/ur (sw/ar entries
// retained verbatim from upstream but unreachable — the clamp is en/ur).
const AREA_LABEL = {
  lesson_plan_fidelity: { en: 'following the lesson plan', ur: 'سبق کے منصوبے پر عمل' },
  high_leverage_practices: { en: 'high-leverage teaching practices', ur: 'مؤثر تدریسی طریقے' },
  teacher_subject_knowledge: { en: 'subject knowledge & explanations', ur: 'مضمون کی مہارت اور وضاحت' },
  // (student_engagement is shared with the HOTS set below.)
  classroom_environment: { en: 'the classroom setup & discussion culture', ur: 'کلاس روم کی ترتیب اور بحث کا ماحول', sw: 'mpangilio wa darasa na utamaduni wa majadiliano', ar: 'ترتيب الصف وثقافة النقاش' },
  lesson_planning: { en: 'lesson objectives & planning', ur: 'سبق کے مقاصد اور منصوبہ بندی', sw: 'malengo ya somo na upangaji', ar: 'أهداف الدرس والتخطيط' },
  instructional_strategies: { en: 'questioning & how she teaches', ur: 'سوالات اور تدریس کا انداز', sw: 'namna ya kuuliza na kufundisha', ar: 'طرح الأسئلة وأسلوب التدريس' },
  student_engagement: { en: 'getting every student involved', ur: 'ہر بچے کو شامل کرنا', sw: 'kuwashirikisha wanafunzi wote', ar: 'إشراك كل طالب' },
  assessment_feedback: { en: 'checking understanding & feedback', ur: 'سمجھ کی جانچ اور رہنمائی', sw: 'kukagua uelewa na maoni', ar: 'التحقق من الفهم والتغذية الراجعة' },
};

function areaLabel(key, lang) {
  const l = clampLanguage(lang); // NIETE market clamp
  const e = AREA_LABEL[key];
  return e ? (e[l] || e.en) : null;
}

// ── DB helpers (each returns [] / null on error, never throws) ────────────────

async function _schools(leaderUserId) {
  const { data, error } = await supabase
    .from('leader_schools')
    .select('school_ext_id, school_name, emis')
    .eq('leader_user_id', leaderUserId);
  if (error) { logToFile('leader-source: _schools error', { error: error.message }); return []; }
  return data || [];
}

async function _teachers(leaderUserId, schoolExtId = null) {
  let q = supabase
    .from('leader_teachers')
    .select('teacher_ext_id, teacher_name, teacher_phone_e164, school_ext_id, level')
    .eq('leader_user_id', leaderUserId);
  if (schoolExtId != null) q = q.eq('school_ext_id', schoolExtId);
  const { data, error } = await q;
  if (error) { logToFile('leader-source: _teachers error', { error: error.message }); return []; }
  return data || [];
}

async function _usersByPhone(phones) {
  const list = [...new Set((phones || []).filter(Boolean))];
  if (!list.length) return [];
  const { data, error } = await supabase
    .from('users')
    .select('id, phone_number, preferred_language, grades_taught')
    .in('phone_number', list);
  if (error) { logToFile('leader-source: _usersByPhone error', { error: error.message }); return []; }
  return data || [];
}

/**
 * The leader's OWN /observe visits — the recency source. Returns a
 * userId → most-recent-visit-ISO map.
 */
async function _leaderVisitMap(leaderUserId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('user_id, created_at')
    .eq('observer_user_id', leaderUserId)
    .eq('observation_type', 'leader_observation');
  if (error) { logToFile('leader-source: _leaderVisitMap error', { error: error.message }); return {}; }
  const map = {};
  for (const r of (data || [])) {
    if (!r.user_id) continue;
    if (!map[r.user_id] || Date.parse(r.created_at) > Date.parse(map[r.user_id])) {
      map[r.user_id] = r.created_at;
    }
  }
  return map;
}

/**
 * Latest completed AI-coaching analysis_data per teacher user_id (batched).
 * Used to derive the growth (weakest) HOTS area. observation_type IS NULL keeps
 * this to the teacher's OWN coaching, never a leader observation.
 */
async function _latestAnalysisMap(userIds) {
  const list = [...new Set((userIds || []).filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('user_id, analysis_data, created_at')
    .in('user_id', list)
    .is('observation_type', null)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  if (error) { logToFile('leader-source: _latestAnalysisMap error', { error: error.message }); return {}; }
  const map = {};
  for (const r of (data || [])) {
    if (r.user_id && !map[r.user_id]) map[r.user_id] = r.analysis_data || null;
  }
  return map;
}

// ── Pure derivations ─────────────────────────────────────────────────────────

// FEAT-116 (bd-2300): the teacher's AI-coaching analysis_data comes in TWO shapes.
//  - MEWAKA / TZ: scores under `analysis.domains[<area_key>]` (area_score/area_max).
//  - HOTS / PK (Rawalpindi + Moawin): scores under top-level `goalN_*` slots, NOT
//    `domains`. Each goal slot = { area_score, area_max, indicators:[…] }. Reading
//    only `domains` made EVERY HOTS teacher look like no-data — the bug this fixes.
// The map lands each HOTS goal on its MOVE_LIBRARY area so buildMoves gets it right.
const GOAL_TO_AREA = {
  goal1_formative_assessment: 'assessment_feedback',
  goal2_student_engagement: 'student_engagement',
  goal3_quality_content: 'lesson_planning',
  goal4_classroom_interaction: 'instructional_strategies',
  goal5_classroom_management: 'classroom_environment',
};

function _slotRatio(d) {
  if (!d || typeof d !== 'object') return null;
  const max = Number(d.area_max ?? d.domain_max);
  // bd-2456: the LIVE FICO analyzer writes domain_score (not area_score) —
  // without it every real NIETE teacher's per-area ratios came back empty.
  const score = Number(d.area_score ?? d.domain_score ?? d.total);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(score)) return null;
  return score / max;
}

/**
 * Framework-agnostic: canonical MOVE_LIBRARY-area → ratio map from EITHER shape.
 * MEWAKA `domains` and HOTS `goalN_*` slots both resolve; unknown keys skipped.
 */
function _areaRatios(analysis) {
  if (!analysis || typeof analysis !== 'object') return {};
  const ratios = {};
  // Domains-keyed shapes: MEWAKA/TZ (HOTS-style keys) AND FICO/NIETE (the four
  // B/C/D/F section keys). KNOWN_AREAS covers both — reading a whitelist that
  // misses the live framework's keys is the bd-2300 regression class.
  if (analysis.domains && typeof analysis.domains === 'object') {
    for (const key of Object.keys(analysis.domains)) {
      if (!KNOWN_AREAS.includes(key)) continue;
      const r = _slotRatio(analysis.domains[key]);
      if (r != null) ratios[key] = r;
    }
  }
  // HOTS / PK: top-level goalN_* slots → mapped area key.
  for (const [slot, areaKey] of Object.entries(GOAL_TO_AREA)) {
    const r = _slotRatio(analysis[slot]);
    if (r != null) ratios[areaKey] = r;
  }
  return ratios;
}

/** Lowest-ratio area → the growth area key (or null). Both shapes. */
function weakestAreaFromAnalysis(analysis) {
  let best = null;
  for (const [key, ratio] of Object.entries(_areaRatios(analysis))) {
    if (!best || ratio < best.ratio) best = { key, ratio };
  }
  return best ? best.key : null;
}

/** Highest-ratio area → the strength area key (or null). Both shapes. */
function strongestAreaFromAnalysis(analysis) {
  let best = null;
  for (const [key, ratio] of Object.entries(_areaRatios(analysis))) {
    if (!best || ratio > best.ratio) best = { key, ratio };
  }
  return best ? best.key : null;
}

/**
 * bd-2329 — the teacher's overall AI-coaching score as a 0..1 ratio, used as the
 * "needs support" term in the picker sort. Mean of the per-area ratios (the same
 * framework-agnostic basis the brief uses for strength/growth — MEWAKA `domains`
 * + HOTS `goalN_*`), so the flag aligns with what the brief shows. Falls back to
 * an explicit scores.overall_percentage; null when there is no usable score.
 */
function overallScoreFromAnalysis(analysis) {
  const ratios = Object.values(_areaRatios(analysis));
  if (ratios.length) return ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const pct = analysis && analysis.scores && Number(analysis.scores.overall_percentage);
  return Number.isFinite(pct) && pct > 0 ? Math.max(0, Math.min(1, pct / 100)) : null;
}

function firstGrade(gradesTaught) {
  if (Array.isArray(gradesTaught) && gradesTaught.length) return gradesTaught[0];
  return null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * @returns {Promise<Array<{school_ext_id, school_name, emis, teacherCount, dueCount}>>}
 * dueCount = teachers whose last leader_observation by THIS leader is older than
 * RECENT_DAYS or never (priority 'due' or 'new').
 */
async function listSchools(leaderUserId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const [schools, teachers] = await Promise.all([
    _schools(leaderUserId),
    _teachers(leaderUserId),
  ]);
  const users = await _usersByPhone(teachers.map((t) => t.teacher_phone_e164));
  const phoneToUserId = {};
  for (const u of users) phoneToUserId[u.phone_number] = u.id;
  const visitMap = await _leaderVisitMap(leaderUserId);

  const perSchool = {};
  for (const t of teachers) {
    const userId = phoneToUserId[t.teacher_phone_e164] || null;
    const lastVisitAt = userId ? (visitMap[userId] || null) : null;
    const priority = classify({ lastVisitAt }, today);
    const bucket = perSchool[t.school_ext_id] || (perSchool[t.school_ext_id] = { teacherCount: 0, dueCount: 0 });
    bucket.teacherCount += 1;
    if (priority === 'due' || priority === 'new') bucket.dueCount += 1;
  }

  return schools.map((s) => ({
    school_ext_id: s.school_ext_id,
    school_name: s.school_name,
    emis: s.emis,
    teacherCount: perSchool[s.school_ext_id]?.teacherCount || 0,
    dueCount: perSchool[s.school_ext_id]?.dueCount || 0,
  }));
}

/**
 * @returns {Promise<Array<{teacher_ext_id, teacher_name, phone_e164, user_id,
 *   grade, priority, lastVisitAt, growthAreaKey}>>} prioritised via prioritise.js.
 */
async function listTeachers(leaderUserId, schoolExtId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const teachers = await _teachers(leaderUserId, schoolExtId);
  const users = await _usersByPhone(teachers.map((t) => t.teacher_phone_e164));
  const phoneToUser = {};
  for (const u of users) phoneToUser[u.phone_number] = u;
  const visitMap = await _leaderVisitMap(leaderUserId);
  const analysisMap = await _latestAnalysisMap(users.map((u) => u.id));

  const rows = teachers.map((t) => {
    const u = phoneToUser[t.teacher_phone_e164] || null;
    const userId = u ? u.id : null;
    const lastVisitAt = userId ? (visitMap[userId] || null) : null;
    return {
      teacher_ext_id: t.teacher_ext_id,
      teacher_name: t.teacher_name,
      phone_e164: t.teacher_phone_e164,
      user_id: userId,
      grade: u ? firstGrade(u.grades_taught) : null,
      level: t.level || null, // NIETE roster level (PRIMARY/MIDDLE/HIGH/…)
      lastVisitAt,
      // bd-2329: the "needs support" term for the combined-weight sort.
      score: userId ? overallScoreFromAnalysis(analysisMap[userId]) : null,
      growthAreaKey: userId ? weakestAreaFromAnalysis(analysisMap[userId]) : null,
    };
  });

  return orderTeachers(rows, { today });
}

/**
 * The Support Brief payload for one teacher. NEVER throws — any failure degrades
 * to the no-data opening-tips variant.
 *
 * The brief is READ BY THE LEADER, so ALL rendered copy resolves in the LEADER'S
 * language (FIX 2): chrome, moves, strength/growth labels, trend bands. The
 * strength/growth labels are the strongest/weakest HOTS AREA names in the
 * leader's language (not the teacher's coaching-language analysis titles).
 *
 * FIX 3: when there is no usable AI-coaching analysis (no strongest AND no
 * weakest area — ~1/3 of teachers), noData:true is returned so the view renders
 * honest opening tips instead of a fabricated strength/area.
 *
 * @returns {Promise<{teacher, strengthLabel, growthLabel, moves, trend, showTrend, firstVisit, noData}>}
 */
async function buildBrief(leaderUserId, teacherExtId, schoolExtId) {
  // The brief's language is the LEADER'S (fetched once).
  const leaderPref = await leaderLang(leaderUserId);
  try {
    const [teachers, schools] = await Promise.all([
      _teachers(leaderUserId, schoolExtId),
      _schools(leaderUserId),
    ]);
    const t = teachers.find((x) => String(x.teacher_ext_id) === String(teacherExtId)) || null;
    const school = schools.find((s) => String(s.school_ext_id) === String(schoolExtId)) || null;

    const users = t ? await _usersByPhone([t.teacher_phone_e164]) : [];
    const u = users[0] || null;
    const userId = u ? u.id : null;

    // teacherOwnOnly: her OWN AI-coaching only — leader observations bound to
    // her user_id must never leak into the brief trend (two clean sources).
    const trend = userId ? await loadTrendData(userId, { locale: 'en', teacherOwnOnly: true }) : [];

    let analysis = null;
    if (userId) {
      const map = await _latestAnalysisMap([userId]);
      analysis = map[userId] || null;
    }
    const weakestArea = weakestAreaFromAnalysis(analysis);
    const strongestArea = strongestAreaFromAnalysis(analysis);
    const grade = u ? firstGrade(u.grades_taught) : null;

    const teacher = {
      teacher_name: t ? t.teacher_name : '',
      school_name: school ? school.school_name : '',
      preferred_language: leaderPref, // FIX 2: brief chrome renders in the LEADER'S language
      grade,
      user_id: userId,
    };

    // FIX 3: no usable coaching data → honest opening tips, no asserted area.
    // "Genuinely thin" = no usable area slots (either shape) AND no analysis
    // strengths. A HOTS session with goalN_* slots resolves to areas, so it is
    // NOT no-data (the bug: reading only `domains` made every HOTS teacher thin).
    const hasStrengths = analysis && Array.isArray(analysis.strengths) && analysis.strengths.length > 0;
    const noData = !weakestArea && !strongestArea && !hasStrengths;
    if (noData) {
      return {
        teacher,
        strengthLabel: null,
        growthLabel: null,
        moves: openingTips(leaderPref),
        trend,
        showTrend: false,
        firstVisit: true,
        noData: true,
      };
    }

    const moves = await buildMoves(
      { preferred_language: leaderPref, grade },
      { gaps: [], weakestArea },
    );

    return {
      teacher,
      // Leader-language HOTS AREA labels. Strength omitted when it would collide
      // with the growth area (single-domain analysis) — the view uses a neutral default.
      strengthLabel: (strongestArea && strongestArea !== weakestArea) ? areaLabel(strongestArea, leaderPref) : null,
      growthLabel: weakestArea ? areaLabel(weakestArea, leaderPref) : null,
      moves,
      trend,
      showTrend: trend.length >= 2,
      firstVisit: trend.length === 0,
      noData: false,
    };
  } catch (err) {
    logToFile('leader-source: buildBrief degraded to opening tips', { leaderUserId, teacherExtId, error: err.message });
    return {
      teacher: { teacher_name: '', school_name: '', preferred_language: leaderPref || 'en', grade: null, user_id: null },
      strengthLabel: null,
      growthLabel: null,
      moves: openingTips(leaderPref || 'en'),
      trend: [],
      showTrend: false,
      firstVisit: true,
      noData: true,
    };
  }
}

/** The leader's own preferred_language (for picker chrome). Defaults to 'en'. */
async function leaderLang(leaderUserId) {
  try {
    const { data } = await supabase
      .from('users').select('preferred_language').eq('id', leaderUserId).maybeSingle();
    return (data && data.preferred_language) || 'en';
  } catch (err) {
    logToFile('leader-source: leaderLang error', { leaderUserId, error: err.message });
    return 'en';
  }
}

/**
 * Minimal teacher resolution for the "Start observation" bind step — the Rumi
 * user_id (may be null), phone (E.164) and name. Returns null if not found.
 */
async function resolveTeacher(leaderUserId, teacherExtId, schoolExtId = null) {
  const teachers = await _teachers(leaderUserId, schoolExtId);
  const t = teachers.find((x) => String(x.teacher_ext_id) === String(teacherExtId)) || null;
  if (!t) return null;
  const users = await _usersByPhone([t.teacher_phone_e164]);
  const u = users[0] || null;
  return {
    teacher_ext_id: t.teacher_ext_id,
    teacher_name: t.teacher_name,
    phone_e164: t.teacher_phone_e164,
    user_id: u ? u.id : null,
    preferred_language: (u && u.preferred_language) || 'en',
  };
}

module.exports = {
  listSchools,
  listTeachers,
  buildBrief,
  leaderLang,
  resolveTeacher,
  // exported for tests:
  weakestAreaFromAnalysis,
  strongestAreaFromAnalysis,
  overallScoreFromAnalysis,
  areaLabel,
};
