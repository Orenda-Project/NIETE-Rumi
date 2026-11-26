'use strict';
/**
 * Mounts the teacher's quiz edit at /api/internal/wqedit (web_quiz_teacher_edit; off → 404 {off:true}). A module that
 * throws at load costs exactly this mount: the bot starts, every other route is today's, and the failure is logged
 * once. → true when mounted.
 */
const MOUNT_PATH = '/api/internal/wqedit';

function mountTeacherEdit(app, load = () => require('../../routes/quiz-teacher-edit.routes').createRouter()) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ teacher quiz edit routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountTeacherEdit, MOUNT_PATH };
