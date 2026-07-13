/**
 * Teacher Training — Content Delivery Service
 *
 * Given a teacher + course, find the next unfinished module and deliver it
 * to WhatsApp: video from R2, caption with module title/progress, and a
 * "✓ Done" button that marks the module complete on tap and auto-delivers
 * the next one.
 *
 * State lives in `teacher_training_progress` (user_id, module_id, completed_at).
 * Position within a course is derived — always the lowest order_index module
 * without a progress row — so there's no separate "current position" state
 * to keep in sync.
 */
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { getPresignedUrl } = require('../../storage/r2');
const { logToFile } = require('../../utils/logger');

/**
 * Find the next uncompleted module for a teacher in a course.
 * Returns null if the course is fully done.
 */
async function findNextModule(userId, courseId) {
  const { data: modules, error: mErr } = await supabase
    .from('training_modules')
    .select('id, course_id, title, video_url, audio_url, order_index')
    .eq('course_id', courseId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  if (mErr || !modules || modules.length === 0) return null;

  const { data: progress } = await supabase
    .from('teacher_training_progress')
    .select('module_id')
    .eq('user_id', userId)
    .in('module_id', modules.map(m => m.id));
  const doneIds = new Set((progress || []).map(p => p.module_id));

  const totalCount = modules.length;
  const nextModule = modules.find(m => !doneIds.has(m.id));
  return nextModule ? {
    module: nextModule,
    completedCount: doneIds.size,
    totalCount,
    positionLabel: `${doneIds.size + 1} of ${totalCount}`,
  } : { module: null, completedCount: doneIds.size, totalCount, positionLabel: `${totalCount} of ${totalCount}` };
}

/**
 * Deliver the next uncompleted module to the teacher, or a completion
 * message if the course is done.
 *
 * @param {string} userId - Supabase user UUID
 * @param {number|string} courseId - training_courses.id (int)
 * @param {string} phoneNumber - Teacher's WhatsApp number
 */
async function deliverNextModule(userId, courseId, phoneNumber) {
  const courseIdNum = parseInt(courseId, 10);
  if (!courseIdNum) {
    logToFile('⚠️ Invalid courseId in deliverNextModule', { userId, courseId });
    return false;
  }

  const { data: course } = await supabase
    .from('training_courses')
    .select('id, title')
    .eq('id', courseIdNum)
    .single();
  const courseTitle = course?.title || `Course #${courseIdNum}`;

  const state = await findNextModule(userId, courseIdNum);
  if (!state) {
    await WhatsAppService.sendMessage(phoneNumber, `${courseTitle} has no active modules yet — please check back soon.`);
    return true;
  }

  // "Review mode": if every module in this course is already done (which is
  // the case for any course inside a certified level after the pass-based
  // progress backfill), deliver the FIRST module of the course as a
  // re-watch instead of the "you're done" text — that's what teachers
  // actually want when they open a completed course.
  let m;
  let reviewMode = false;
  let positionLabel;
  if (!state.module) {
    const { data: firstMod } = await supabase
      .from('training_modules')
      .select('id, course_id, title, video_url, audio_url, order_index')
      .eq('course_id', courseIdNum)
      .eq('is_active', true)
      .order('order_index', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstMod) {
      await WhatsAppService.sendMessage(phoneNumber, `${courseTitle} has no active modules yet — please check back soon.`);
      return true;
    }
    m = firstMod;
    reviewMode = true;
    positionLabel = `Review · 1 of ${state.totalCount}`;
  } else {
    m = state.module;
    positionLabel = state.positionLabel;
  }

  const caption = reviewMode
    ? `📘 *${courseTitle}* — ${positionLabel}\n\n*${m.title}*\n\nYou've already completed this course. Watch again to review, then tap ▶ Next video for the next module.`
    : `📘 *${courseTitle}* — Module ${positionLabel}\n\n*${m.title}*\n\nWatch the video, then tap ✓ Done to mark it complete and get the next module.`;

  logToFile('🎓 Delivering training module', { userId, courseId: courseIdNum, moduleId: m.id, moduleTitle: m.title, videoUrl: m.video_url });

  // Send the video as a plain-text presigned link. The training corpus has
  // files up to 611 MB (median 100 MB); both video-type (16 MB) and document-
  // type (100 MB) WhatsApp media caps reject them with async error 131053.
  // A text-mode URL bypasses the API media pipeline — WhatsApp's client
  // renders its own link preview and opens the file in the in-app viewer.
  if (m.video_url) {
    try {
      const signed = await getPresignedUrl(m.video_url, 3600); // 1h TTL is plenty
      logToFile('🎓 Sending training video as link', { moduleId: m.id, urlPrefix: signed.slice(0, 80) });
      await WhatsAppService.sendMessage(phoneNumber, `${caption}\n\n▶️ ${signed}`);
    } catch (err) {
      logToFile('⚠️ Presign failed', { moduleId: m.id, error: err.message });
      await WhatsAppService.sendMessage(phoneNumber, caption + `\n\n(Video could not be delivered — please contact NIETE support.)`);
    }
  } else {
    logToFile('⚠️ Module has no video_url — sending "no video available" text', { moduleId: m.id, courseId: courseIdNum });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `📘 *${courseTitle}* — ${positionLabel}\n\n*${m.title}*\n\nNo video is available for this module yet. Tap ▶ Next video to continue.`
    );
  }

  // Delay the "Next video" button so it lands AFTER the video finishes
  // fetching + delivering (link-mode is async — Meta acknowledges our API
  // call in ~200ms but fetches from R2 asynchronously for another 3-6s).
  // Without this delay the button appears above the video in the chat.
  await new Promise(resolve => setTimeout(resolve, 1000));

  await WhatsAppService.sendInteractiveButtons(phoneNumber, {
    body: `Finished watching "${m.title}"?`,
    buttons: [
      { id: `training_module_done_${m.id}`, title: '▶ Next video' },
      { id: `training_pause`, title: '⏸ Pause' },
    ],
  });
  return true;
}

