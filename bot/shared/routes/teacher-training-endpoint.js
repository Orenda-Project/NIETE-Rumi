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

// bd-2474 — the two shapes a LEVEL EXAM takes. Chain vendors (NIETE) sit an
// MCQ 'grand_quiz'; all_modules vendors (Beacon House) sit a written,
// LLM-scored 'capstone'. Both certify a level, so both must be recognised
// wherever "does this level have an exam / did they pass it" is asked.
// 'diagnostic' rows live in the same table and are NOT an exam.
const EXAM_QUIZ_TYPES = ['grand_quiz', 'capstone'];
const EXAM_QUIZ_KINDS = ['grand', 'capstone'];
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
  if (!teacher) return entryErrorScreen('We could not find your training profile. Please contact NIETE support.');
  if (catalog.length === 0) {
    return entryErrorScreen(
      `No training assigned yet, ${teacher.first_name || 'teacher'}. ` +
      'Please contact your NIETE program lead to enrol you.'
    );
  }

  // BUG-144 — INIT must return a routing-model ENTRY POINT (a node with no
  // incoming edges). VENDOR_PICKER is the only one; TRAINING_HOME has an
  // incoming edge from it. The old single-vendor shortcut returned
  // TRAINING_HOME to save a tap and the client rejected the whole Flow with
  // "invalid-screen-transition ... already have incoming nodes". Always open
  // on the picker — single-vendor teachers see a one-row list and tap through.
  return buildVendorPicker(userId, teacher, partitionByVendor(catalog));
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
      // BUG-144 — the placeholder row emitted by entryErrorScreen. Nothing to
      // open; close cleanly instead of resolving it to an arbitrary vendor.
      if (vendorKey === 'none') return buildSuccessScreen('No training assigned yet.');
      return buildTrainingHome(userId, { vendorKey });
    }
    // bd-2665 — the certificate route. VENDOR_PICKER is the Flow's only entry
    // point (BUG-144), so this is the one link every teacher is guaranteed to
    // pass through.
    if (action === 'open_certificates') return buildMyCertificates(userId, await loadTeacher(userId));
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
    // bd-2665 — reachable from here too, so a teacher deep in a program does
    // not have to back out to the picker to get a certificate.
    if (action === 'open_certificates') return buildMyCertificates(userId, await loadTeacher(userId));
    if (action === 'close') return buildSuccessScreen('See you soon!');
    return createErrorResponse('Unknown action on training home');
  }

  // bd-2665 (sheet row R7) — the certificate screen.
  if (screen === 'MY_CERTIFICATES') {
    const action = screenData._action;
    if (action === 'send_certificate') {
      const code = String(screenData._certificate_code || '').trim();
      if (!code) return createErrorResponse('Missing certificate');

      const teacher = await loadTeacher(userId);
      const phoneNumber = teacher && teacher.phone_number;
      if (!phoneNumber) return errorScreen('I could not find your WhatsApp number on your profile.');

      // Delivery is the SAME fetch-or-mint path the typed command and the
      // portal use, so a certificate tapped here is byte-identical to one
      // downloaded in the browser — and a legacy certificate with no stored
      // PDF renders on first request rather than failing.
      //
      // It runs via setImmediate AFTER we return, because data_exchange has a
      // ~10s budget and the mint path is render → R2 upload → WhatsApp media
      // upload → send. Almost every certificate in production still needs that
      // mint, so the slow path is the COMMON path here, not the edge case.
      // Blocking on it would time the Flow out on exactly the certificates R7
      // exists to make reachable.
      setImmediate(async () => {
        // Hoisted above the try: the catch below also sends, and a binding
        // declared inside the try is not in scope there.
        const WhatsAppService = require('../services/whatsapp.service');
        try {
          const { deliverCertificateByCode } = require('../services/training/certificate-pdf.service');
          const result = await deliverCertificateByCode(supabase, {
            userId, phoneNumber, certificateCode: code,
          });
          if (result && result.ok) return;
          logToFile('❌ Certificate send from Flow failed', {
            userId, code, reason: result && result.reason,
          });
          // The Flow has already closed, so the only way to tell the teacher
          // is in the chat itself. Silence here is what reads as "it did
          // nothing" — the failure mode R7 is meant to end.
          await WhatsAppService.sendMessage(
            phoneNumber,
            result && result.reason === 'not_found'
              ? 'I could not find that certificate in your records.'
              : 'I could not prepare that certificate just now — please try again in a moment. It is safe in your records either way.'
          );
        } catch (err) {
          logToFile('❌ Certificate send from Flow threw', { userId, code, error: err.message });
          try {
            await WhatsAppService.sendMessage(
              phoneNumber,
              'Something went wrong preparing your certificate. Please try again in a moment.'
            );
          } catch (_) { /* the teacher is unreachable; the log above is the record */ }
        }
      });

      return buildSuccessScreen('On its way! Your certificate will arrive in this chat in a moment.');
    }
    // No route back to TRAINING_HOME: routing_model is forward-only, and
    // MY_CERTIFICATES sits after it. Closing cleanly is the sanctioned exit —
    // /training re-opens the Flow at the picker.
    if (action === 'close') return buildSuccessScreen('See you soon!');
    return createErrorResponse('Unknown action on certificates');
  }

  if (screen === 'LEVEL_DETAIL') {
    const action = screenData._action;
    const vendorKey = String(screenData._vendor_key || '').trim() || null;
    if (action === 'open_module') {
      // bd-2448 — the gate. Without this the dropdown was a free jump to any
      // module in the level, bypassing the sequential order the bot's own
      // deliverNextModule enforces.
      const gate = await checkModuleUnlocked(userId, screenData.module_id);
      if (!gate.ok) return errorScreen(gate.message);
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
      // bd-2452 — `if (!levelOrder)` was the wrong guard. If ${data.level_order}
      // ever failed to interpolate, the LITERAL string "${data.level_order}" is
      // truthy, so the fallback never fired and the literal sailed through to
      // parseInt -> NaN. Only an actual number may be trusted; anything else
      // falls through to inference.
      const rawOrder = String(screenData._level_order ?? '').trim();
      let levelOrder = /^\d+$/.test(rawOrder) ? parseInt(rawOrder, 10) : null;
      if (levelOrder === null) {
        const catalog = await loadVisibleLevelsWithProgress(userId);
        const scoped = vendorKey
          ? (catalog || []).filter(l => l.vendor_key === vendorKey)
          : (catalog || []);
        const readyLevels = scoped.filter(l => l.state === 'ready_for_quiz');
        if (readyLevels.length === 1) {
          levelOrder = readyLevels[0].order_index + 1;
          logToFile('🎓 Inferred levelOrder from ready state', { userId, vendorKey, levelOrder });
        } else if (scoped.length === 1) {
          // No level is ready, but the scope is unambiguous — resolve to it so
          // assertCanStartGrandQuiz can explain WHY rather than dead-ending on
          // "open the level again", which just loops the teacher.
          levelOrder = scoped[0].order_index + 1;
        } else {
          logToFile('❌ Cannot infer levelOrder for start_grand_quiz', {
            userId, vendorKey, rawOrder, readyCount: readyLevels.length, scopedCount: scoped.length,
          });
          return errorScreen('Please open the level again and tap Take exam.');
        }
      }
      // bd-2452 — THE GATE. The "🔒 Locked" / "✓ Passed" / blank CTA are all
      // tappable links; this is what actually refuses them.
      const gate = await assertCanStartGrandQuiz(userId, levelOrder, vendorKey);
      if (!gate.ok) {
        logToFile('🎓 Refused grand-quiz start', { userId, levelOrder, reason: gate.reason });
        return errorScreen(gate.message);
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
  if (!teacher) return entryErrorScreen('We could not find your training profile. Please contact NIETE support.');
  // BUG-144 — same entry-point rule as INIT; always land on the picker.
  return buildVendorPicker(userId, teacher, partitionByVendor(catalog));
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
    // bd-2665 — see buildTrainingHome. Derived from the vendor groups already
    // partitioned here, so no extra query.
    certificates_visible: vendors.some(v => (v.summary && v.summary.levels_certified > 0)),
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
    // bd-2665 — offer the certificate link only when there is something behind
    // it. Derived from the catalog already in hand (state === 'certified'),
    // across ALL vendors rather than the chosen one: a teacher certified with
    // one partner should still reach it while browsing another. Costs no
    // extra query.
    certificates_visible: catalog.some(l => l.state === 'certified'),
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
      // bd-2448 — the description carries the lock state. It is advisory: the
      // published item schema has no `enabled` field, so the row stays
      // tappable and checkModuleUnlocked does the actual refusing.
      // "Passed" replaces the old "✓ Watched", which read as "you opened the
      // video" when since bd-2390 it means the quick check was passed.
      module_list:    modules.map(m => ({
        id:          String(m.id),
        title:       m.title.length > 40 ? `${m.title.slice(0, 37)}…` : m.title,
        description: `${m.course_title} · ${moduleLockLabel(m)}`,
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
  return annotateModuleLocks(levelModules.map(m => ({
    id: m.id,
    title: m.title,
    course_title: courseById.get(m.course_id).title,
    done: doneIds.has(m.id),
  })));
}

/**
 * bd-2448 — mark each module in level order as passed / next / locked.
 *
 * The bot's delivery path has always been sequential (deliverNextModule takes
 * the lowest order_index module without a progress row), but the Flow's module
 * dropdown drove around it: every module was listed and `open_module` handed
 * the id straight to deliverModuleById. A teacher could open the last module
 * of the last course on day one.
 *
 * The rule — already-passed modules stay open for review, exactly one unpassed
 * module ("next up") is open, everything after it is locked — lives HERE and
 * nowhere else. Both the picker that renders the list and the gate that
 * refuses the tap call this one function; two copies of "which module is next"
 * is exactly how a label and its handler drift apart (bd-2446).
 *
 * @param {Array<{id:number,title:string,course_title:string,done:boolean}>} orderedModules
 *        modules in level order (course order_index, then module order_index)
 * @returns {Array<object>} the same rows, each with `lock`: 'passed'|'next'|'locked'
 */
function annotateModuleLocks(orderedModules) {
  let nextTaken = false;
  return orderedModules.map(m => {
    if (m.done) return { ...m, lock: 'passed' };
    if (!nextTaken) {
      nextTaken = true;
      return { ...m, lock: 'next' };
    }
    return { ...m, lock: 'locked' };
  });
}

/**
 * bd-2448 — may this teacher open this module right now?
 *
 * The gate, not the label. The published Flow's module_list item schema is
 * {id, title, description} with no `enabled` field, and per
 * .claude/skills/whatsapp-flows a published Flow's JSON cannot be edited in
 * place — so a locked row is still tappable on the client and the server has
 * to be the thing that says no.
 *
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function checkModuleUnlocked(userId, moduleId) {
  const moduleIdNum = parseInt(String(moduleId), 10);
  if (!Number.isFinite(moduleIdNum)) return { ok: false, message: 'That module could not be found.' };

  const { data: mod } = await supabase
    .from('training_modules').select('id, course_id').eq('id', moduleIdNum).maybeSingle();
  if (!mod?.course_id) {
    logToFile('⚠️ open_module for an unknown module', { userId, moduleId });
    return { ok: false, message: 'That module is not part of your training.' };
  }
  const { data: course } = await supabase
    .from('training_courses').select('id, level_id').eq('id', mod.course_id).maybeSingle();
  if (!course?.level_id) return { ok: false, message: 'That module is not part of your training.' };

  const modules = await loadModulesWithProgress(userId, course.level_id);
  const target = modules.find(m => m.id === moduleIdNum);
  if (!target) return { ok: false, message: 'That module is not part of your training.' };
  if (target.lock !== 'locked') return { ok: true };

  const nextUp = modules.find(m => m.lock === 'next');
  logToFile('🎓 Refused a locked module', {
    userId, moduleId: moduleIdNum, nextUp: nextUp?.id || null,
  });
  return {
    ok: false,
    message: nextUp
      ? `Finish "${nextUp.title}" first — modules open one at a time.`
      : 'That module is locked until you finish the ones before it.',
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
/**
 * bd-2391 — does this attempt row represent a passed LEVEL EXAM?
 *
 * `training_assessment_attempts` stores both the per-module quick check
 * (quiz_kind='training_module') and the level exam (quiz_kind='grand'), and
 * BOTH carry level_id. Only the latter may certify a level or satisfy a
 * chain-lock. Rows with a missing quiz_kind are treated as grand: they predate
 * the column, when the table held level exams only.
 *
 * @param {object} a attempt row (needs is_passed, quiz_kind)
 * @returns {boolean}
 */
function isGrandPass(a) {
  if (!a || a.is_passed !== true) return false;
  // bd-2474 — a capstone IS the level exam for all_modules vendors. Rows with
  // no quiz_kind predate the column, when the table held level exams only.
  return EXAM_QUIZ_KINDS.includes(a.quiz_kind || 'grand');
}

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
  const [{ data: courses }, { data: progressRows }, { data: attempts }, { data: quizzes }, { data: certRows }] = await Promise.all([
    supabase.from('training_courses').select('id, level_id, is_active').in('level_id', levelIds),
    supabase.from('teacher_training_progress').select('module_id').eq('user_id', userId),
    // bd-2391 — LEVEL-EXAM attempts only. Per-module quick-check attempts also
    // carry a level_id and set is_passed=true on a perfect score, so an
    // unfiltered read makes one 9-question module quiz certify the whole level
    // (hiding the real exam behind a "Review" CTA and chain-unlocking the next
    // level).
    //
    // bd-2485 — but "level exam" is BOTH kinds. This filtered on 'grand' alone,
    // which bd-2474 missed when it widened isGrandPass and EXAM_QUIZ_TYPES: the
    // in-memory guard accepted a capstone the query had already thrown away. A
    // capstone pass never set state='certified', so the level stayed
    // re-sittable (a second pass mints a duplicate certificate — issueCertificate
    // dedupes per attempt_id, not per level) and a chain vendor's next level
    // stayed locked. `quiz_kind` is selected because isGrandPass discriminates
    // on it; widening the filter without it leaves the guard blind.
    supabase.from('training_assessment_attempts').select('level_id, status, is_passed, cooldown_until, completed_at, quiz_kind').eq('user_id', userId).in('quiz_kind', EXAM_QUIZ_KINDS).in('level_id', levelIds),
    supabase.from('training_grand_quizzes').select('id, level_id, quiz_type').in('level_id', levelIds).in('quiz_type', EXAM_QUIZ_TYPES).eq('is_active', true),
    // bd-2503 — some levels have NO exam at all (Oxbridge). For an all_modules
    // vendor with no capstone, maybeIssueQuizScoreCertificate certifies the
    // level off completed modules alone, so the certificate row is the ONLY
    // record that the teacher finished. Without reading it, a 7/7 level sat in
    // 'ready_for_quiz' forever, waiting for an exam that does not exist.
    supabase.from('training_certificates').select('level_id').eq('user_id', userId).in('level_id', levelIds),
  ]);
  const certifiedLevelIds = new Set((certRows || []).map(c => c.level_id));

  // bd-2447 — a course is complete when EVERY active module under it is done.
  //
  // This used to be a phase-1 proxy: "complete" meant ≥1 module had a progress
  // row, and that count shipped out as `courses_completed`. One module done in
  // each of five courses rendered "5/5 courses ✓ · Ready for exam" off five
  // modules out of sixty, and offered the level exam to a teacher who had
  // barely started. The proxy's own note said it stood in "until the
  // module-completion path is wired" — bd-2390 wired it. A
  // teacher_training_progress row now means the module's quick check was
  // PASSED (or the module had no quiz), so "all modules have rows" is exactly
  // "all modules passed".
  const activeCourseIds = (courses || []).filter(c => c.is_active).map(c => c.id);
  const { data: levelModules } = activeCourseIds.length
    ? await supabase
      .from('training_modules')
      .select('id, course_id')
      .in('course_id', activeCourseIds)
      .eq('is_active', true)
    : { data: [] };
  const modulesByCourse = new Map();
  for (const m of levelModules || []) {
    if (!modulesByCourse.has(m.course_id)) modulesByCourse.set(m.course_id, []);
    modulesByCourse.get(m.course_id).push(m.id);
  }
  const doneModuleIds = new Set((progressRows || []).map(p => p.module_id));

  return visibleLevels.map(lv => {
    // A course with no active modules is excluded from the denominator
    // entirely: counting it as incomplete would strand the level forever,
    // counting it as complete would hand out a free pass to the exam.
    const lvCourses = (courses || []).filter(c =>
      c.level_id === lv.id && c.is_active && (modulesByCourse.get(c.id) || []).length > 0);
    const lvModuleIds = lvCourses.flatMap(c => modulesByCourse.get(c.id) || []);
    const coursesCompleted = lvCourses.filter(c =>
      (modulesByCourse.get(c.id) || []).every(id => doneModuleIds.has(id)));
    // "Touched" only decides in_progress vs not_started — it must never gate
    // the exam. Keeping it separate from coursesCompleted is what stops the
    // two meanings collapsing back into one number.
    const coursesTouched = lvCourses.filter(c =>
      (modulesByCourse.get(c.id) || []).some(id => doneModuleIds.has(id)));
    // bd-2391 — `isGrandPass` also guards in memory, not just in the query, so
    // the "only a level exam certifies a level" rule survives a caller that
    // hands us unfiltered rows.
    const passedAttempt = (attempts || []).find(a => a.level_id === lv.id && isGrandPass(a));
    const cooldownAttempt = (attempts || []).find(a => a.level_id === lv.id && a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date());
    const vendor = vendorById.get(lv.vendor_id);
    const chainLocked = vendor?.unlock_logic === 'chain';
    const prevLevel = visibleLevels
      .filter(l => l.vendor_id === lv.vendor_id)
      .find(l => l.order_index === lv.order_index - 1);
    const prevPassed = !prevLevel || !!(attempts || []).find(a => a.level_id === prevLevel.id && isGrandPass(a));
    const isFirst = !prevLevel;
    const grand = (quizzes || []).find(q => q.level_id === lv.id) || null;

    let state;
    if (chainLocked && !prevPassed && !isFirst) state = 'locked';
    // bd-2503 — a held certificate is terminal whether it came from passing an
    // exam or from completing every module of an exam-less level.
    else if (passedAttempt || certifiedLevelIds.has(lv.id)) state = 'certified';
    else if (coursesCompleted.length === lvCourses.length && lvCourses.length > 0) state = 'ready_for_quiz';
    else if (coursesTouched.length > 0) state = 'in_progress';
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
      courses_completed: coursesCompleted.length,
      // Module-based, so a teacher part-way through every course still sees
      // movement ("0/5 courses · 25% done") instead of a flat 0%.
      pct_complete: lvModuleIds.length === 0
        ? 0
        : Math.round((lvModuleIds.filter(id => doneModuleIds.has(id)).length / lvModuleIds.length) * 100),
      passed_at: passedAttempt?.completed_at || null,
      cooldown_until: cooldownAttempt?.cooldown_until || null,
      // bd-2479 — which level a teacher must clear to open this one, in the
      // 0-based display numbering ladder vendors use (bd-2235). Emitted here so
      // the portal renders the same number the Flow does instead of deriving
      // its own; a second copy of this arithmetic is how the two surfaces
      // started disagreeing about lock state. Null when nothing precedes it.
      previous_level_order: isFirst ? null : lv.order_index - 1,
      grand_quiz_id: grand?.id || null,
    };
  });
}

/**
 * bd-2452/2453 — the ONE precondition check for starting a level exam.
 *
 * Every "locked" state in this Flow used to live only in the CTA text. A
 * WhatsApp Flow `EmbeddedLink` has no disabled state and the published item
 * schema can't add one, so "🔒 Locked" was always tappable — and the
 * start_grand_quiz branch had no check at all. Reproduced live: a level at
 * 38/40 modules rendered "🔒 Locked", the teacher tapped it, and the exam
 * started and recorded an answer.
 *
 * The rule this encodes: the label is advisory, the handler is the gate.
 *
 * Reasons are derived from the SAME level state the UI renders
 * (loadVisibleLevelsWithProgress), so the refusal can never disagree with the
 * badge the teacher is looking at.
 *
 * @param {string} userId
 * @param {number} levelOrder 1-based level order as sent by the Flow
 * @param {string|null} vendorKey scope, when known
 * @returns {Promise<{ok: boolean, level?: object, reason?: string, message?: string}>}
 */
async function assertCanStartGrandQuiz(userId, levelOrder, vendorKey = null) {
  const idx = (typeof levelOrder === 'number' ? levelOrder : parseInt(levelOrder, 10)) - 1;
  if (!Number.isFinite(idx) || idx < 0) {
    return { ok: false, reason: 'bad_level', message: 'Please open the level again and tap Take exam.' };
  }
  const catalog = await loadVisibleLevelsWithProgress(userId);
  const scoped = vendorKey ? (catalog || []).filter(l => l.vendor_key === vendorKey) : (catalog || []);
  const candidates = scoped.filter(l => l.order_index === idx);
  // bd-2392 — order_index is per-vendor and therefore not unique. Prefer a
  // level the teacher is actually ready to sit, then one that has an exam.
  const level =
    candidates.find(l => l.state === 'ready_for_quiz' && l.grand_quiz_id) ||
    candidates.find(l => l.grand_quiz_id) ||
    candidates[0] || null;

  if (!level) {
    return { ok: false, reason: 'not_in_program', message: 'That level is not part of your program.' };
  }
  if (level.state === 'locked') {
    return {
      ok: false, reason: 'level_locked', level,
      // Display numbers are 0-based for ladder vendors (bd-2235), so the
      // previous level reads as order_index - 1.
      message: `You need to pass Level ${level.order_index - 1}'s exam before this level opens.`,
    };
  }
  if (!level.grand_quiz_id) {
    return {
      ok: false, reason: 'no_exam', level,
      message: 'There is no level exam set up for this level yet. Please contact NIETE support.',
    };
  }
  // bd-2453 — a pass closes the exam for good. Re-sitting created a second
  // attempt, and issueCertificate dedupes per attempt_id (not per level), so
  // re-passing minted a duplicate certificate for an already-certified level.
  if (level.state === 'certified') {
    return {
      ok: false, reason: 'already_passed', level,
      message: 'You have already passed this level exam — your certificate is in your records.',
    };
  }
  if (level.cooldown_until && new Date(level.cooldown_until) > new Date()) {
    const hours = Math.max(1, Math.round((new Date(level.cooldown_until) - Date.now()) / 3_600_000));
    return {
      ok: false, reason: 'cooldown', level,
      message: `You attempted this exam recently. Please try again in about ${hours} hours.`,
    };
  }
  if (level.state !== 'ready_for_quiz') {
    return {
      ok: false, reason: 'incomplete', level,
      message: `Finish every module in this level first — the exam unlocks once all ${level.courses_total} courses are complete.`,
    };
  }
  return { ok: true, level };
}

/**
 * bd-2479 — may this teacher open this level's contents right now?
 *
 * The level-scoped sibling of checkModuleUnlocked. The Flow asks this
 * implicitly at line ~353 when a locked level is opened; the portal asks it
 * explicitly before serving courses, modules, questions or quiz submissions.
 * Both must get the same answer, so the rule lives here once.
 *
 * Derived from loadVisibleLevelsWithProgress — the same state the UI renders —
 * so a refusal can never disagree with the badge the teacher is looking at.
 *
 * The message and the number are the Flow's, deliberately: display order is
 * 0-based for ladder vendors (bd-2235), so the previous level reads as
 * `order_index - 1`. Inventing a second phrasing here is how the portal ended
 * up with a copy that drifted in the first place.
 *
 * @param {string} userId
 * @param {number|string} levelId
 * @returns {Promise<{ok: boolean, status?: number, level?: object,
 *                    message?: string, previous_level_order?: number}>}
 */
async function checkLevelUnlocked(userId, levelId) {
  const idNum = parseInt(String(levelId), 10);
  if (!Number.isFinite(idNum)) return { ok: false, status: 404, message: 'Level not found' };

  const catalog = await loadVisibleLevelsWithProgress(userId);
  const level = (catalog || []).find(l => l.id === idNum);
  // Not in the catalogue means not in this teacher's programme — same answer
  // as "does not exist", and deliberately not distinguished for the caller.
  if (!level) return { ok: false, status: 404, message: 'Level not found' };
  if (level.state !== 'locked') return { ok: true, level };

  // Read the number off the level state rather than recomputing it — one
  // definition, so the refusal can never cite a different level than the card.
  const previousOrder = level.previous_level_order;
  logToFile('🎓 Refused a locked level', { userId, levelId: idNum, previousOrder });
  return {
    ok: false,
    status: 403,
    level,
    message: `Pass Level ${previousOrder}'s grand quiz first to unlock this level.`,
    previous_level_order: previousOrder,
  };
}

/**
 * bd-2483 — the exam gate, addressed by level ID.
 *
 * assertCanStartGrandQuiz takes a 1-based level ORDER plus a vendor key,
 * because that is what the Flow has in hand. The portal has a level id. This
 * resolves one to the other and delegates; it adds no rule of its own, so the
 * two surfaces cannot answer "may I sit this exam?" differently.
 *
 * @returns {Promise<{ok: boolean, level?: object, reason?: string, message?: string}>}
 */
async function assertCanStartExamForLevel(userId, levelId) {
  const idNum = parseInt(String(levelId), 10);
  if (!Number.isFinite(idNum)) {
    return { ok: false, reason: 'bad_level', message: 'Please open the level again and tap Take exam.' };
  }
  const catalog = await loadVisibleLevelsWithProgress(userId);
  const level = (catalog || []).find(l => l.id === idNum);
  if (!level) {
    return { ok: false, reason: 'not_in_program', message: 'That level is not part of your program.' };
  }
  // order_index is 0-based in the catalogue; assertCanStartGrandQuiz expects
  // the Flow's 1-based order. Scoping by vendor_key keeps the lookup correct
  // when two vendors share an order_index (bd-2392).
  return assertCanStartGrandQuiz(userId, level.order_index + 1, level.vendor_key);
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
  const [{ data: catalog }, { data: attempts }, { data: courses }, { data: modules }, { data: progressRows }, { data: levelCert }] = await Promise.all([
    // bd-2474 — resolve the level's exam by LEVEL, not by type. Beacon House
    // levels carry quiz_type='capstone'; filtering to 'grand_quiz' meant every
    // BH level reported "No level exam" even though capstones 29-32 are active.
    // 'diagnostic' rows are NOT an exam and stay excluded.
    supabase.from('training_grand_quizzes').select('id, quiz_type').eq('level_id', levelId).in('quiz_type', EXAM_QUIZ_TYPES).eq('is_active', true).maybeSingle(),
    // bd-2391 — EXAM attempts only (see isGrandPass). Without this a passed
    // module quick check rendered "🏆 You passed this level exam" and replaced
    // the CTA with "✓ Passed". bd-2474 widens 'grand' to both exam kinds so a
    // passed capstone is recognised the same way.
    supabase.from('training_assessment_attempts').select('status, is_passed, cooldown_until, quiz_kind').eq('user_id', userId).in('quiz_kind', EXAM_QUIZ_KINDS).eq('level_id', levelId),
    supabase.from('training_courses').select('id').eq('level_id', levelId).eq('is_active', true),
    supabase.from('training_modules').select('id, course_id').eq('is_active', true),
    supabase.from('teacher_training_progress').select('module_id').eq('user_id', userId),
    // bd-2503 — the same signal loadVisibleLevelsWithProgress reads. Both
    // surfaces must agree on what "complete" means, or HOME and LEVEL_DETAIL
    // contradict each other again — which is the bug being fixed.
    supabase.from('training_certificates').select('id').eq('user_id', userId).eq('level_id', levelId).maybeSingle(),
  ]);
  const passed = (attempts || []).some(isGrandPass);
  const cooldown = (attempts || []).find(a => a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date());
  const doneIds = new Set((progressRows || []).map(r => r.module_id));
  const courseIds = new Set((courses || []).map(c => c.id));
  // Match the "ready_for_quiz" criterion in loadVisibleLevelsWithProgress —
  // bd-2447 tightened both together, from "every course has ≥1 module done" to
  // "every module in the level is done". Keeping these two checks aligned is
  // what prevents the "HOME says ready, LEVEL_DETAIL says locked" mismatch, so
  // they must never be changed apart. tests/training/
  // level-ready-requires-all-modules.test.js asserts the alignment directly.
  const levelModules = (modules || []).filter(m => courseIds.has(m.course_id));
  // Courses with no active modules are excluded on both sides; a level whose
  // courses are all empty is not "done", it is unbuilt.
  const coursesWithModules = new Set(levelModules.map(m => m.course_id));
  const allDone = coursesWithModules.size > 0 && levelModules.every(m => doneIds.has(m.id));

  // bd-2503 — the no-exam level. Moved BELOW allDone so the copy can tell the
  // truth: a teacher at 100% was being told to "finish all sessions" directly
  // under a line reading "7/7 modules done · 100%".
  if (!catalog) {
    // Only promise a certificate when one actually exists. A level can be
    // finished without being certified — maybeIssueQuizScoreCertificate skips
    // vendors on the chain ladder — and telling a teacher to look for a
    // certificate that was never issued is worse than saying nothing.
    if (levelCert) {
      return { badge: 'badge_quiz_passed', body: '🏆 Level complete — you have finished every session.', caption: 'Certificate available in your records.', cta: '✓ Complete' };
    }
    if (allDone) {
      return { badge: 'badge_quiz_passed', body: '🏆 Level complete — you have finished every session.', caption: ' ', cta: '✓ Complete' };
    }
    return { badge: 'badge_quiz_available', body: '🎓 No level exam — finish all sessions to complete this level.', caption: ' ', cta: ' ' };
  }

  if (passed) return { badge: 'badge_quiz_passed', body: '🏆 Grand Quiz — You passed this level exam.', caption: 'Certificate available in your records.', cta: '✓ Passed' };
  if (cooldown) {
    const hoursLeft = Math.max(1, Math.round((new Date(cooldown.cooldown_until) - Date.now()) / 3_600_000));
    return { badge: 'badge_quiz_cooldown', body: '⏳ Grand Quiz — Locked after a recent failed attempt.', caption: `Try again in about ${hoursLeft} hours.`, cta: `⏳ Cooldown (${hoursLeft}h)` };
  }
  // bd-2393 — the pass bar is per-vendor (NIETE 80%, Beacon House 70%), and the
  // question count is per-quiz. Both were hardcoded ("62 questions · 100%
  // required"), which was wrong on every level.
  const [{ count: bankCount }, { data: lvRow }] = await Promise.all([
    supabase.from('training_questions').select('id', { count: 'exact', head: true })
      .eq('grand_quiz_id', catalog.id).eq('is_active', true),
    supabase.from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle(),
  ]);
  let passPct = 100;
  let examCap = null;
  if (lvRow?.vendor_id) {
    const { data: vendor } = await supabase
      .from('training_vendors').select('passing_pct, exam_question_cap').eq('id', lvRow.vendor_id).maybeSingle();
    const p = Number(vendor?.passing_pct);
    if (Number.isFinite(p) && p > 0 && p <= 100) passPct = p;
    const cap = Number(vendor?.exam_question_cap);
    if (Number.isFinite(cap) && cap > 0) examCap = cap;
  }

  // bd-2499 — advertise the paper the teacher will actually sit.
  //
  // bd-2495 capped NIETE exams at `exam_question_cap` randomly-sampled
  // questions, but this caption still counted the whole bank: Skilled
  // Practitioner offered "72 questions" and then served 20. The count is what
  // a teacher plans their evening around, so it has to be the served one.
  const servedCount = examCap ? Math.min(bankCount || 0, examCap) : (bankCount || 0);
  const qPart = servedCount ? `${servedCount} questions · ` : '';

  // bd-2475 — capstones have no cooldown. capstone-delivery never writes
  // cooldown_until, so claiming one here was simply false; the clause is
  // dropped rather than shown as "0h".
  const coolPart = catalog.quiz_type === 'capstone' ? '' : ' · 24h cooldown on fail';

  if (!allDone) return { badge: 'badge_quiz_locked', body: '🔒 Grand Quiz — Unlocks when all courses are complete.', caption: `${qPart}${passPct}% required${coolPart}`, cta: '🔒 Locked' };
  return { badge: 'badge_quiz_available', body: '📝 Grand Quiz — Ready. Start your level exam.', caption: `${qPart}${passPct}% to pass${coolPart}`, cta: 'Start exam' };
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
// BUG-144 — `progress` must be a SPACE, never ''. WhatsApp validates the whole
// data payload against the screen schema BEFORE applying `visible`, so an empty
// string bound to a TextBody fails the render and the client shows "Something
// went wrong" — even though the row is hidden. Same rule loadGrandQuizState
// already follows with its `caption: ' '` / `cta: ' '` no-quiz case.
function ghostSlotData(slot) {
  return { title: '·', progress: ' ', visible: false };
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

// bd-2448 — the teacher-facing name for each lock state.
function moduleLockLabel(m) {
  if (m.lock === 'passed') return '✓ Passed';
  if (m.lock === 'next') return '▶ Next up';
  return '🔒 Locked';
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

// ─── Certificates (bd-2665 / sheet row R7) ────────────────────────────────

/**
 * The label a teacher reads on a certificate row.
 *
 * Falls back to the certificate code when the level name snapshot is missing —
 * legacy imports do not all carry one, and "Level undefined · undefined" is
 * worse than a bare code the teacher can at least match against their records.
 */
function certificateOptionTitle(cert) {
  if (!cert) return '';
  const name = cert.level_name_snapshot;
  if (!name) return cert.certificate_code || '';
  const order = cert.training_levels && typeof cert.training_levels.order_index === 'number'
    ? cert.training_levels.order_index
    : null;
  return order === null ? name : `Level ${order + 1} · ${name}`;
}

/** Issue date + the code, on ONE line — Flow row descriptions do not wrap. */
function certificateOptionDescription(cert) {
  if (!cert) return '';
  const parts = [];
  if (cert.issued_at) {
    const d = new Date(cert.issued_at);
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Passed ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    }
  }
  if (cert.certificate_code) parts.push(cert.certificate_code);
  return parts.join(' · ').replace(/\s*\n\s*/g, ' ');
}

/**
 * Load every certificate this teacher has earned, newest level last.
 *
 * Deliberately does NOT filter on pdf_r2_key: the overwhelming majority of
 * production certificates have no stored PDF, and the whole point of R7 is
 * that those are reachable by tapping. Minting happens after the tap, on the
 * same fetch-or-mint path the portal uses.
 */
async function loadCertificates(userId) {
  const { data } = await supabase
    .from('training_certificates')
    .select('certificate_code, teacher_name_snapshot, level_name_snapshot, issued_at, level_id, pdf_r2_key, training_levels(order_index)')
    .eq('user_id', userId)
    .order('level_id', { ascending: true });
  return data || [];
}

/**
 * Build MY_CERTIFICATES. Returns an error screen when the teacher has none —
 * a RadioButtonsGroup is `required: true`, and an empty data-source is itself
 * a payload-validation failure (the same trap entryErrorScreen documents).
 */
async function buildMyCertificates(userId, teacher) {
  const certs = await loadCertificates(userId);
  if (certs.length === 0) {
    return errorScreen(
      "You haven't earned a certificate yet. Finish a level's courses and pass its exam, and I'll send you one here."
    );
  }
  const name = (certs[0] && certs[0].teacher_name_snapshot)
    || (teacher && teacher.first_name)
    || 'Teacher';
  logToFile('🏆 MY_CERTIFICATES response snapshot', { userId, count: certs.length });
  return {
    screen: 'MY_CERTIFICATES',
    data: {
      hero_title:    'Your certificates',
      hero_subtitle: name,
      hero_caption:  'Pick one and I will send you the PDF here in chat.',
      certificate_options: certs.map(c => ({
        id:          c.certificate_code,
        title:       certificateOptionTitle(c),
        description: certificateOptionDescription(c),
      })),
    },
  };
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
    data: {
      message,
      extension_message_response: {
        params: {
          training_action: 'error',
          // bd-2451 — carry the reason out with the Flow closure. SUCCESS is a
          // terminal screen, so a refusal ends the Flow; without this the bot's
          // handler had nothing to say and returned silently, which is what a
          // teacher experiences as "it just never replied to me".
          error_message: String(message || ''),
        },
      },
    },
  };
}

/**
 * BUG-144 — an error shown as the FIRST screen (from INIT or a raw BACK).
 *
 * errorScreen() renders on SUCCESS, which has incoming edges from all three
 * other screens, so it is not a legal entry point: returning it from INIT
 * fails with "invalid-screen-transition" and the teacher sees "Something went
 * wrong" instead of the message. VENDOR_PICKER is the only entry node, so
 * first-screen errors render there with the reason in the caption. Mid-Flow
 * errors keep using errorScreen().
 *
 * vendor_options carries ONE placeholder row rather than []: the
 * RadioButtonsGroup is `required: true`, and an empty data-source is itself a
 * payload-validation failure — which would just swap this bug for another.
 */
function entryErrorScreen(message) {
  return {
    screen: 'VENDOR_PICKER',
    data: {
      hero_title:    'Teacher Training',
      hero_subtitle: ' ',
      hero_caption:  message,
      vendor_options: [{ id: 'none', title: 'No programs available', description: message }],
      // bd-2665 — this screen renders when we could not load the catalog at
      // all, so we cannot know whether certificates exist. Hide the link
      // rather than offer a second dead end on top of the first.
      certificates_visible: false,
    },
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
  // bd-2391 — level-state computation, exported so the "a module quiz must not
  // certify the level" contract can be asserted directly.
  loadVisibleLevelsWithProgress,
  loadGrandQuizState,
  // bd-2448 — the module sequencing rule. annotateModuleLocks is pure; export
  // it so the "exactly one unpassed module is open" contract can be asserted
  // without a DB fixture.
  annotateModuleLocks,
  checkModuleUnlocked,
  // bd-2479 — the level-scoped gate, exported so the portal can ask the bot
  // instead of keeping its own copy (which had already drifted).
  checkLevelUnlocked,
  // bd-2452/2453 — the single precondition check for starting a level exam,
  // shared by the Flow branch and quiz-delivery.startGrandQuiz.
  assertCanStartGrandQuiz,
  // bd-2483 — the same gate, addressed by level id (what the portal has).
  assertCanStartExamForLevel,
  // bd-2665 — certificate row formatting, exported so the tappable-route
  // contract can be asserted without a DB fixture.
  certificateOptionTitle,
  certificateOptionDescription,
};
