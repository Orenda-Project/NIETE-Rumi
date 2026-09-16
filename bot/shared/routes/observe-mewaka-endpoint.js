/**
 * FEAT-053 bd-18/bd-20 — data_exchange endpoint for the editable MEWAKA Flow.
 *
 * Contract (whatsapp-flows skill, bd-215/bd-720/bd-1248):
 * - NEVER include a `version` field in any response.
 * - Every returned field must be declared in the screen's data object.
 * - ~10s Meta timeout: this endpoint only READS the pre-computed draft and
 *   buffers edits — the expensive analysis ran before the flow was sent.
 * - Forward-only routing; BACK re-serves a screen's prefill.
 *
 * Edit accumulation: each screen submit buffers its r_/ev_/imp_ values in
 * Redis (observe:edits:<sessionId>, 2h TTL). The final screen submit merges
 * everything and applies the v2 write-back. Redis loss degrades gracefully:
 * lost screens simply fall back to the v1 values (no edit recorded).
 */

const supabase = require('../config/supabase');
const redisService = require('../services/cache/railway-redis.service');
const { observeStrings } = require('../services/observe/observe-strings');
const ObserveDraft = require('../services/observe/observe-draft.service');
const { logToFile } = require('../utils/logger');

// FEAT-093 bd-52: screens/domain order come from the market's configured
// framework pack (mewaka: 6 screens; hots: 5) — read per request so one
// binary serves every market.
const { getObservePack } = require('../services/observe/observe-framework');
const EDITS_TTL = 7200;
const editsKey = (sessionId) => `observe:edits:${sessionId}`;
const packScreens = () => {
  const pack = getObservePack();
  return { order: pack.domainOrder, screens: pack.screenIds, last: pack.screenIds[pack.screenIds.length - 1] };
};
const domainKeyForScreen = (screenId) => {
  const { order, screens } = packScreens();
  return order[screens.indexOf(screenId)];
};
const nextScreen = (screenId) => {
  const { screens } = packScreens();
  const i = screens.indexOf(screenId);
  return i >= 0 && i < screens.length - 1 ? screens[i + 1] : 'SUCCESS';
};

/**
 * Statuses past which an observation is closed. A stale Flow submit must not
 * reopen one. Kept beside the two guards that read it so they cannot drift.
 */
const { TERMINAL_STATUSES } = require('../services/coaching/session-terminal');

function errorResponse(message) {
  return { data: { error: { message } } };
}

/**
 * How long one refusal notice holds. Matches the house tap-lock window —
 * TAP_LOCK_TTL_SECONDS in add-another.service.js and media-attach.service.js,
 * BIND_LOCK_TTL_S in observe-binding.service.js. A Flow message stays
 * tappable, so a coach can refuse several times in seconds and must be told
 * once, not once per tap.
 */
const REFUSAL_NOTICE_TTL_S = 300;
const refusalNoticeKey = (sessionId) => `observe:refused_notice:${sessionId}`;

/**
 * Tell the coach, IN THE CHAT, why the form will not submit.
 *
 * Deliberately a FIFTH pattern, not one of bd-8cq24's four, because none of
 * those four is reachable for THIS Flow. A data_exchange returning
 * { data: { error } } is not rendered — Meta shows its own generic "Something
 * went wrong. Try again later." — and observe-fico-flow.json declares only
 * DOMAIN_B/C/D/F plus a terminal SUCCESS: no screen declares an
 * error/message/caption field, SUCCESS declares just `session_id` and its body
 * text is hardcoded "Your FICO observation has been saved" (actively wrong
 * copy for a refusal), and `routing_model` is strictly forward-only, so
 * re-rendering a screen or returning SUCCESS from INIT is the
 * invalid-screen-transition class behind 593 of bd-3zexi's 600 client-side
 * errors. Putting the sentence on a SCREEN needs a Flow JSON revision AND a
 * Meta re-publish, which is inert until published and must not ride a
 * code-only deploy — so it is scheduled on bd-rw4so, and until it lands this
 * mirrors the button layer's proven behaviour (observe-resume.service.js
 * `_refuseTerminal`, verified green at sweep row 6a).
 *
 * The recipient comes from the token's user id, which this endpoint has
 * already checked IS the observation's owner — never a message `from`, which
 * is the bd-wwcgf rule that once put an observer's form in the teacher's chat.
 *
 * Total by construction: every failure is logged and swallowed, because the
 * refusal itself must never depend on a delivery succeeding.
 *
 * @returns {Promise<boolean>} true when she was actually told, this time
 */
