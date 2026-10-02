'use strict';
/**
 * Route an LP-selection LIST tap to the linker and continue the coaching flow
 * (bd-wa5io).
 *
 * The LP-selection menu's row ids are emitted by lp-selection-list.service.js:
 *   lp_select_{assetId}_{sessionId}  — link a recent corpus LP (fidelity ref)
 *   lp_upload_{sessionId}            — teacher will send her own document
 *   lp_none_{sessionId}              — continue without an LP
 *
 * The linker (handleLPSelection) does the DB linking; this handler owns the
 * CONTINUATION the buttons path got from handleLessonPlanResponse and the list
 * path never had — tell the teacher what happens next, and queue the analysis
 * where the flow proceeds. Without it a tap updated nothing and the session
 * hung at awaiting_lesson_plan.
 *
 * bd-2c1gj (ICT HITL feedback, row 189): in a list the wrong row is one slip
 * away, and a pick linked the plan and queued the analysis at once. So every
 * lp_select_ tap — a human coach on an observation, or a teacher on her own
 * Digital Coach session (widened 2026-09-30) — first asks, naming the plan tapped:
 *   lpconfirm_yes_{assetId}_{sessionId}  "Yes"                — link it (the unchanged lp_select_ path)
 *   lpconfirm_no_{sessionId}             "Change lesson plan" — link nothing, re-send the menu
 */
const { logToFile, logWarn } = require('../../../utils/logger');
const { REVIEW_SUBMITTED_STATUSES } = require('../fidelity/fidelity-recompute.service');
const { resolveUx } = require('../../../config/ux-strings');
const { isTerminalStatus } = require('../session-terminal');

const LP_ID_RE = /^lp_(select|upload|none)_/;
const CONFIRM_ID_RE = /^lpconfirm_(yes|no)_/;

// sessionId is always the LAST underscore-separated UUID; asset ids can contain
// underscores in principle, so take the trailing 36-char UUID.
function sessionIdFrom(listId) {
  const m = listId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : null;
}

async function defaultResolveLanguage(sid) {
  try {
    const supabase = require('../../../config/supabase');
    const { data } = await supabase
      .from('coaching_sessions')
      .select('observation_type, observer_user_id, users:users(name, preferred_language)')
      .eq('id', sid)
      .maybeSingle();
    // bd-9hzdn.3: in a leader observation the COACH is the one tapping —
    // reply in the observer's language, not the observed teacher's.
    if (data && data.observation_type === 'leader_observation' && data.observer_user_id) {
      const { data: obs } = await supabase
        .from('users')
        .select('preferred_language')
        .eq('id', data.observer_user_id)
        .maybeSingle();
      if (obs && obs.preferred_language) return obs.preferred_language;
    }
    return (data && data.users && data.users.preferred_language) || 'en';
  } catch (_) { return 'en'; }
}

async function defaultSessionStatus(sid) {
  try {
    const supabase = require('../../../config/supabase');
    const { data } = await supabase
      .from('coaching_sessions').select('status').eq('id', sid).maybeSingle();
    return (data && data.status) || null;
  } catch (_) { return null; }
}

