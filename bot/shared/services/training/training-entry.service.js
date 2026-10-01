/**
 * The single way to open Teacher Training.
 *
 * Two surfaces reach it — the `/training` command and the main menu's Training
 * row — and they must open the same thing. This exists so there is one Flow id
 * lookup, one set of copy, and one fallback, rather than a second copy in the
 * menu that drifts from the command. Every training bug fixed today came from
 * exactly that: two implementations of one rule, each correct when written.
 *
 * The fallback matters. `TEACHER_TRAINING_FLOW_ID` is read at call time, not at
 * module load, so clearing it in Railway degrades to an honest message on the
 * next request instead of sending a Flow id that no longer resolves.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');

/** Copy, per language. English is the deliberate floor (CLAUDE.md rule 20). */
const COPY = {
  header: '🎓 Teacher Training',
  body: {
    en: 'View your training progress and start your next level.',
    ur: 'اپنی تربیت کی پیش رفت دیکھیں اور اگلا سبق شروع کریں۔',
  },
  button: {
    en: 'Open',
    ur: 'کھولیں',
  },
  unavailable:
    "Teacher Training is being prepared for you. We'll notify you when it's live.\n\n" +
    'استاد کی تربیت آپ کے لیے تیار کی جا رہی ہے۔',
};

/**
 * Send the Teacher Training Flow.
 *
 * @param {object} user     the resolved user row; `user.id` becomes the flow token
 * @param {string} from     WhatsApp number to send to
 * @param {string} language resolved response language
 * @returns {Promise<boolean>} true if the Flow was sent, false if it fell back
 */
async function openTrainingFlow(user, from, language = 'en') {
  // bd-onxyu — every training door passes through here, so the app-redirect
  // switch is asked here too (the routers ask first; this catches any new door).
  const { redirectIfFlagged } = require('../app-redirect.service');
  if (await redirectIfFlagged('teacher_training', { userId: user?.id, from, language, reason: 'training_door' })) {
    return false;
  }

  const flowId = process.env.TEACHER_TRAINING_FLOW_ID || '';

  if (!flowId) {
    // Not published for this deployment yet. Say so rather than failing silently.
    logToFile('🎓 Training requested but TEACHER_TRAINING_FLOW_ID is unset', { userId: user?.id });
    await WhatsAppService.sendMessage(from, COPY.unavailable);
    return false;
  }

  // The flow token MUST start with the user id — an auto-generated token is
  // useless to the endpoint (whatsapp-flows skill, rule 3).
  const flowToken = `${user.id}:teacher-training:${Date.now()}`;

  await WhatsAppService.sendFlow(from, {
    flowId,
    header: COPY.header,
    body: COPY.body[language] || COPY.body.en,
    buttonText: COPY.button[language] || COPY.button.en,
    flowToken,
  });

  logToFile('🎓 Sent teacher-training flow', { userId: user.id });
  return true;
}

module.exports = { openTrainingFlow, COPY };
