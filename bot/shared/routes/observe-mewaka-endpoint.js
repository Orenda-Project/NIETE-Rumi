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
    logToFile('\u{1F6AB} observe-form: endpoint refused — the observation is over', {
      sessionId, status: session.status, tap,
    });
    return { error: observeStrings(lang).flow_terminal_refused };
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