async function handleLpListSelection(listId, from, deps = {}) {
  if (!LP_ID_RE.test(listId || '')) return false;

  const linker = deps.linker || require('./lp-coaching-linker.service');
  const sendMessage = deps.sendMessage
    || ((to, text) => require('../../whatsapp.service').sendMessage(to, text));
  const queueAnalysis = deps.queueAnalysis
    || ((sid, payload) => require('../coaching-job-queue.service').queueAnalysis(sid, payload));
  const resolveLanguage = deps.resolveLanguage || defaultResolveLanguage;
  const { getCoachingMessage } = deps.messages || require('../../../config/coaching-messages');
  const recomputeFidelity = deps.recomputeFidelity
    || ((sid) => require('../fidelity/fidelity-recompute.service').recomputeFidelityForSession(sid));
  // R165: remember WHICH observation the upload is for (deps.userId =
  // the tapper), so the document that follows binds here — not to the newest
  // session at awaiting_lesson_plan.
  const setMediaTarget = deps.setMediaTarget
    || ((uid, sid, kind) => require('../media-target.service').setTarget(uid, sid, kind));
  const sessionStatus = deps.sessionStatus || defaultSessionStatus;

  // The tapped row's own label (title + context line), rebuilt from the same
  // source and formatter as the menu, so the tapper reads back the row tapped.
  const describeSelection = deps.describeSelection
    || (async (sid, assetId) => {
      try {
        const supabase = require('../../../config/supabase');
        const { data } = await supabase
          .from('coaching_sessions').select('user_id').eq('id', sid).maybeSingle();
        if (!data || !data.user_id) return null;
        const { getRecentFidelityLps } = require('./recent-fidelity-lps.service');
        const { formatLpRow } = require('./lp-selection-format');
        const lp = (await getRecentFidelityLps(data.user_id)).find((r) => r.id === assetId);
        return lp ? formatLpRow(lp) : null;
      } catch (_) { return null; }
    });
  const sendButtons = deps.sendButtons
    || ((to, payload) => require('../../whatsapp.service').sendInteractiveButtons(to, payload));

  const sessionId = sessionIdFrom(listId);
  if (!sessionId) {
    logToFile('[lp-list] tap had no session id — ignoring', { listId });
    return false;
  }
  const lang = await resolveLanguage(sessionId);

  // bd-2kxxa.4: the list stays in the chat, so a tap can land AFTER the observer's
  // review was submitted. Check FIRST — a submitted session gets an honest reply
  // and NO write; the old path wrote the ref, said "linked", then the recompute
  // refused silently (review_submitted) and nothing changed.
  // Read the status for EVERY row id, not only "link this LP": "No lesson plan"
  // and "Upload new" both walk the session forward too.
  const status = await sessionStatus(sessionId);
  if (isTerminalStatus(status)) {
    logToFile('[lp-list] tap after the observation was cancelled — not linking', { sessionId, status });
    await sendMessage(from, resolveUx('coachingSessionCancelled', { language: lang }));
    return true;
  }
  if (listId.startsWith('lp_select_')) {
    if (REVIEW_SUBMITTED_STATUSES.includes(status)) {
      logToFile('[lp-list] late tap after review submitted — not linking', { sessionId, status });
      await sendMessage(from, getCoachingMessage('lessonPlan_review_submitted', lang));
      return true;
    }
    // bd-2c1gj — ask before linking any pick. deps.confirmed is set only by the
    // "Yes" tap, which re-enters here to link.
    if (!deps.confirmed) {
      const assetId = listId.slice('lp_select_'.length, -(sessionId.length + 1));
      const row = await describeSelection(sessionId, assetId);
      const body = getCoachingMessage('lessonPlan_confirm_prompt', lang)
        .replace('{title}', (row && row.title) || getCoachingMessage('lessonPlan_confirm_fallback_title', lang))
        .replace('{details}', (row && row.description) || '');
      const asked = await sendButtons(from, {
        body: body.replace(/\n{3,}/g, '\n\n'),
        buttons: [
          { id: `lpconfirm_yes_${assetId}_${sessionId}`, title: getCoachingMessage('lessonPlan_confirm_yes', lang) },
          { id: `lpconfirm_no_${sessionId}`, title: getCoachingMessage('lessonPlan_confirm_change', lang) },
        ],
      });
      if (asked !== false) {
        logToFile('[lp-list] LP pick — asked to confirm before linking', { sessionId, assetId });
        return true;
      }
      // Never strand the session on a prompt that did not go out: link as before.
      logWarn('[lp-list] LP confirmation could not be sent — linking without it', { sessionId, assetId });
    }
  }

  let result = null;
  try {
    result = await linker.handleLPSelection(sessionId, listId);
  } catch (err) {
    // NEVER leave the teacher silent: degrade to the no-LP path so the flow finishes.
    logToFile('[lp-list] linker failed — degrading to no-LP continuation', { listId, error: err.message });
    await sendMessage(from, getCoachingMessage('lessonPlan_skip', lang));
    await queueAnalysis(sessionId, { from });
    return true;
  }

  if (result && result.awaiting_upload) {
    // "Upload new": ask for the document; the document handler continues the flow.
    if (deps.userId) {
      try {
        await setMediaTarget(deps.userId, sessionId, 'lp');
      } catch (err) {
        logToFile('[lp-list] could not record lp media target (non-fatal)', { sessionId, error: err.message });
      }
    }
    await sendMessage(from, getCoachingMessage('lessonPlan_request', lang));
    return true;
  }

  // Meta bill cut NC3: on a teacher's own session the outcome line rides on the
  // analysis job's Step 2/5 instead of going out on its own (a 30 s fallback
  // sends it if the job is slow). A coach observation keeps the immediate ack.
  const deferLpOutcome = deps.deferLpOutcome
    || require('./lp-outcome-ack.service').deferOrSendLpOutcome;

  if (result && result.lesson_plan_link_method === 'selected_recent') {
    // bd-5knlj: a LATE tap — the session already analyzed — must not re-run the
    // whole analysis; recompute ONLY the fidelity section so Section B fills in
    // for the still-unsubmitted review.
    // (`status` is a const read above; re-reading into a const threw.)
    const linkStatus = status == null ? await sessionStatus(sessionId) : status;
    if (!linkStatus || linkStatus === 'awaiting_lesson_plan') {
      // "linked" only once the linker has actually written the ref.
      const extra = await deferLpOutcome({
        sessionId, from, messageKey: 'lessonPlan_linked', language: lang, sendMessage,
        text: getCoachingMessage('lessonPlan_linked', lang),
      });
      await queueAnalysis(sessionId, { from, ...extra });
      return true;
    }
    // A late tap: no analysis follows, so "linked" is said now, as before.
    await sendMessage(from, getCoachingMessage('lessonPlan_linked', lang));
    const r = await recomputeFidelity(sessionId);
    // bd-2kxxa.4: race — the review was submitted between our status check and
    // the write. The CAS persist refused; tell the coach instead of leaving
    // "linked" as the last word.
    if (r && r.recomputed === false && r.reason === 'review_submitted') {
      await sendMessage(from, getCoachingMessage('lessonPlan_review_submitted', lang));
    }
    return true;
  }

  // none (or an unresolvable selection that fell back to none)
  const extra = await deferLpOutcome({
    sessionId, from, messageKey: 'lessonPlan_skip', language: lang, sendMessage,
    text: getCoachingMessage('lessonPlan_skip', lang),
  });
  await queueAnalysis(sessionId, { from, ...extra });
  return true;
}

