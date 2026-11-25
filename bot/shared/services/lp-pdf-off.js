'use strict';
/**
 * The guard in front of every in-flight lesson-plan PDF send on WhatsApp: a Flow tap already made, a worker's waiter,
 * a re-delivery, a typed curriculum topic. The doors (app-redirect linkVerdict) already send her to the app when her
 * programme is on `lp_whatsapp_pdf_off`; these sends can start before or around a door, so each asks here first.
 *
 *   { off: false }          her programme is not on the list (or the switch is absent or malformed): send as today
 *   { off: true, linked }   no PDF; the app link went instead (`linked` false when it could not be sent)
 *
 * `plan` (bd-zrdvmi.60): the plan she tapped, `k5:<lesson_id>`, when the caller knows it: the link opens that plan.
 *
 * Never throws. Logs the keyed teacher reference only.
 */
const { logToFile } = require('../utils/logger');
const { isLpWhatsappPdfOffFor } = require('./lp-whatsapp-off');

const teacherRef = (id) => { try { return id ? require('./quiz/web-quiz-kid').tk(id) : null; } catch (_) { return null; } };

async function pdfOffLink({ userId, phone, language = null, reason = 'pdf_off', plan = null } = {}) {
  if (!(await isLpWhatsappPdfOffFor(userId))) return { off: false };
  let linked = false;
  if (phone) {
    try {
      // Required here, not at the top: app-redirect pulls in much of the bot, and the senders that ask this are
      // themselves required early.
      linked = (await require('./app-redirect.service').sendLessonPlanLink({ userId, from: phone, language, reason, ...(plan ? { plan } : {}) })) === true;
    } catch (err) {
      logToFile('⚠️ LP PDF off: the app link could not be sent', { tk: teacherRef(userId), reason, error: err && err.message }, 'warn');
    }
  }
  logToFile('📲 LP PDF off for her programme: app link instead of the PDF', { tk: teacherRef(userId), reason, linked });
  return { off: true, linked };
}

module.exports = { pdfOffLink };
