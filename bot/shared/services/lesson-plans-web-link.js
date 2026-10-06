'use strict';
/**
 * Lesson plans on the web — the link a teacher taps to open the portal's lesson
 * plans from WhatsApp (the lessons area of portal-web-link.js).
 *
 * On only while app_settings `web_lessons_enabled` is true and
 * `web_lessons_teachers` is "all" or lists the teacher; anything else, or a
 * failed send, is today's catalogue Flow (lp-browse-entry.service.js). The
 * template's URL button is `<portal>/t/{{1}}`; the token names the area.
 */

const { createWebLink } = require('./portal-web-link');

const link = createWebLink({
  area: 'lessons',
  enabledKey: 'web_lessons_enabled',
  teachersKey: 'web_lessons_teachers',
  defaultTemplate: 'lesson_plans_open_v1',
  templateEnv: 'WEB_LESSONS_TEMPLATE',
});

module.exports = {
  webLessonsOn: link.on,
  sendLessonsLink: link.send,
  _resetCache: link._resetCache,
};
