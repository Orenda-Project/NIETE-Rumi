'use strict';
/**
 * Teacher Training Flow endpoint handler.
 *
 * Two-screen Flow (see docs/flows/teacher-training-flow-v1.json):
 *   TRAINING_HOME → 4 level cards with per-teacher progress + badges
 *   LEVEL_DETAIL  → 9 course cards for the picked level + grand-quiz status
 *   SUCCESS       → terminal
 *
 * When the Flow closes (Footer:Close, or grand-quiz start), the extension_message_response
 * hands control back to the bot which either:
 *   - open_course:      sends module list as inline WhatsApp messages
 *   - start_grand_quiz: kicks off the inline Q-by-Q assessment
 *   - close:            no-op
 *
 * Data source: NIETE-Rumi Supabase (training_* tables). Access is Program-gated:
 * a Teacher only sees Vendors they're Assigned to via teacher_training_assignments.
 * See CONTEXT.md + docs/adr/0001-training-domain-model-programs.md.
 */

const { logToFile } = require('../utils/logger');
const supabase = require('../config/supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const BADGES_BUCKET = 'training-assets';

function badgeUrl(name) {
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BADGES_BUCKET}/badges/${name}.png`;
}

/**
 * INIT — render Training Home from live DB state.
 */
async function handleTeacherTrainingInit(userId /*, flowToken */) {
  logToFile('🎓 Training Flow INIT', { userId });
  return buildTrainingHome(userId);
}

/**
 * data_exchange — user tapped something in TRAINING_HOME or LEVEL_DETAIL.
 */
async function handleTeacherTrainingDataExchange(userId, screen, screenData /*, flowToken */) {
  logToFile('🎓 Training Flow data_exchange', { userId, screen, screenData });

  if (screen === 'TRAINING_HOME') {
    const action = screenData._action;
    if (action === 'open_level') {
      const levelOrder = Number(screenData._level_order);
      return buildLevelDetail(userId, levelOrder);
    }
    if (action === 'close') return buildSuccessScreen('See you soon!');
    return createErrorResponse('Unknown action on training home');
  }

  if (screen === 'LEVEL_DETAIL') {
    const action = screenData._action;
    if (action === 'open_course') {
      return buildSuccessScreen('Opening course…', {
        trainingAction: 'open_course',
        courseId: screenData.course_id,
      });
    }
    if (action === 'start_grand_quiz') {
      return buildSuccessScreen('Starting your exam…', {
        trainingAction: 'start_grand_quiz',
        levelOrder: screenData._level_order,
      });
    }
    if (action === 'back_home') return buildTrainingHome(userId);
    return createErrorResponse('Unknown action on level detail');
  }

  logToFile('⚠️ Unknown screen in training flow', { screen });
  return createErrorResponse('Unknown screen');
}

/**
 * BACK — always refresh Training Home.
 */
async function handleTeacherTrainingBack(userId /*, screen, flowToken */) {
  logToFile('🎓 Training Flow BACK', { userId });
  return buildTrainingHome(userId);
}

// ─── Builders ──────────────────────────────────────────────────────────────

async function buildTrainingHome(userId) {
  const [teacher, catalog] = await Promise.all([
    loadTeacher(userId),
    loadVisibleLevelsWithProgress(userId),
  ]);
  if (!teacher) return errorScreen('We could not find your training profile. Please contact NIETE support.');
  if (catalog.length === 0) {
    return errorScreen(
      `No training assigned yet, ${teacher.first_name || 'teacher'}. ` +
      'Please contact your NIETE program lead to enrol you.'
    );
  }

  // We only render 4 level slots (matches the Flow JSON). Pad with locked cards if the
  // teacher's Program exposes fewer levels — future-proof for shorter Programs.
  const data = {
    hero_title:    'Teacher Training',
    hero_subtitle: teacherSubtitle(teacher),
    hero_progress: overallProgressLine(catalog),
  };
  for (let i = 0; i < 4; i++) {
    const slot = i + 1;
    const lvl = catalog[i];
    if (!lvl) {
      if (slot < 4) data[`level_${slot}_badge_url`] = badgeUrl('badge_level_locked');
      data[`level_${slot}_title`]     = `Level ${slot}`;
      data[`level_${slot}_progress`]  = 'Not part of your program';
      data[`level_${slot}_state`]     = 'locked';
      data[`level_${slot}_cta`]       = '🔒 Locked';
      continue;
    }
    if (slot < 4) data[`level_${slot}_badge_url`] = badgeUrl(levelBadgeName(lvl));
    data[`level_${slot}_title`]     = `Level ${lvl.order_index + 1} · ${lvl.name}`;
    data[`level_${slot}_progress`]  = levelProgressLine(lvl);
    data[`level_${slot}_state`]     = lvl.state;
    data[`level_${slot}_cta`]       = ctaForLevel(lvl);
  }

  return { screen: 'TRAINING_HOME', data };
}

async function buildLevelDetail(userId, levelOrder) {
  const catalog = await loadVisibleLevelsWithProgress(userId);
  const lvl = catalog.find(l => l.order_index === levelOrder - 1);
  if (!lvl) return errorScreen('That level is not part of your program.');
  if (lvl.state === 'locked') return errorScreen(`Pass Level ${levelOrder - 1}'s grand quiz first to unlock this level.`);

  const courses = await loadCoursesWithProgress(userId, lvl.id);
  const grandQuiz = await loadGrandQuizState(userId, lvl.id);

  return {
    screen: 'LEVEL_DETAIL',
    data: {
      level_title:    `Level ${lvl.order_index + 1} · ${lvl.name}`,
      level_progress: `${lvl.courses_completed}/${lvl.courses_total} courses · ${lvl.pct_complete}% complete`,
      course_list:    courses.map(c => ({
        id:    String(c.id),
        title: `${c.title} — ${courseProgressLabel(c)}`,
      })),
      grand_quiz_badge_url: badgeUrl(grandQuiz.badge),
      grand_quiz_body:      grandQuiz.body,
      grand_quiz_caption:   grandQuiz.caption,
      grand_quiz_cta:       grandQuiz.cta,
    },
  };
}