async function tellCoachRefused(userId, sessionId, message) {
  try {
    const claimed = await redisService.setNX(refusalNoticeKey(sessionId), '1', REFUSAL_NOTICE_TTL_S);
    if (!claimed) return false;
    const { data: who } = await supabase
      .from('users')
      .select('phone_number')
      .eq('id', userId)
      .maybeSingle();
    if (!who || !who.phone_number) {
      logToFile('⚠️ observe-form: no phone for the refused coach — nothing delivered', {
        sessionId, userId,
      });
      return false;
    }
    // Lazily required, like the other leaf reaches in this file: the WhatsApp
    // graph reaches back into routes, and a top-level require closes a cycle.
    const WhatsAppService = require('../services/whatsapp.service');
    await WhatsAppService.sendMessage(who.phone_number, message);
    return true;
  } catch (err) {
    logToFile('⚠️ observe-form: could not deliver the refusal to the chat', {
      sessionId, error: err.message,
    });
    return false;
  }
}

/**
 * The coach's language, resolved ONLY when a screen actually needs it.
 *
 * The Section B review screen is English throughout except for one line: the note that
 * the grader's own caveat contradicted its own verdicts, which appears on about 2.6% of
 * observations. Resolving the coach's language costs a users read, and Meta's
 * data_exchange window is not generous — so the read happens on the sessions that need
 * the sentence and on no others.
 *
 * Total by construction: any failure returns undefined, and the line is then simply
 * skipped rather than served in the wrong language or as "undefined".
 */
async function coachLanguageIfNeeded(session) {
  const mods = ((session || {}).analysis_data || {}).lp_fidelity
    && session.analysis_data.lp_fidelity.moderators;
  if (!mods || !mods.truncation_inconsistent) return undefined;
  try {
    const { languageFor } = require('../services/observe/observe-language');
    return await languageFor('coach', session);
  } catch (_err) {
    return undefined;
  }
}

async function loadSessionFromToken(flowToken, tap) {
  const [userId, sessionId] = String(flowToken || '').split(':');
  if (!userId || !sessionId) return { error: 'Invalid flow token' };
  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (error || !session) return { error: 'Observation not found' };
  if (session.observation_type !== 'leader_observation') return { error: 'Not a leader observation' };
  const owner = session.observer_user_id || session.user_id;
  if (owner !== userId) return { error: 'Not your observation' };
  // A terminal observation is not editable. The review Flow is already sitting
  // in the coach's chat when she cancels, so without this the stale form still
  // submits, the row is promoted, and the teacher receives a report the coach
  // explicitly cancelled — while her cancel showed a SUCCESS screen. Prod, 15
  // Sep 2026: 113 cancelled leader observations, 103 still awaiting a debrief
  // and armed, none of them reachable from the menu, so a revival is invisible
  // until the report lands.
  if (TERMINAL_STATUSES.includes(session.status)) {
    let lang = 'en';
    try {
      const { languageFor } = require('../services/observe/observe-language');
      lang = await languageFor('coach', session);
    } catch (_) { /* the refusal must never depend on a language lookup */ }
    // bd-rw4so: this refusal used to leave NO trace. The only Axiom row for a
    // refused stale form was a generic `Decrypted flow data`, so "how many
    // coaches hit a cancelled form this week" had no answer in production
    // (the systemic bd-3zexi: 79 of 87 envelope returns emit no log). Same
    // shape and same info level as the button layer's twin at
    // observe-resume.service.js:199, so the two surfaces count together.
    //
    // She is ALSO told in the chat now (bd-rw4so): the envelope returned below
    // is not rendered by Meta, so without this she reads only "Something went
    // wrong. Try again later." for the one state she most needs named — the
    // Rule 24(d) misdirection that sent a whole fix cycle at the wrong layer
    // in bd-s192t. The notice is send-once; the LOG still fires on every
    // refusal, because suppressing the count would defeat what it exists for.
    const message = observeStrings(lang).flow_terminal_refused;
    const notified = await tellCoachRefused(userId, sessionId, message);
    logToFile('\u{1F6AB} observe-form: endpoint refused — the observation is over', {
      sessionId, status: session.status, tap, notified,
    });
    return { error: message };
  }
  return { session, sessionId, userId };
}

