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
  if (!state.module) {
    // All modules complete
    logToFile('🎓 Course complete', { userId, courseId: courseIdNum, courseTitle });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `🎉 You've completed *${courseTitle}* — all ${state.totalCount} modules done.\n\n` +
      `Send /training to pick your next course or check your progress.`
    );
    return true;
  }

  const m = state.module;
  const caption =
    `📘 *${courseTitle}* — Module ${state.positionLabel}\n\n` +
    `*${m.title}*\n\n` +
    `Watch the video, then tap ✓ Done to mark it complete and get the next module.`;

  logToFile('🎓 Delivering training module', { userId, courseId: courseIdNum, moduleId: m.id, moduleTitle: m.title, videoUrl: m.video_url });

  // Send the video via presigned URL + link mode — Meta fetches the URL
  // directly from R2 and caches. Falls back to download+reupload if the
  // link path errors (some Meta accounts don't support external URLs).
  if (m.video_url) {
    let ok = false;
    try {
      const signed = await getPresignedUrl(m.video_url, 3600); // 1h TTL is plenty
      logToFile('🎓 Sending training video via link', { moduleId: m.id, urlPrefix: signed.slice(0, 80) });
      ok = await WhatsAppService.sendVideoByLink(phoneNumber, signed, caption);
    } catch (err) {
      logToFile('⚠️ Presign or link-send failed, falling back to download+upload', { moduleId: m.id, error: err.message });
    }
    if (!ok) {
      ok = await WhatsAppService.sendVideoFromUrl(phoneNumber, m.video_url, caption);
    }
    if (!ok) {
      logToFile('❌ Both video delivery paths failed', { moduleId: m.id });
      await WhatsAppService.sendMessage(phoneNumber, caption + `\n\n(Video could not be delivered — please contact NIETE support.)`);
    }
  } else {
    await WhatsAppService.sendMessage(phoneNumber, caption + `\n\n(No video for this module yet.)`);
  }

  // Then send the "Mark done" button as a separate interactive message.
  await WhatsAppService.sendInteractiveButtons(phoneNumber, {
    body: `Finished "${m.title}"?`,
    buttons: [
      { id: `training_module_done_${m.id}`, title: '✓ Mark as done' },
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
    .select('id, course_id, title')
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
  await WhatsAppService.sendMessage(phoneNumber, `✅ *${mod.title}* — marked done. Loading next module…`);

  return await deliverNextModule(userId, mod.course_id, phoneNumber);
}

module.exports = { deliverNextModule, handleModuleDone };
