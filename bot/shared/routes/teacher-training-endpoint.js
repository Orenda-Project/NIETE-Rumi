'use strict';
/**
 * Teacher Training Flow endpoint handler.
 *
 * Three-screen Flow (see docs/flows/teacher-training-flow-v1.json):
 *   VENDOR_PICKER → one row per Vendor (Taleemabad / Oxbridge / Beacon House)
 *                   the teacher is enrolled in; auto-skipped when only one.
 *   TRAINING_HOME → up to 5 level cards for the picked Vendor
 *   LEVEL_DETAIL  → module cards for the picked level + grand-quiz status
 *   SUCCESS       → terminal
 *
 * When the Flow closes (Footer:Close, or grand-quiz start), the
 * extension_message_response hands control back to the bot which either:
 *   - open_module:      sends the module video/audio as inline messages
 *   - start_grand_quiz: kicks off the inline Q-by-Q assessment
 *   - close:            no-op
 *
 * Data source: NIETE-Rumi Supabase (training_* tables). Access is Program-gated:
 * a Teacher only sees Vendors they're Assigned to via teacher_training_assignments.
 * See CONTEXT.md + docs/adr/0001-training-domain-model-programs.md.
 *
 * bd-2102 (Anam Masood 2026-07-17): a multi-vendor teacher was seeing all
 * vendors' levels mixed into a single dropdown — "Level 1 English" from
 * Beacon House next to "Level 1 Aspiring Teacher" from Taleemabad. The
 * VENDOR_PICKER screen restores program-level distinctness so the teacher
 * chooses which program to open before seeing that program's levels.
 * Single-vendor teachers still see TRAINING_HOME directly — no extra tap.
 */

