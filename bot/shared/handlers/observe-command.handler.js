/**
 * FEAT-053 bd-12 — /observe command handler (Tanzania school leaders).
 *
 * Flow: gates (region, account, role) → one-time onboarding (A/B arm:
 * why_coaching vs functional — bd-13/bd-14) → capture prompt + Redis state.
 * The audio interception that consumes the awaiting_audio state ships in the
 * next slice (bd-16); until then the recording is processed on arrival of
 * that slice — this handler owns command UX only.
 *
 * Returns true when the message was handled (caller stops processing);
 * false when it should fall through (non-TZ deployments — PK unchanged).
 */

const WhatsAppService = require('../services/whatsapp.service');
const ObserveState = require('../services/observe/observe-state.service');
const ObserveDebrief = require('../services/observe/observe-debrief.service');
const { evaluateObserveTrigger, getObserveArm } = require('../services/observe/observe-gate');
const { observeStrings, observeLang } = require('../services/observe/observe-strings');
const { detectRegion } = require('../utils/region');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

async function markOnboarded(user) {
  const mergedPrefs = {
    ...(user.preferences || {}),
    observe_onboarded: true,
    observe_onboarded_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('users')
    .update({ preferences: mergedPrefs })
    .eq('id', user.id);
  if (error) {
    // Non-fatal: they'd see onboarding again next time. Log and continue.
    logToFile('⚠️ observe: failed to persist observe_onboarded flag', {
      userId: user.id, error: error.message,
    });
  }
}

/**
 * @param {object|null} user  users row
 * @param {string} from       WhatsApp sender phone
 * @param {string} messageBody the (trimmed) inbound text
 * @returns {Promise<boolean>} handled?
 */
async function handleObserveCommand(user, from, messageBody) {
  const region = detectRegion();
  const result = evaluateObserveTrigger({ messageBody, user, region });
  if (!result.match) return false;

  const lang = observeLang(user);
  const S = observeStrings(lang);

  logToFile('🔭 /observe command', {
    userId: user && user.id, phoneNumber: from, action: result.action, region,
  });

  switch (result.action) {
    case 'deny_no_user':
      await WhatsAppService.sendMessage(from, S.no_account);
      return true;

    case 'deny_role':
      await WhatsAppService.sendMessage(from, S.role_denied);
      return true;

    case 'onboard': {
      // Persist the flag FIRST so a mid-flight crash can't replay the
      // one-time onboarding (and burn the A/B first-contact moment twice).
      await markOnboarded(user);
      const armMessage = result.arm === 'why_coaching' ? S.onboard_why : S.onboard_functional;
      await WhatsAppService.sendMessage(from, armMessage);
      await WhatsAppService.sendMessage(from, S.capture_prompt);
      await ObserveState.setState(user.id, 'awaiting_audio', { arm: result.arm });
      return true;
    }

    case 'capture':
    default: {
      // bd-21: pending debriefs surface as an interactive list first. The
      // list tap decides the next step, so no capture state is armed here.
      // Lookup failure degrades to the plain capture prompt — the pendings
      // resurface next time; a dead-ended FO does not.
      try {
        const pendings = await ObserveDebrief.listPendingDebriefs(user.id);
        const unsent = await ObserveDebrief.listUnsentReports(user.id).catch(() => []);
        if (pendings.length > 0 || unsent.length > 0) {
          await WhatsAppService.sendInteractiveMessage(
            from, ObserveDebrief.buildPendingListPayload(pendings, S, unsent));
          return true;
        }
      } catch (err) {
        logToFile('⚠️ observe: pending-debrief lookup failed, falling back to capture', {
          userId: user.id, error: err.message,
        });
      }
      await WhatsAppService.sendMessage(from, S.capture_prompt);
      await ObserveState.setState(user.id, 'awaiting_audio', { arm: getObserveArm(user) });
      return true;
    }
  }
}

module.exports = { handleObserveCommand };