/**
 * Mark a module complete and deliver the next one (or completion message).
 * Called from the button-reply handler.
 */
async function handleModuleDone(userId, moduleId, phoneNumber) {
  const moduleIdNum = parseInt(moduleId, 10);
  if (!moduleIdNum) return false;

  const { data: mod } = await supabase
    .from('training_modules')
    .select('id, course_id, title, order_index')
    .eq('id', moduleIdNum)
    .single();
  if (!mod) {
    logToFile('⚠️ Module not found for done-mark', { moduleId: moduleIdNum });
    await WhatsAppService.sendMessage(phoneNumber, 'That module could not be found. Send /training to start over.');
    return false;
  }

  // Upsert progress row (idempotent — safe to double-tap).
  const { error: pErr } = await supabase
    .from('teacher_training_progress')
    .upsert(
      { user_id: userId, module_id: moduleIdNum, completed_at: new Date().toISOString() },
      { onConflict: 'user_id,module_id' }
    );
  if (pErr) {
    logToFile('❌ Progress upsert failed', { userId, moduleId: moduleIdNum, error: pErr.message });
  }

  logToFile('🎓 Module marked done', { userId, moduleId: moduleIdNum, courseId: mod.course_id, title: mod.title });

  // If the teacher is REVIEWING an already-fully-complete course (all modules
  // had progress rows before this tap), advance to the next module by
  // order_index instead of falling back to `deliverNextModule` which would
  // loop back to the first module. When we hit the end, tell them politely.
  const { data: allMods } = await supabase
    .from('training_modules')
    .select('id, order_index')
    .eq('course_id', mod.course_id)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  const { data: progressRows } = await supabase
    .from('teacher_training_progress')
    .select('module_id')
    .eq('user_id', userId)
    .in('module_id', (allMods || []).map(m => m.id));
  const doneIds = new Set((progressRows || []).map(p => p.module_id));
  const allDone = (allMods || []).every(m => doneIds.has(m.id));

  if (allDone) {
    // Review mode: pick the module with order_index strictly greater than
    // the one we just watched. If none, we've reached the end.
    const next = (allMods || []).find(m => m.order_index > mod.order_index);
    if (!next) {
      await WhatsAppService.sendMessage(
        phoneNumber,
        `📘 You've reviewed the whole course. Send /training to pick a different course or check your next level.`
      );
      return true;
    }
    // Deliver the next module (bypass "find uncompleted" logic — just send it).
    return await deliverModuleById(next.id, phoneNumber, { reviewMode: true, courseId: mod.course_id });
  }

  // Normal path — advance through uncompleted modules.
  await WhatsAppService.sendMessage(phoneNumber, `✅ *${mod.title}* — marked done. Loading next module…`);
  return await deliverNextModule(userId, mod.course_id, phoneNumber);
}