async function bufferEdits(sessionId, screenData) {
  const edits = {};
  Object.entries(screenData || {}).forEach(([k, v]) => {
    // fid_ = the v4 per-move fidelity fields (bd-c5zs1): fid_r_k verdict radios
    // and fid_e_k evidence boxes, applied by rescoreFidelityFromEdits on submit.
    if (/^(r|ev|imp|fid)_/.test(k)) edits[k] = v;
  });
  let existing = {};
  try {
    // railway-redis get() auto-parses JSON — returns an object (or raw string
    // fallback). Same contract gotcha as observe-state (caught live 2026-07-12).
    const raw = await redisService.get(editsKey(sessionId));
    if (raw) existing = typeof raw === 'object' ? raw : JSON.parse(raw);
  } catch (e) { /* corrupt buffer → start fresh */ }
  const merged = { ...existing, ...edits };
  await redisService.setexWithCeiling(editsKey(sessionId), EDITS_TTL, JSON.stringify(merged));
  return merged;
}

/**
 * @param {object} decrypted decrypted Flow request { action, flow_token, screen, data }
 * @returns {object} Flow response ({ screen, data } | { data:{error} }) — never with `version`
 */
async function handleObserveMewakaRequest(decrypted) {
  const { action, flow_token: flowToken, data = {}, screen } = decrypted || {};
  try {
    if (action === 'ping') return { data: { status: 'active' } };

    // the action is carried in so the refusal event says WHICH surface she used
    const loaded = await loadSessionFromToken(flowToken, action);
    if (loaded.error) return errorResponse(loaded.error);
    const { session, sessionId } = loaded;

    if (action === 'INIT') {
      // bd-59: the first domain comes from the PACK — 'introduction' is a
      // mewaka key and crashed every HOTS open (the bd-52 refactor converted
      // BACK/data_exchange to domainKeyForScreen but missed this branch).
      const first = packScreens().screens[0];
      return {
        screen: first,
        data: ObserveDraft.buildScreenPrefill(session.analysis_data, domainKeyForScreen(first), await coachLanguageIfNeeded(session)),
      };
    }

    if (action === 'BACK') {
      // FEAT-102: fall back to the pack's FIRST screen, not the mewaka 'DOMAIN_A'
      // hardcode (FICO starts at DOMAIN_B).
      const target = packScreens().screens.includes(screen) ? screen : packScreens().screens[0];
      return {
        screen: target,
        data: ObserveDraft.buildScreenPrefill(session.analysis_data, domainKeyForScreen(target), await coachLanguageIfNeeded(session)),
      };
    }

    if (action === 'data_exchange') {
      const currentScreen = data._screen;
      if (!packScreens().screens.includes(currentScreen)) return errorResponse('Unknown screen');
      const merged = await bufferEdits(sessionId, data);

      if (currentScreen === packScreens().last) {
        const applied = await ObserveDraft.applyObserverEdits(sessionId, merged);
        if (applied && applied.refused) {
          // Went terminal between the load above and the write. Do not reach
          // SUCCESS: the SUCCESS screen's extension_message_response is what
          // starts the teacher-report chain.
          let lang = 'en';
          try {
            const { languageFor } = require('../services/observe/observe-language');
            lang = await languageFor('coach', session);
          } catch (_) { /* the refusal must never depend on a language lookup */ }
          return errorResponse(observeStrings(lang).flow_terminal_refused);
        }
        await redisService.delete(editsKey(sessionId));
        return {
          screen: 'SUCCESS',
          data: {
            session_id: sessionId,
            extension_message_response: {
              params: { observe_action: 'submitted', session_id: sessionId, flow_token: flowToken },
            },
          },
        };
      }

      const next = nextScreen(currentScreen);
      return {
        screen: next,
        data: ObserveDraft.buildScreenPrefill(session.analysis_data, domainKeyForScreen(next), await coachLanguageIfNeeded(session)),
      };
    }

    return errorResponse('Unsupported action');
  } catch (err) {
    logToFile('❌ observe-mewaka endpoint error', { error: err.message, action });
    return errorResponse('Something went wrong — please try again.');
  }
}

module.exports = { handleObserveMewakaRequest };