// ─── Data loaders ──────────────────────────────────────────────────────────

async function loadTeacher(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, name, phone_number, teacher_uuid, levels, school_name')
    .eq('id', userId)
    .single();
  if (error) {
    logToFile('❌ loadTeacher failed', { userId, error: error.message });
    return null;
  }
  return data;
}

/**
 * Returns the levels visible to this teacher via their active Program Assignments,
 * each with progress derived from teacher_training_progress + training_assessment_attempts.
 *
 * Under phase 1 there is one Program (niete_standard) with full-TALEEMABAD scope,
 * so this returns the 4 TALEEMABAD levels — but we walk the Programs → Scopes →
 * Levels graph so multi-Vendor is supported for free from day one.
 */
async function loadVisibleLevelsWithProgress(userId) {
  // 1. Active program assignments for this teacher
  const { data: assignments, error: aErr } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (aErr || !assignments || assignments.length === 0) return [];

  const programIds = assignments.map(a => a.program_id);

  // 2. Scopes referenced by those programs
  const { data: scopes, error: sErr } = await supabase
    .from('training_program_scopes')
    .select('vendor_id, level_ids')
    .in('program_id', programIds);
  if (sErr || !scopes || scopes.length === 0) return [];

  // 3. Levels — filter by vendor + (optional) level_ids per scope
  const vendorIds = [...new Set(scopes.map(s => s.vendor_id))];
  const { data: allLevels, error: lErr } = await supabase
    .from('training_levels')
    .select('id, vendor_id, name, order_index, cpd_level, is_active')
    .in('vendor_id', vendorIds)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  if (lErr || !allLevels) return [];

  // Per-vendor level_ids allow-list (NULL in a scope = all levels of that vendor)
  const allowedByVendor = new Map();
  for (const s of scopes) {
    const cur = allowedByVendor.get(s.vendor_id);
    if (cur === 'all') continue;
    if (!s.level_ids || s.level_ids.length === 0) allowedByVendor.set(s.vendor_id, 'all');
    else allowedByVendor.set(s.vendor_id, [...(cur || []), ...s.level_ids]);
  }
  const visibleLevels = allLevels.filter(l => {
    const allow = allowedByVendor.get(l.vendor_id);
    return allow === 'all' || (Array.isArray(allow) && allow.includes(l.id));
  });

  if (visibleLevels.length === 0) return [];

  // 4. Progress: courses complete + grand-quiz pass state per level
  const levelIds = visibleLevels.map(l => l.id);
  const [{ data: courses }, { data: progressRows }, { data: attempts }, { data: quizzes }] = await Promise.all([
    supabase.from('training_courses').select('id, level_id, is_active').in('level_id', levelIds),
    supabase.from('teacher_training_progress').select('module_id, module:training_modules(course_id)').eq('user_id', userId),
    supabase.from('training_assessment_attempts').select('level_id, status, is_passed, cooldown_until, completed_at').eq('user_id', userId).in('level_id', levelIds),
    supabase.from('training_grand_quizzes').select('id, level_id, quiz_type').in('level_id', levelIds).eq('quiz_type', 'grand_quiz'),
  ]);

  // Course completion = every active course under a level has ≥1 module completed
  // Phase 1: simpler proxy — a course is "started" if any of its modules is in teacher_training_progress
  const progressByCourse = new Map();
  for (const p of progressRows || []) {
    const cid = p?.module?.course_id;
    if (cid) progressByCourse.set(cid, (progressByCourse.get(cid) || 0) + 1);
  }

  return visibleLevels.map(lv => {
    const lvCourses = (courses || []).filter(c => c.level_id === lv.id && c.is_active);
    const coursesStarted = lvCourses.filter(c => (progressByCourse.get(c.id) || 0) > 0);
    // NOTE: full "course completed" requires all modules of the course to be in progress; phase 1
    // uses "started" as a proxy until the module-completion path is wired.
    const passedAttempt = (attempts || []).find(a => a.level_id === lv.id && a.is_passed === true);
    const cooldownAttempt = (attempts || []).find(a => a.level_id === lv.id && a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date());
    const prevLevel = visibleLevels.find(l => l.order_index === lv.order_index - 1);
    const prevPassed = !prevLevel || !!(attempts || []).find(a => a.level_id === prevLevel.id && a.is_passed === true);
    const isFirst = !prevLevel;
    const grand = (quizzes || []).find(q => q.level_id === lv.id) || null;

    let state;
    if (!prevPassed && !isFirst) state = 'locked';
    else if (passedAttempt) state = 'certified';
    else if (coursesStarted.length === lvCourses.length && lvCourses.length > 0) state = 'ready_for_quiz';
    else if (coursesStarted.length > 0) state = 'in_progress';
    else state = 'not_started';

    return {
      id: lv.id,
      order_index: lv.order_index,
      name: lv.name,
      cpd_level: lv.cpd_level,
      state,
      courses_total: lvCourses.length,
      courses_completed: coursesStarted.length,
      pct_complete: lvCourses.length === 0 ? 0 : Math.round((coursesStarted.length / lvCourses.length) * 100),
      passed_at: passedAttempt?.completed_at || null,
      cooldown_until: cooldownAttempt?.cooldown_until || null,
      grand_quiz_id: grand?.id || null,
    };
  });
}