const { logToFile } = require('../utils/logger');
const supabase = require('../config/supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const BADGES_BUCKET = 'training-assets';

function badgeUrl(name) {
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BADGES_BUCKET}/badges/${name}.png`;
}

/**
 * INIT — render either the vendor picker (multi-vendor teacher) or the
 * training home scoped to the sole vendor (single-vendor teacher).
 */
async function handleTeacherTrainingInit(userId /*, flowToken */) {
  logToFile('🎓 Training Flow INIT', { userId });
  const catalog = await loadVisibleLevelsWithProgress(userId);
  const teacher = await loadTeacher(userId);
  if (!teacher) return errorScreen('We could not find your training profile. Please contact NIETE support.');
  if (catalog.length === 0) {
    return errorScreen(
      `No training assigned yet, ${teacher.first_name || 'teacher'}. ` +
      'Please contact your NIETE program lead to enrol you.'
    );
  }

  const vendors = partitionByVendor(catalog);
  if (vendors.length > 1) {
    return buildVendorPicker(userId, teacher, vendors);
  }
  // Single-vendor teacher — skip picker, go straight to home for that vendor.
  return buildTrainingHome(userId, { vendorKey: vendors[0].vendor_key, teacher, catalog });
}

/**
 * data_exchange — user tapped something in VENDOR_PICKER / TRAINING_HOME /
 * LEVEL_DETAIL.
 */
async function handleTeacherTrainingDataExchange(userId, screen, screenData /*, flowToken */) {
  logToFile('🎓 Training Flow data_exchange', { userId, screen, screenData });

  if (screen === 'VENDOR_PICKER') {
    const action = screenData._action;
    if (action === 'open_vendor') {
      const vendorKey = String(screenData._vendor_key || '').trim();
      if (!vendorKey) return createErrorResponse('Missing vendor');
      return buildTrainingHome(userId, { vendorKey });
    }
    if (action === 'close') return buildSuccessScreen('See you soon!');
    return createErrorResponse('Unknown action on vendor picker');
  }

  if (screen === 'TRAINING_HOME') {
    const action = screenData._action;
    if (action === 'open_level') {
      // parseInt tolerates the composite "N_i" ids emitted by buildTrainingHome
      // to keep dropdown option ids unique when multiple levels of the current
      // vendor share the same order_index (extremely rare after partitioning
      // by vendor, but kept as defence-in-depth). Legacy plain-numeric ids
      // still parse as themselves.
      const levelOrder = parseInt(String(screenData._level_order), 10);
      const vendorKey = String(screenData._vendor_key || '').trim() || null;
      return buildLevelDetail(userId, levelOrder, { vendorKey });
    }
    if (action === 'back_to_vendors') {
      // Multi-vendor teacher tapped "Switch program" — send them back.
      const catalog = await loadVisibleLevelsWithProgress(userId);
      const teacher = await loadTeacher(userId);
      const vendors = partitionByVendor(catalog);
      if (vendors.length > 1 && teacher) return buildVendorPicker(userId, teacher, vendors);
      // Only one vendor — nothing to switch to; refresh home instead.
      return buildTrainingHome(userId, { vendorKey: vendors[0]?.vendor_key });
    }
    if (action === 'close') return buildSuccessScreen('See you soon!');
    return createErrorResponse('Unknown action on training home');
  }

  if (screen === 'LEVEL_DETAIL') {
    const action = screenData._action;
    const vendorKey = String(screenData._vendor_key || '').trim() || null;
    if (action === 'open_module') {
      return buildSuccessScreen('Opening module…', {
        trainingAction: 'open_module',
        moduleId: screenData.module_id,
      });
    }
    if (action === 'open_course') {
      // Legacy — kept for compatibility with older client caches
      return buildSuccessScreen('Opening course…', {
        trainingAction: 'open_course',
        courseId: screenData.course_id,
      });
    }
    if (action === 'start_grand_quiz') {
      // WhatsApp Flow's on-click-action.payload doesn't interpolate ${data.*} —
      // only literals and ${form.*} — so LEVEL_DETAIL can't pass level_order back
      // through the button. Infer it from server state (scoped to the current
      // vendor when we know it) instead: only ONE level can be in
      // 'ready_for_quiz' at a time within a chain-locked vendor, so lookup is
      // unambiguous.
      let levelOrder = screenData._level_order;
      if (!levelOrder) {
        const catalog = await loadVisibleLevelsWithProgress(userId);
        const scoped = vendorKey
          ? (catalog || []).filter(l => l.vendor_key === vendorKey)
          : (catalog || []);
        const readyLevels = scoped.filter(l => l.state === 'ready_for_quiz');
        if (readyLevels.length === 1) {
          levelOrder = readyLevels[0].order_index + 1;
          logToFile('🎓 Inferred levelOrder from ready state', { userId, vendorKey, levelOrder });
        } else {
          logToFile('❌ Cannot infer levelOrder for start_grand_quiz', {
            userId, vendorKey, readyCount: readyLevels.length,
          });
          return errorScreen('Please open the level again and tap Take exam.');
        }
      }
      return buildSuccessScreen('Starting your exam…', {
        trainingAction: 'start_grand_quiz',
        levelOrder,
      });
    }
    if (action === 'back_home') return buildTrainingHome(userId, { vendorKey });
    return createErrorResponse('Unknown action on level detail');
  }

  logToFile('⚠️ Unknown screen in training flow', { screen });
  return createErrorResponse('Unknown screen');
}

/**
 * BACK — return to the previous logical screen. From LEVEL_DETAIL / TRAINING_HOME
 * we always want the training home. Multi-vendor teachers can use the
 * "Switch program" tap to get back to the picker.
 */
async function handleTeacherTrainingBack(userId, screen /*, flowToken */) {
  logToFile('🎓 Training Flow BACK', { userId, screen });
  // No vendor key is carried through the raw BACK gesture — recompute from state.
  const catalog = await loadVisibleLevelsWithProgress(userId);
  const teacher = await loadTeacher(userId);
  if (!teacher) return errorScreen('We could not find your training profile. Please contact NIETE support.');
  const vendors = partitionByVendor(catalog);
  if (vendors.length > 1) return buildVendorPicker(userId, teacher, vendors);
  return buildTrainingHome(userId, { vendorKey: vendors[0]?.vendor_key, teacher, catalog });
}

// ─── Builders ──────────────────────────────────────────────────────────────

/**
 * bd-2102 — group a flat catalog of levels (as returned by
 * loadVisibleLevelsWithProgress) by vendor. Preserves each vendor's internal
 * level order. Returns a stable-ordered array of {vendor_key, vendor_name,
 * unlock_logic, levels[], summary} — vendor order derived from the first
 * appearance of each vendor in the catalog. Pure — no DB access; safe to
 * unit-test with fixture data.
 */
function partitionByVendor(catalog) {
  const groups = new Map();  // vendor_key → group
  for (const lvl of catalog || []) {
    const key = lvl.vendor_key;
    if (!key) continue;  // guard: skip rows without a vendor tag
    if (!groups.has(key)) {
      groups.set(key, {
        vendor_key:   key,
        vendor_name:  lvl.vendor_name || key,
        unlock_logic: lvl.unlock_logic || 'chain',
        levels:       [],
      });
    }
    groups.get(key).levels.push(lvl);
  }
  // Sort each vendor's levels by order_index.
  for (const g of groups.values()) {
    g.levels.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    const totalC = g.levels.reduce((s, l) => s + (l.courses_total || 0), 0);
    const doneC  = g.levels.reduce((s, l) => s + (l.courses_completed || 0), 0);
    g.summary = {
      levels_total:     g.levels.length,
      levels_certified: g.levels.filter(l => l.state === 'certified').length,
      courses_total:    totalC,
      courses_done:     doneC,
      pct_complete:     totalC === 0 ? 0 : Math.round((doneC / totalC) * 100),
    };
  }
  return Array.from(groups.values());
}

/**
 * Build the VENDOR_PICKER screen. One row per vendor, showing progress summary.
 * The dropdown value is the vendor_key (e.g. TALEEMABAD / OXBRIDGE / BEACONHOUSE)
 * which the data_exchange handler uses to scope buildTrainingHome.
 */
function buildVendorPicker(userId, teacher, vendors) {
  const data = {
    hero_title:    'Choose a program',
    hero_subtitle: teacherSubtitle(teacher),
    hero_caption:  `You are enrolled in ${vendors.length} training programs. Pick one to open its levels.`,
    vendor_options: vendors.map(v => ({
      id:    v.vendor_key,
      title: v.vendor_name,
      description: vendorSummaryLine(v),
    })),
  };
  logToFile('🎓 VENDOR_PICKER response snapshot', {
    userId,
    vendor_count: vendors.length,
    vendor_keys: vendors.map(v => v.vendor_key),
  });
  return { screen: 'VENDOR_PICKER', data };
}

/**
 * Build the TRAINING_HOME screen scoped to a single vendor. If vendorKey is
 * absent, we default to the first vendor in the catalog — which is the correct
 * behaviour for single-vendor teachers.
 *
 * The prefetched teacher + catalog args let the INIT handler avoid a duplicate
 * DB round-trip. Falls back to loading when omitted (e.g. data_exchange path).
 */
async function buildTrainingHome(userId, opts = {}) {
  let { vendorKey, teacher, catalog } = opts;
  if (!teacher || !catalog) {
    const [t, c] = await Promise.all([
      teacher ? Promise.resolve(teacher) : loadTeacher(userId),
      catalog ? Promise.resolve(catalog) : loadVisibleLevelsWithProgress(userId),
    ]);
    teacher = t;
    catalog = c;
  }
  if (!teacher) return errorScreen('We could not find your training profile. Please contact NIETE support.');
  if (!catalog || catalog.length === 0) {
    return errorScreen(
      `No training assigned yet, ${teacher.first_name || 'teacher'}. ` +
      'Please contact your NIETE program lead to enrol you.'
    );
  }

  const vendors = partitionByVendor(catalog);
  const isMultiVendor = vendors.length > 1;
  // Scope to the chosen vendor; fall back to the first (single-vendor case).
  const chosen = vendorKey
    ? vendors.find(v => v.vendor_key === vendorKey) || vendors[0]
    : vendors[0];
  if (!chosen) return errorScreen('That program is not part of your enrolment.');
  const vendorLevels = chosen.levels;

  const data = {
    hero_title:      chosen.vendor_name,
    hero_subtitle:   teacherSubtitle(teacher),
    hero_progress:   vendorSummaryLine(chosen),
    hero_vendor_key: chosen.vendor_key,  // echoed back through form actions
    switch_program_visible: isMultiVendor,
  };
  for (let i = 0; i < 5; i++) {
    const slot = i + 1;
    const lvl = vendorLevels[i];
    if (!lvl) {
      const ghost = ghostSlotData(slot);
      data[`level_${slot}_title`]     = ghost.title;
      data[`level_${slot}_progress`]  = ghost.progress;
      data[`level_${slot}_visible`]   = ghost.visible;
      continue;
    }
    data[`level_${slot}_title`]     = levelDisplayTitle(lvl);
    data[`level_${slot}_progress`]  = levelProgressLine(lvl);
    data[`level_${slot}_visible`]   = true;
  }

  // Dropdown options for the chosen vendor. Composite id kept as a defence-
  // in-depth against the extremely rare same-vendor order_index collision;
  // after partitioning, within a single vendor's list they will almost always
  // be unique already.
  data.level_options = vendorLevels.slice(0, 5).map((lvl, i) => ({
    id:    `${lvl.order_index + 1}_${i}`,
    title: levelOptionTitle(lvl),
  }));

  logToFile('🎓 TRAINING_HOME response snapshot', {
    userId,
    vendor_key: chosen.vendor_key,
    vendor_level_count: vendorLevels.length,
    level_options_count: data.level_options.length,
    level_options: data.level_options,
    is_multi_vendor: isMultiVendor,
  });

  return { screen: 'TRAINING_HOME', data };
}

async function buildLevelDetail(userId, levelOrder, opts = {}) {
  const { vendorKey } = opts;
  const catalog = await loadVisibleLevelsWithProgress(userId);
  const scoped = vendorKey ? catalog.filter(l => l.vendor_key === vendorKey) : catalog;
  const lvl = scoped.find(l => l.order_index === levelOrder - 1);
  if (!lvl) return errorScreen('That level is not part of your program.');
  if (lvl.state === 'locked') return errorScreen(`Pass Level ${levelOrder - 2}'s grand quiz first to unlock this level.`);

  const modules = await loadModulesWithProgress(userId, lvl.id);
  const grandQuiz = await loadGrandQuizState(userId, lvl.id);

  const totalModules = modules.length;
  const doneModules = modules.filter(m => m.done).length;
  const pct = totalModules === 0 ? 0 : Math.round((doneModules / totalModules) * 100);

  return {
    screen: 'LEVEL_DETAIL',
    data: {
      level_title:    levelDisplayTitle(lvl),
      level_progress: `${doneModules}/${totalModules} modules done · ${pct}%`,
      level_order:    String(levelOrder),
      // bd-2102 — echoed back through payload interpolation so downstream
      // data_exchange keeps the vendor scope. Falls back to '' for single-
      // vendor teachers whose level rows don't carry a resolved key.
      vendor_key:     String(lvl.vendor_key || ''),
      module_list:    modules.map(m => ({
        id:          String(m.id),
        title:       m.title.length > 40 ? `${m.title.slice(0, 37)}…` : m.title,
        description: `${m.course_title} · ${m.done ? '✓ Watched' : 'Not started'}`,
      })),
      grand_quiz_body:      grandQuiz.body,
      grand_quiz_caption:   grandQuiz.caption,
      grand_quiz_cta:       grandQuiz.cta,
    },
  };
}

