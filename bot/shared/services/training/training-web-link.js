'use strict';
/**
 * Training on the web — the link a teacher taps to open the portal's training
 * pages from WhatsApp (the training area of portal-web-link.js).
 *
 * On only while app_settings `web_training_enabled` is true and
 * `web_training_teachers` is "all" or lists the teacher; anything else, or a
 * failed send, is today's Flow (training-entry.service.js). The template's URL
 * button is `<portal>/t/{{1}}`.
 */

const { createWebLink } = require('../portal-web-link');

const link = createWebLink({
  area: 'training',
  enabledKey: 'web_training_enabled',
  teachersKey: 'web_training_teachers',
  defaultTemplate: 'training_open_v1',
  templateEnv: 'WEB_TRAINING_TEMPLATE',
});

module.exports = {
  webTrainingOn: link.on,
  sendTrainingLink: link.send,
  _resetCache: link._resetCache,
};