async function loadCoursesWithProgress(userId, levelId) {
  const [{ data: courses }, { data: progressRows }, { data: modules }] = await Promise.all([
    supabase.from('training_courses').select('id, title, order_index').eq('level_id', levelId).eq('is_active', true).order('order_index'),
    supabase.from('teacher_training_progress').select('module_id').eq('user_id', userId),
    supabase.from('training_modules').select('id, course_id').eq('is_active', true),
  ]);
  const doneModuleIds = new Set((progressRows || []).map(r => r.module_id));
  const modulesByCourse = new Map();
  for (const m of modules || []) {
    if (!modulesByCourse.has(m.course_id)) modulesByCourse.set(m.course_id, []);
    modulesByCourse.get(m.course_id).push(m.id);
  }
  return (courses || []).map(c => {
    const total = (modulesByCourse.get(c.id) || []).length;
    const done = (modulesByCourse.get(c.id) || []).filter(id => doneModuleIds.has(id)).length;
    return { id: c.id, title: c.title, order_index: c.order_index, modules_total: total, modules_done: done };
  });
}

async function loadGrandQuizState(userId, levelId) {
  const [{ data: catalog }, { data: attempts }, { data: courses }, { data: modules }, { data: progressRows }] = await Promise.all([
    supabase.from('training_grand_quizzes').select('id, quiz_type').eq('level_id', levelId).eq('quiz_type', 'grand_quiz').eq('is_active', true).maybeSingle(),
    supabase.from('training_assessment_attempts').select('status, is_passed, cooldown_until').eq('user_id', userId).eq('level_id', levelId),
    supabase.from('training_courses').select('id').eq('level_id', levelId).eq('is_active', true),
    supabase.from('training_modules').select('id, course_id').eq('is_active', true),
    supabase.from('teacher_training_progress').select('module_id').eq('user_id', userId),
  ]);
  if (!catalog) return { badge: 'badge_quiz_locked', body: 'No grand quiz for this level', caption: ' ', cta: '🔒 Locked' };

  const passed = (attempts || []).some(a => a.is_passed === true);
  const cooldown = (attempts || []).find(a => a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date());
  const doneIds = new Set((progressRows || []).map(r => r.module_id));
  const courseIds = new Set((courses || []).map(c => c.id));
  const modulesInLevel = (modules || []).filter(m => courseIds.has(m.course_id));
  const allDone = modulesInLevel.length > 0 && modulesInLevel.every(m => doneIds.has(m.id));

  if (passed) return { badge: 'badge_quiz_passed', body: 'You passed this level exam.', caption: 'Certificate available in your records.', cta: '✓ Passed' };
  if (cooldown) {
    const hoursLeft = Math.max(1, Math.round((new Date(cooldown.cooldown_until) - Date.now()) / 3_600_000));
    return { badge: 'badge_quiz_cooldown', body: 'Exam locked after a recent failed attempt.', caption: `Try again in about ${hoursLeft} hours.`, cta: `⏳ Cooldown (${hoursLeft}h)` };
  }
  if (!allDone) return { badge: 'badge_quiz_locked', body: 'Unlocks when all courses are complete.', caption: '62 questions · 100% required · 24h cooldown on fail', cta: '🔒 Locked' };
  return { badge: 'badge_quiz_available', body: 'Ready — start your level exam.', caption: '100% required to pass · 24h cooldown on fail', cta: 'Start exam' };
}