/**
 * bd-2c1gj — the two buttons on the "use this lesson plan?" confirmation.
 *   lpconfirm_yes_{assetId}_{sessionId} → the lp_select_ path, now confirmed
 *   lpconfirm_no_{sessionId}            → link nothing, re-send the menu
 * @returns {Promise<boolean>} true when the id was one of ours
 */
async function handleLpConfirmTap(buttonId, from, deps = {}) {
  const m = CONFIRM_ID_RE.exec(buttonId || '');
  if (!m) return false;
  const sessionId = sessionIdFrom(buttonId);
  if (!sessionId) {
    logToFile('[lp-confirm] tap had no session id — ignoring', { buttonId });
    return false;
  }

  if (m[1] === 'yes') {
    const assetAndSession = buttonId.slice('lpconfirm_yes_'.length);
    return handleLpListSelection(`lp_select_${assetAndSession}`, from, { ...deps, confirmed: true });
  }

  const sendMessage = deps.sendMessage
    || ((to, text) => require('../../whatsapp.service').sendMessage(to, text));
  const resolveLanguage = deps.resolveLanguage || defaultResolveLanguage;
  const sessionStatus = deps.sessionStatus || defaultSessionStatus;
  const resendList = deps.resendList
    || ((sid, to, l) => require('./lp-step.service').resendLpList({ sessionId: sid, from: to, lang: l }));
  const { getCoachingMessage } = deps.messages || require('../../../config/coaching-messages');

  const lang = await resolveLanguage(sessionId);
  const status = await sessionStatus(sessionId);
  if (isTerminalStatus(status)) {
    await sendMessage(from, resolveUx('coachingSessionCancelled', { language: lang }));
    return true;
  }
  if (REVIEW_SUBMITTED_STATUSES.includes(status)) {
    await sendMessage(from, getCoachingMessage('lessonPlan_review_submitted', lang));
    return true;
  }
  const sent = await resendList(sessionId, from, lang);
  if (!sent) logWarn('[lp-confirm] could not re-send the LP menu', { sessionId });
  return true;
}

module.exports = { handleLpListSelection, handleLpConfirmTap, sessionIdFrom };
