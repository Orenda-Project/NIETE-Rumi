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

// bd-2432 (port of main-bot FEAT-116) — the visit-picker feature flag.
//
// bd-jrxo3 reads it at CALL time, not import time. It is no longer only a
// feature flag: it is the CAPABILITY signal that decides whether a bare capture
// is the product (no picker in this market) or a bug (a picker exists). A value
// frozen at import cannot be exercised both ways in one process, and a flag
// this load-bearing should not need a restart to be true.
function visitFlowId() {
  return process.env.OBSERVE_VISIT_FLOW_ID || '';
}

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
    flowId: visitFlowId(),
    body: VISIT_FLOW_BODY[lang],
    buttonText: VISIT_FLOW_CTA[lang],
    flowToken: user.id, // bd-215: flow_token = bare user.id (no colons)
  });
  await ObserveState.setState(user.id, 'awaiting_pick', { arm: getObserveArm(user) });
}

// The loop chrome. Per-language objects, never a literal at the call site —
// the coach loops many times a session and every card she gets is in her own
// language. (Language protocol: one writer, per-language data.)
const REOPEN_BODY = {
  ADD_SEARCH: { en: 'Search for the next school to add.', ur: 'اگلا اسکول تلاش کریں جو آپ شامل کرنا چاہتی ہیں۔' },
  MANAGE_SCHOOLS: { en: 'Pick a school to remove from your list.', ur: 'اپنی فہرست سے ہٹانے کے لیے اسکول چنیں۔' },
  MENU: { en: 'What would you like to do next?', ur: 'اب آپ کیا کرنا چاہیں گی؟' },
};
const REOPEN_CTA = {
  ADD_SEARCH: { en: 'Add a school', ur: 'اسکول شامل کریں' },
  MANAGE_SCHOOLS: { en: 'Remove a school', ur: 'اسکول ہٹائیں' },
  MENU: { en: 'Open menu', ur: 'مینو کھولیں' },
};

/**
 * bd-ve7kd — reopen the picker so a coach can loop.
 *
 * Meta's Flows are a DAG with one Footer per screen, so a loop cannot live
 * inside the Flow (verified against Meta: a link cannot `complete`, a second
 * Footer is rejected, and a route back to MENU is refused). Closing and
 * reopening is the loop. `screen === null` reopens in data_exchange mode, which
 * runs the endpoint's INIT and serves a freshly-built MENU.
 */
async function reopenObserveVisitFlow(user, from, screen, screenData) {
  if (!visitFlowId()) return false;
  const lang = clampLanguage(observeLang(user));
  const key = screen || 'MENU';
  const chrome = REOPEN_BODY[key] || REOPEN_BODY.MENU;
  const cta = REOPEN_CTA[key] || REOPEN_CTA.MENU;
  await WhatsAppService.sendFlow(from, {
    flowId: visitFlowId(),
    body: chrome[lang] || chrome.en,
    buttonText: cta[lang] || cta.en,
    flowToken: user.id,
    screen: screen || undefined,          // undefined => data_exchange => MENU
    screenData: screenData || undefined,
  });
  return true;
}

/**
 * bd-jrxo3 — three answers, not two.
 *
 * A boolean could not tell "there is no picker in this market" apart from "this
 * person may not use the picker", and only the FIRST of those may fall back to
 * a bare capture. Conflating them is how 77 observations were written against
 * the coach instead of the teacher.
 *
 *   'unavailable' — OBSERVE_VISIT_FLOW_ID unset. The ONLY case that keeps bare
 *                   capture, because it is the product there (upstream Tanzania
 *                   has no visit Flow, and /observe would otherwise be dead).
 *   'declined'    — a Flow exists, this user is not eligible for it, OR sending
 *                   it failed. Never a bare capture: we know a picker exists.
 *   'launched'    — the Flow was sent.
 *
 * Never throws.
 */