// ─── Presentation helpers ──────────────────────────────────────────────────

function teacherSubtitle(t) {
  const name = t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim() || t.phone_number;
  const school = t.school_name ? ` · ${t.school_name}` : '';
  return `${name}${school}`;
}

function overallProgressLine(levels) {
  const totalC = levels.reduce((s, l) => s + l.courses_total, 0);
  const doneC  = levels.reduce((s, l) => s + l.courses_completed, 0);
  if (totalC === 0) return '';
  const pct = Math.round((doneC / totalC) * 100);
  return `${pct}% done · ${doneC}/${totalC} courses`;
}

function levelProgressLine(lv) {
  if (lv.state === 'locked') return `Unlocks after Level ${lv.order_index} exam`;
  if (lv.state === 'certified') return `${lv.courses_completed}/${lv.courses_total} courses ✓ · Exam passed`;
  if (lv.state === 'ready_for_quiz') return `${lv.courses_completed}/${lv.courses_total} courses ✓ · Ready for exam`;
  if (lv.state === 'in_progress') return `${lv.courses_completed}/${lv.courses_total} courses · ${lv.pct_complete}% done`;
  return `${lv.courses_total} courses · not started`;
}

function levelBadgeName(lv) {
  if (lv.state === 'locked') return 'badge_level_locked';
  if (lv.state === 'certified') return 'badge_level_certified';
  if (lv.state === 'ready_for_quiz') return 'badge_level_completed';
  if (lv.state === 'in_progress') return 'badge_level_in_progress';
  return 'badge_level_locked'; // 'not_started' also uses a soft-locked look
}

function ctaForLevel(lv) {
  if (lv.state === 'locked') return '🔒 Locked';
  if (lv.state === 'certified') return 'Review';
  if (lv.state === 'ready_for_quiz') return 'Take exam';
  if (lv.state === 'in_progress') return 'Continue';
  return 'Start';
}

function courseProgressLabel(c) {
  if (c.modules_total === 0) return 'no modules';
  if (c.modules_done === c.modules_total) return `${c.modules_done}/${c.modules_total} modules ✓`;
  return `${c.modules_done}/${c.modules_total} modules`;
}

function courseBadgeName(c) {
  if (c.modules_total === 0) return 'badge_course_not_started';
  if (c.modules_done === c.modules_total) return 'badge_course_completed';
  if (c.modules_done > 0) return 'badge_course_in_progress';
  return 'badge_course_not_started';
}

// ─── Response shapes (match quiz-flow-endpoint conventions) ────────────────

function buildSuccessScreen(message, extras = {}) {
  return {
    screen: 'SUCCESS',
    data: {
      message,
      extension_message_response: {
        params: {
          training_action: extras.trainingAction || 'close',
          ...(extras.courseId ? { course_id: String(extras.courseId) } : {}),
          ...(extras.levelOrder ? { level_order: String(extras.levelOrder) } : {}),
        },
      },
    },
  };
}

function errorScreen(message) {
  return {
    screen: 'SUCCESS',
    data: { message, extension_message_response: { params: { training_action: 'error' } } },
  };
}

function createErrorResponse(message) {
  return { data: { error: { message } } };
}

module.exports = {
  handleTeacherTrainingInit,
  handleTeacherTrainingDataExchange,
  handleTeacherTrainingBack,
};
