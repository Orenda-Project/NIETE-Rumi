'use strict';
/**
 * The one door into attendance, and the one place a routing decision becomes
 * messages.
 *
 * `attendance-router.service` stays a pure planner — it decides, it does not
 * send. What it decided used to be turned into WhatsApp messages TWICE inside
 * text-message.handler: once for the keyword ("attendance", "حاضری") and again,
 * a hundred lines earlier, for a TYPED answer to the tap-or-voice question. The
 * two copies had already drifted — the typed path sent a different body for
 * OPEN_REGISTER, and it handled five of the planner's ten actions, so a typed
 * answer that produced EMPTY_CLASS or SEND_CLASS_MANAGER fell out to a generic
 * "something went wrong" while the tapped answer opened the right Flow.
 *
 * One switch, both callers. Every Flow id is read at call time and an unset one
 * is said honestly rather than sent as `undefined`. Copy is in the catalog.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');

/**
 * Turn one planner decision into what the teacher sees.
 *
 * @param {object} decision the planner's own decision object
 * @param {object} ctx
 * @param {object} ctx.user
 * @param {string} ctx.from
 * @param {string} [ctx.language]
 * @returns {Promise<boolean>} true when the decision was actioned as intended
 */
async function respondToDecision(decision, { user, from, language }) {
  const AttendanceRouter = require('./attendance-router.service');
  const VoiceAttendance = require('./voice-attendance.service');
  const markingFlowId = process.env.ATTENDANCE_MARKING_FLOW_ID || '';
  const classManagerFlowId = process.env.CLASS_MANAGER_FLOW_ID || '';
  const editClassFlowId = process.env.EDIT_CLASS_FLOW_ID || '';

  switch (decision.action) {
    // A principal is asked HOW before anything opens. Both options are named in
    // the body as well as on the buttons — reply buttons render below the fold on
    // some clients.
    case 'ASK_METHOD':
      // Remember that it is open, so a typed answer is understood as well as a
      // tapped one.
      await AttendanceRouter.openMethodQuestion(user.id);
      await WhatsAppService.sendInteractiveButtons(from, {
        body: decision.message,
        buttons: decision.buttons,
      });
      return true;

    // Voice leaves the Flow behind: a Flow cannot receive a voice note, so arm
    // the wait and hand the conversation back to chat. The arm lives in
    // conversation state (Postgres), not Redis — a restart mid-roll-call would
    // otherwise drop it, and this Redis has no persistent volume.
    case 'AWAIT_VOICE':
      await VoiceAttendance.arm(user.id, { subject: decision.subject, targetId: decision.targetId });
      await WhatsAppService.sendMessage(from, decision.message);
      return true;

    // Several classes and she chose voice: the roster has to be in hand before
    // spoken names can be matched to anybody.
    case 'ASK_CLASS_FOR_VOICE':
    case 'ASK_CLASS_FOR_VOICE_LIST':
      if (decision.buttons) {
        await WhatsAppService.sendInteractiveButtons(from, {
          body: decision.message,
          buttons: decision.buttons,
        });
      } else {
        await WhatsAppService.sendInteractiveMessage(from, {
          body: { text: decision.message },
          action: {
            button: resolveUx('attendanceChooseClass', { language }),
            sections: [{
              title: resolveUx('attendanceYourClasses', { language }),
              rows: decision.rows,
            }],
          },
        });
        if (decision.truncated) {
          await WhatsAppService.sendMessage(from, resolveUx('attendanceShowingFirst', {
            language, params: { count: AttendanceRouter.MAX_ROWS },
          }));
        }
      }
      return true;

    // One Flow, opened with the bare user id; it picks the class and the date.
    // MARK_* carry an explicit target — a principal always, or a tap on a picker
    // button already delivered to a handset.
    case 'OPEN_REGISTER':
    case 'MARK_TEACHERS':
    case 'MARK_STUDENTS': {
      if (!markingFlowId) {
        await WhatsAppService.sendMessage(from, resolveUx('attendanceNotAvailable', { language }));
        return false;
      }
      const bodyKey = decision.action === 'MARK_TEACHERS'
        ? 'attendanceBodyTeachers'
        : (decision.action === 'OPEN_REGISTER' ? 'attendanceBodyPickClass' : 'attendanceBodyStudents');
      await WhatsAppService.sendFlow(from, {
        flowId: markingFlowId,
        header: resolveUx('attendanceHeader', { language }),
        body: resolveUx(bodyKey, { language }),
        buttonText: resolveUx('attendanceMarkButton', { language }),
        flowToken: decision.flowToken,
      });
      return true;
    }

    // /class owns class creation. Same flowToken convention as the /class
    // command itself: the bare user id.
    case 'SEND_CLASS_MANAGER':
      if (!classManagerFlowId) {
        await WhatsAppService.sendMessage(from, resolveUx('attendanceSetUpClass', {
          language, params: { message: decision.message },
        }));
        return false;
      }
      await WhatsAppService.sendFlow(from, {
        flowId: classManagerFlowId,
        header: resolveUx('attendanceClassesHeader', { language }),
        body: decision.message,
        buttonText: resolveUx('attendanceClassesButton', { language }),
        flowToken: user.id,
      });
      return true;

    case 'EMPTY_CLASS':
      if (!editClassFlowId) {
        await WhatsAppService.sendMessage(from, decision.message);
        return false;
      }
      await WhatsAppService.sendFlow(from, {
        flowId: editClassFlowId,
        header: resolveUx('attendanceAddStudentsHeader', { language }),
        body: decision.message,
        buttonText: resolveUx('attendanceAddStudentsButton', { language }),
        flowToken: `${user.id}:${decision.listId}`,
      });
      return true;

    case 'NO_SCHOOL':
    case 'ERROR':
    default:
      await WhatsAppService.sendMessage(from,
        decision.message || resolveUx('attendanceSomethingWrong', { language }));
      return false;
  }
}

/**
 * The keyword door: plan, then respond.
 *
 * @param {object} args
 * @param {object} args.user
 * @param {string} args.from
 * @param {string} [args.language]
 * @param {string} [args.reason]
 * @returns {Promise<boolean>}
 */
async function openAttendance({ user, from, language, reason = 'unspecified' }) {
  const AttendanceRouter = require('./attendance-router.service');
  try {
    const decision = await AttendanceRouter.route(user.id);
    logToFile('📋 Attendance routed', { userId: user.id, action: decision.action, reason });
    return await respondToDecision(decision, { user, from, language });
  } catch (error) {
    logToFile('Error routing attendance', { error: error.message, userId: user?.id }, 'error');
    await WhatsAppService.sendMessage(from, resolveUx('attendanceSomethingWrong', { language }));
    return false;
  }
}

module.exports = { openAttendance, respondToDecision };