async function maybeLaunchVisitFlow(user, from) {
  if (!visitFlowId()) return 'unavailable';
  try {
    // bd-0cxz6: a coach with NO schools used to be refused here, which meant she
    // never saw the menu — and the menu is the only way to add a first school.
    // 22 of 80 prod coaches were locked out of /observe entirely by this. The
    // assignment check stays as the fallback for anyone whose role was never
    // set, so nobody who works today loses access.
    const isCoach = user && user.role === 'coach';
    if (user && (isCoach || await leaderHasAssignment(user))) {
      await sendObserveVisitFlow(user, from);
      return 'launched';
    }
  } catch (err) {
    // "I could not open it" is not "there is none here". Falling back to bare
    // capture on an error would re-open the hole this bead closes.
    logToFile('⚠️ observe-visit: launch failed — redirecting, not falling back', {
      userId: user && user.id, error: err.message,
    });
    return 'declined';
  }
  return 'declined';
}

/**
 * bd-jrxo3 — the redirect. One line in her language, then the picker itself, so
 * the instruction and the means to follow it arrive together.
 *
 * Opens on SELECT_SCHOOL when she has schools; on the MENU when she has none,
 * because the menu is the only place a first school can be added (bd-0cxz6).
 * Best-effort throughout: /observe always gets her back in.
 */
async function sendVisitRedirect(user, from) {
  const S = observeStrings(observeLang(user));
  await WhatsAppService.sendMessage(from, S.redirect_pick_teacher);

  let screen = null;
  let screenData;
  try {
    // Opening straight onto a screen is navigate mode — there is no endpoint
    // round-trip, so WE supply every key the screen declares.
    const { schoolsScreenV2 } = require('./observe-visit-flow.handler');
    const built = await schoolsScreenV2(user.id);
    const options = (built && built.data && built.data.options) || [];
    if (options.length) { screen = 'SELECT_SCHOOL'; screenData = { options }; }
  } catch (err) {
    logToFile('⚠️ observe-visit: school list failed — opening the menu instead', {
      userId: user && user.id, error: err.message,
    });
  }

  const sent = await reopenObserveVisitFlow(user, from, screen, screenData);
  if (sent === false && screen) await reopenObserveVisitFlow(user, from, null);
  return true;
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
      const outcome = await maybeLaunchVisitFlow(user, from);
      if (outcome === 'launched') return true;
      if (outcome === 'declined') return sendVisitRedirect(user, from);
      // 'unavailable' only: no picker in this market, so the recording IS the
      // entry point. Byte-for-byte today's path.
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
        // Only a LAUNCH short-circuits here; an ineligible coach still gets her
        // pending debriefs below before the redirect (upstream bd-2330 ordering).
        if (await maybeLaunchVisitFlow(user, from) === 'launched') return true;
      }
      // bd-21: pending debriefs surface as an interactive list first. The
      // list tap decides the next step, so no capture state is armed here.
      // Lookup failure degrades to the plain capture prompt — the pendings
      // resurface next time; a dead-ended FO does not.
      try {
        const pendings = await ObserveDebrief.listPendingDebriefs(user.id);
        const unsent = await ObserveDebrief.listUnsentReports(user.id).catch(() => []);
        // bd-tju8f: stage A — the previously-invisible pre-form backlog.
        const unfinished = await ObserveDebrief.listUnfinished(user.id).catch(() => []);
        if (pendings.length > 0 || unsent.length > 0 || unfinished.length > 0) {
          await WhatsAppService.sendInteractiveMessage(
            from, ObserveDebrief.buildPendingListPayload(pendings, S, unsent, unfinished));
          return true;
        }
      } catch (err) {
        logToFile('⚠️ observe: pending-debrief lookup failed, falling back to capture', {
          userId: user.id, error: err.message,
        });
      }
      // bd-2432: assigned coach → the school→teacher→brief picker (AFTER the
      // pending-debrief interception above, upstream bd-2330 ordering).
      const outcome = await maybeLaunchVisitFlow(user, from);
      if (outcome === 'launched') return true;
      if (outcome === 'declined') return sendVisitRedirect(user, from);
      // 'unavailable' only — see the onboard arm.
      await WhatsAppService.sendMessage(from, S.capture_prompt);
      await ObserveState.setState(user.id, 'awaiting_audio', { arm: getObserveArm(user) });
      return true;
    }
  }
}

module.exports = {
  reopenObserveVisitFlow, handleObserveCommand, maybeLaunchVisitFlow, sendVisitRedirect };