/**
 * Return every active module under a level, joined to its course, with a
 * per-teacher "done" flag from teacher_training_progress. Sorted by course
 * order then module order — so a teacher scrolling the dropdown sees a
 * natural progression through the level's topics.
 */
async function loadModulesWithProgress(userId, levelId) {
  const [{ data: courses }, { data: modules }, { data: progressRows }] = await Promise.all([
    supabase.from('training_courses').select('id, title, order_index').eq('level_id', levelId).eq('is_active', true).order('order_index'),
    supabase.from('training_modules').select('id, course_id, title, order_index').eq('is_active', true),
    supabase.from('teacher_training_progress').select('module_id').eq('user_id', userId),
  ]);
  const doneIds = new Set((progressRows || []).map(r => r.module_id));
  const courseById = new Map((courses || []).map(c => [c.id, c]));
  const levelModules = (modules || []).filter(m => courseById.has(m.course_id));
  levelModules.sort((a, b) => {
    const ca = courseById.get(a.course_id).order_index;
    const cb = courseById.get(b.course_id).order_index;
    if (ca !== cb) return ca - cb;
    return (a.order_index || 0) - (b.order_index || 0);
  });
  return levelModules.map(m => ({
    id: m.id,
    title: m.title,
    course_title: courseById.get(m.course_id).title,
    done: doneIds.has(m.id),
  }));
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

  // 3. Levels — filter by vendor + (optional) level_ids per scope. We also
  // read each vendor's unlock_logic so open-access vendors (Oxbridge) can
  // bypass the chain-lock that gates Level N behind Level N-1's exam.
  const vendorIds = [...new Set(scopes.map(s => s.vendor_id))];
  const [{ data: allLevels, error: lErr }, { data: vendorRows }] = await Promise.all([
    supabase
      .from('training_levels')
      .select('id, vendor_id, name, order_index, cpd_level, is_active')
      .in('vendor_id', vendorIds)
      .eq('is_active', true)
      .order('order_index', { ascending: true }),
    supabase.from('training_vendors').select('id, key, name, unlock_logic, has_grand_quiz').in('id', vendorIds),
  ]);
  if (lErr || !allLevels) return [];
  const vendorById = new Map((vendorRows || []).map(v => [v.id, v]));

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
    const vendor = vendorById.get(lv.vendor_id);
    const chainLocked = vendor?.unlock_logic === 'chain';
    const prevLevel = visibleLevels
      .filter(l => l.vendor_id === lv.vendor_id)
      .find(l => l.order_index === lv.order_index - 1);
    const prevPassed = !prevLevel || !!(attempts || []).find(a => a.level_id === prevLevel.id && a.is_passed === true);
    const isFirst = !prevLevel;
    const grand = (quizzes || []).find(q => q.level_id === lv.id) || null;

    let state;
    if (chainLocked && !prevPassed && !isFirst) state = 'locked';
    else if (passedAttempt) state = 'certified';
    else if (coursesStarted.length === lvCourses.length && lvCourses.length > 0) state = 'ready_for_quiz';
    else if (coursesStarted.length > 0) state = 'in_progress';
    else state = 'not_started';

    return {
      id: lv.id,
      order_index: lv.order_index,
      name: lv.name,
      cpd_level: lv.cpd_level,
      // bd-2102 — vendor tags let partitionByVendor group and label per-program.
      vendor_id:    lv.vendor_id,
      vendor_key:   vendor?.key || null,
      vendor_name:  vendor?.name || vendor?.key || null,
      unlock_logic: vendor?.unlock_logic || 'chain',
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
  if (!catalog) return { badge: 'badge_quiz_available', body: '🎓 No level exam — finish all sessions to complete this level.', caption: ' ', cta: ' ' };

  const passed = (attempts || []).some(a => a.is_passed === true);
  const cooldown = (attempts || []).find(a => a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date());
  const doneIds = new Set((progressRows || []).map(r => r.module_id));
  const courseIds = new Set((courses || []).map(c => c.id));
  // Match the "ready_for_quiz" criterion in loadVisibleLevelsWithProgress: a level is
  // ready when every course has ≥1 module completed (not every module in the level).
  // Keeping these two checks aligned prevents the "HOME says ready, LEVEL_DETAIL says
  // locked" mismatch seen with imported historical progress.
  const startedCourseIds = new Set(
    (modules || []).filter(m => courseIds.has(m.course_id) && doneIds.has(m.id)).map(m => m.course_id)
  );
  const allDone = courseIds.size > 0 && startedCourseIds.size === courseIds.size;

  if (passed) return { badge: 'badge_quiz_passed', body: '🏆 Grand Quiz — You passed this level exam.', caption: 'Certificate available in your records.', cta: '✓ Passed' };
  if (cooldown) {
    const hoursLeft = Math.max(1, Math.round((new Date(cooldown.cooldown_until) - Date.now()) / 3_600_000));
    return { badge: 'badge_quiz_cooldown', body: '⏳ Grand Quiz — Locked after a recent failed attempt.', caption: `Try again in about ${hoursLeft} hours.`, cta: `⏳ Cooldown (${hoursLeft}h)` };
  }
  if (!allDone) return { badge: 'badge_quiz_locked', body: '🔒 Grand Quiz — Unlocks when all courses are complete.', caption: '62 questions · 100% required · 24h cooldown on fail', cta: '🔒 Locked' };
  return { badge: 'badge_quiz_available', body: '📝 Grand Quiz — Ready. Start your level exam.', caption: '100% required to pass · 24h cooldown on fail', cta: 'Start exam' };
}

// ─── Presentation helpers ──────────────────────────────────────────────────

function teacherSubtitle(t) {
  const name = t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim() || t.phone_number;
  const school = t.school_name ? ` · ${t.school_name}` : '';
  return `${name}${school}`;
}

function vendorSummaryLine(vendor) {
  const s = vendor.summary || {};
  const pct = s.pct_complete ?? 0;
  const doneC = s.courses_done ?? 0;
  const totalC = s.courses_total ?? 0;
  const cert = s.levels_certified ?? 0;
  const tot = s.levels_total ?? vendor.levels.length;
  const parts = [];
  parts.push(`${tot} levels`);
  if (cert > 0) parts.push(`${cert} certified`);
  if (totalC > 0) parts.push(`${pct}% · ${doneC}/${totalC} courses`);
  return parts.join(' · ');
}

function overallProgressLine(levels) {
  const totalC = levels.reduce((s, l) => s + l.courses_total, 0);
  const doneC  = levels.reduce((s, l) => s + l.courses_completed, 0);
  if (totalC === 0) return '';
  const pct = Math.round((doneC / totalC) * 100);
  return `${pct}% done · ${doneC}/${totalC} courses`;
}

// Shorter display name for dropdown/heading rendering. The Oxbridge level's
// canonical name is 68 chars ("Professional Training in Game-Based Teaching,
// Learning & Assessment") — that overflows in RadioButtonsGroup items. Map
// known long names to a friendlier shortform; everything else passes through.
function shortLevelName(lv) {
  if (typeof lv.name === 'string' && lv.name.startsWith('Professional Training in Game-Based Teaching')) {
    return 'Game-Based Teaching (Oxbridge)';
  }
  return lv.name;
}

function levelProgressLine(lv) {
  if (lv.state === 'locked') return `Unlocks after Level ${lv.order_index - 1} exam`;
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

// bd-2137 — vendor-aware display labels. Chain vendors (Taleemabad/NIETE)
// have a real ladder, so "Level N · Name" is meaningful. all_modules vendors'
// "levels" are SUBJECTS (Beacon House: English/Maths/…; Oxbridge: one
// program) — the ladder label reads as clutter and the order numbers leak
// global order_index values ("Level 2.English"). Missing unlock_logic
// defaults to chain, matching the lock-rule default everywhere else.
function isLadderVendor(lv) {
  return (lv.unlock_logic || 'chain') === 'chain';
}

// Display numbers are 0-BASED for ladder vendors — the NIETE app counts
// Level 0..3 and teachers cross-reference it constantly (bd-2235). Internal
// _level_order ids stay 1-based; only display strings changed.
function levelDisplayTitle(lv) {
  const base = isLadderVendor(lv)
    ? `Level ${lv.order_index} · ${shortLevelName(lv)}`
    : shortLevelName(lv);
  return `${levelEmoji(lv)} ${base}`;
}

function levelOptionTitle(lv) {
  const base = isLadderVendor(lv)
    ? `Level ${lv.order_index} · ${shortLevelName(lv)}`
    : shortLevelName(lv);
  return `${base} — ${ctaForLevel(lv)}`;
}

// Unused TRAINING_HOME slots. The published Flow renders 5 fixed
// heading/body pairs; the server marks ghosts invisible (the Flow's
// `visible` bindings hide them once the asset update ships) and keeps a
// neutral title so clients on the OLD flow version see a single dash line
// instead of the phantom "🔒 Level N — Not part of this program" category.
function ghostSlotData(slot) {
  return { title: '·', progress: '', visible: false };
}

function levelEmoji(lv) {
  if (lv.state === 'locked') return '🔒';
  if (lv.state === 'certified') return '🏆';
  if (lv.state === 'ready_for_quiz') return '📝';
  if (lv.state === 'in_progress') return '📖';
  return '📚'; // not_started
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
          ...(extras.moduleId ? { module_id: String(extras.moduleId) } : {}),
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
  // Pure helpers exported for unit tests (bd-2102, bd-2137).
  partitionByVendor,
  vendorSummaryLine,
  levelDisplayTitle,
  levelOptionTitle,
  ghostSlotData,
  levelProgressLine,
};