/**
 * Send a specific module by id. Two call paths:
 *   1. Flow module-picker → module_id straight from the dropdown (no reviewMode/courseId prehint)
 *   2. Review-mode advancement from handleModuleDone (passes reviewMode + courseId)
 * If reviewMode is not supplied, we infer it from whether the user already
 * has a progress row for this module — "already watched" is review mode.
 */
async function deliverModuleById(moduleId, phoneNumber, opts = {}) {
  let { reviewMode, courseId, userId } = opts;
  const { data: m } = await supabase
    .from('training_modules')
    .select('id, course_id, title, video_url, order_index')
    .eq('id', moduleId)
    .single();
  if (!m) {
    logToFile('⚠️ deliverModuleById: module not found', { moduleId });
    await WhatsAppService.sendMessage(phoneNumber, 'That module could not be found. Send /training to start over.');
    return false;
  }
  if (!courseId) courseId = m.course_id;

  // Infer review mode from progress if not supplied
  if (reviewMode === undefined && userId) {
    const { data: p } = await supabase
      .from('teacher_training_progress')
      .select('module_id')
      .eq('user_id', userId)
      .eq('module_id', m.id)
      .maybeSingle();
    reviewMode = !!p;
  }

  const { data: course } = await supabase.from('training_courses').select('title').eq('id', courseId).maybeSingle();
  const { count: totalCount } = await supabase.from('training_modules').select('id', { count: 'exact', head: true }).eq('course_id', courseId).eq('is_active', true);
  const courseTitle = course?.title || `Course #${courseId}`;
  const label = reviewMode ? `Review · ${m.order_index} of ${totalCount}` : `${m.order_index} of ${totalCount}`;
  const caption = `📘 *${courseTitle}* — ${label}\n\n*${m.title}*\n\n` +
    (reviewMode ? 'Watch and tap ▶ Next video to continue reviewing.' : 'Watch and tap ✓ Done for the next module.');
  if (m.video_url) {
    try {
      const signed = await getPresignedUrl(m.video_url, 3600);
      // See deliverNextModule for why we send as a text link, not video/document
      logToFile('🎓 deliverModuleById sending as link', { moduleId, urlPrefix: signed.slice(0, 80) });
      await WhatsAppService.sendMessage(phoneNumber, `${caption}\n\n▶️ ${signed}`);
    } catch (err) {
      logToFile('⚠️ deliverModuleById presign/send failed', { moduleId, error: err.message });
      await WhatsAppService.sendMessage(phoneNumber, caption + `\n\n(Video could not be delivered — please contact NIETE support.)`);
    }
  } else {
    logToFile('⚠️ Module has no video_url — sending "no video available" text (deliverModuleById)', { moduleId: m.id, courseId });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `📘 *${courseTitle}* — ${label}\n\n*${m.title}*\n\nNo video is available for this module yet. Tap ▶ Next video to continue.`
    );
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  await WhatsAppService.sendInteractiveButtons(phoneNumber, {
    body: `Finished watching "${m.title}"?`,
    buttons: [
      { id: `training_module_done_${m.id}`, title: '▶ Next video' },
      { id: `training_pause`, title: '⏸ Pause' },
    ],
  });
  return true;
}

module.exports = { deliverNextModule, handleModuleDone, deliverModuleById };
