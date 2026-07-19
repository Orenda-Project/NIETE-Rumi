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

function errorResponse(message) {
  return { data: { error: { message } } };
}

async function loadSessionFromToken(flowToken) {
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
  return { session, sessionId, userId };
}

async function bufferEdits(sessionId, screenData) {
  const edits = {};
  Object.entries(screenData || {}).forEach(([k, v]) => {
    if (/^(r|ev|imp)_/.test(k)) edits[k] = v;
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

    const loaded = await loadSessionFromToken(flowToken);
    if (loaded.error) return errorResponse(loaded.error);
    const { session, sessionId } = loaded;

    if (action === 'INIT') {
      // bd-59: the first domain comes from the PACK — 'introduction' is a
      // mewaka key and crashed every HOTS open (the bd-52 refactor converted
      // BACK/data_exchange to domainKeyForScreen but missed this branch).
      const first = packScreens().screens[0];
      return {
        screen: first,
        data: ObserveDraft.buildScreenPrefill(session.analysis_data, domainKeyForScreen(first)),
      };
    }

    if (action === 'BACK') {
      // FEAT-102: fall back to the pack's FIRST screen, not the mewaka 'DOMAIN_A'
      // hardcode (FICO starts at DOMAIN_B).
      const target = packScreens().screens.includes(screen) ? screen : packScreens().screens[0];
      return {
        screen: target,
        data: ObserveDraft.buildScreenPrefill(session.analysis_data, domainKeyForScreen(target)),
      };
    }

    if (action === 'data_exchange') {
      const currentScreen = data._screen;
      if (!packScreens().screens.includes(currentScreen)) return errorResponse('Unknown screen');
      const merged = await bufferEdits(sessionId, data);

      if (currentScreen === packScreens().last) {
        await ObserveDraft.applyObserverEdits(sessionId, merged);
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
        data: ObserveDraft.buildScreenPrefill(session.analysis_data, domainKeyForScreen(next)),
      };
    }

    return errorResponse('Unsupported action');
  } catch (err) {
    logToFile('❌ observe-mewaka endpoint error', { error: err.message, action });
    return errorResponse('Something went wrong — please try again.');
  }
}

module.exports = { handleObserveMewakaRequest };
