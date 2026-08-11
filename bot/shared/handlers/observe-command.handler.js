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
const { clampLanguage } = require('../config/ux-strings');

// bd-2432 (port of main-bot FEAT-116) — the visit-picker feature flag. Cached at
// import (restart after setting). Unset ⇒ the whole picker is dormant and
// /observe behaves exactly as today.
const OBSERVE_VISIT_FLOW_ID = process.env.OBSERVE_VISIT_FLOW_ID || '';

// Picker invite chrome (coach-facing chat message, ur/en — NIETE market).
const VISIT_FLOW_BODY = {
  en: 'Let\'s plan your visit. Pick a school, then a teacher — I\'ll brief you before you walk in.',
  ur: 'آئیے آپ کے دورے کی منصوبہ بندی کریں۔ اسکول چنیں، پھر استاد — کلاس میں جانے سے پہلے میں آپ کو بریف کر دوں گی۔',
};
const VISIT_FLOW_CTA = { en: 'Plan my visit', ur: 'دورہ چنیں' };

/**
 * Does this coach have ANY school assignment? The assignment IS the gate —
 * leader_schools only ever holds roster-backfilled ICT coaches, which is more
 * reliable than users.region (NULL on bulk-seeded rows). Any error → false
 * (falls back to today's bare capture — a coach is never dead-ended).
 */
async function leaderHasAssignment(user) {
  try {
    const { data, error } = await supabase
      .from('leader_schools')
      .select('id')
      .eq('leader_user_id', user.id)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch (_) {
    return false;
  }
}

async function sendObserveVisitFlow(user, from) {
  const lang = clampLanguage(observeLang(user));
  await WhatsAppService.sendFlow(from, {
    flowId: OBSERVE_VISIT_FLOW_ID,
    body: VISIT_FLOW_BODY[lang],
    buttonText: VISIT_FLOW_CTA[lang],
    flowToken: user.id, // bd-215: flow_token = bare user.id (no colons)
  });
  await ObserveState.setState(user.id, 'awaiting_pick', { arm: getObserveArm(user) });
}

/**
 * bd-2432 — launch the school→teacher→brief picker when the flag is set AND the
 * coach has an assignment. Returns true when the Flow was sent (caller stops);
 * false → caller falls through to today's bare-capture path. Never throws.
 */
async function maybeLaunchVisitFlow(user, from) {
  try {
    if (OBSERVE_VISIT_FLOW_ID && user && await leaderHasAssignment(user)) {
      await sendObserveVisitFlow(user, from);
      return true;
    }
  } catch (err) {
    logToFile('⚠️ observe-visit: launch failed, falling back to bare capture', {
      userId: user && user.id, error: err.message,
    });
  }
  return false;
}

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
      // bd-2432: a coach's FIRST-ever /observe reaches the picker too (upstream
      // bd-2360 — onboarding must not strand them on bare capture).
      if (await maybeLaunchVisitFlow(user, from)) return true;
      await WhatsAppService.sendMessage(from, S.capture_prompt);
      await ObserveState.setState(user.id, 'awaiting_audio', { arm: result.arm });
      return true;
    }

    case 'capture':
    default: {
      // bd-2444: with the scheduling UI live, the Flow's MENU covers pending
      // debriefs (with counts) — an assigned coach goes straight to the Flow
      // and the chat interception below is skipped. Flag off, or unassigned
      // coach (maybeLaunchVisitFlow → false): today's path, byte-identical.
      if (process.env.OBSERVE_SCHEDULING_UI === 'true') {
        if (await maybeLaunchVisitFlow(user, from)) return true;
      }
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
      // bd-2432: assigned coach → the school→teacher→brief picker (AFTER the
      // pending-debrief interception above, upstream bd-2330 ordering).
      if (await maybeLaunchVisitFlow(user, from)) return true;
      await WhatsAppService.sendMessage(from, S.capture_prompt);
      await ObserveState.setState(user.id, 'awaiting_audio', { arm: getObserveArm(user) });
      return true;
    }
  }
}

module.exports = { handleObserveCommand, maybeLaunchVisitFlow };
