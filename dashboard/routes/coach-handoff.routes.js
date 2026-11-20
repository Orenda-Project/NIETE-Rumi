'use strict';
/**
 * bd-9652yj (queue #166) — the coach app's way back to WhatsApp: a short code for the visit she is on.
 * Mounted at /api/portal by dashboard/index.js (one line), beside the other small routers.
 *
 *   POST /api/portal/coach/handoff   { screen, visitId? }
 *     200 { success: true, code, bot }   bot: THIS deployment's WhatsApp number (app-login.routes botNumber; null when
 *                                        unset), so the app opens this tier's chat. code: 5 characters (bot/shared/services/coach-handoff-code.js), stored 24 h in the
 *                                        Redis the bot shares: { u, v?, s, j, at }
 *     200 { success: true, code: null }  no Redis here: the app still opens the chat, and the bot runs plain /observe
 *     401                                signed out
 *     404 { success: false, error }      not a coach on the coach app (lib/feature-flags isCoachAppUser)
 *
 * The app ("Continue on WhatsApp", portal coach/observe/ContinueOnWhatsApp.tsx) then opens the chat with
 * "Continue my visit on WhatsApp (code V4KQ7)" typed; the bot resumes that visit only for the same coach.
 *
 * WHO SAYS WHO. The coach is the SESSION's (a body id is ignored). The visit is kept only when it is hers
 * (observation_schedules.leader_user_id). The journey is the session's (app-funnel.routes.js). Ids only: no name, no
 * phone, nothing she typed. Logged as app_funnel.handoff_code. Never throws to the page.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { isCoachAppUser } = require('../lib/feature-flags');
const edgeRedis = require('../lib/edge-redis');
const telemetry = require('../services/telemetry.service');
const { requirePortalAuth } = require('../lib/portal-auth');
const { handoffKey, newCode, HANDOFF_TTL_S, HANDOFF_SCREENS } = require('../../bot/shared/services/coach-handoff-code');
const { isJourneyId, JOURNEY_TTL_MS } = require('../../bot/shared/services/app-journey');
const { botNumber } = require('./app-login.routes');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIES = 3;

const router = express.Router();

async function requireCoachApp(req, res, next) {
  let on = false;
  try { on = await isCoachAppUser(supabase, req.session.portalUserId); } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

/** The journey /go started, while it still counts (the same rule as app-funnel.routes.js). */
function journeyOf(session, now) {
  const j = session && session.appJourney;
  if (!j || !isJourneyId(j.id) || !Number.isFinite(j.at)) return null;
  if (now - j.at >= JOURNEY_TTL_MS || j.at > now + 60 * 1000) return null;
  return j.id;
}

/** Her visit's id, when the body names one of hers; null otherwise (never an error). */
async function ownVisit(userId, raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!UUID_RX.test(id)) return null;
  try {
    const { data, error } = await supabase.from('observation_schedules')
      .select('id, leader_user_id')
      .eq('id', id)
      .eq('leader_user_id', userId)
      .maybeSingle();
    return !error && data && data.leader_user_id === userId ? data.id : null;
  } catch (_) {
    return null;
  }
}

/** Store the payload under a fresh code; null when Redis is not there. A taken code (rare) draws again. */
async function mint(payload) {
  for (let i = 0; i < TRIES; i += 1) {
    const code = newCode();
    const taken = await edgeRedis.get(handoffKey(code));
    if (taken) continue;
    if (await edgeRedis.set(handoffKey(code), JSON.stringify(payload), HANDOFF_TTL_S)) return code;
    return null;
  }
  return null;
}

router.post('/coach/handoff', requirePortalAuth, requireCoachApp, async (req, res) => {
  const userId = req.session.portalUserId;
  const now = Date.now();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const screen = HANDOFF_SCREENS.includes(body.screen) ? body.screen : 'observe';
  let code = null;
  let visit = null;
  const journeyId = journeyOf(req.session, now);
  try {
    visit = await ownVisit(userId, body.visitId);
    code = await mint({ u: userId, ...(visit ? { v: visit } : {}), s: screen, j: journeyId, at: new Date(now).toISOString() });
  } catch (_) {
    code = null;
  }
  // A funnel row: users.id is the key the bot's and the portal's app_funnel rows join on (app-funnel.routes.js who()).
  const row = { userId, journeyId, feature: 'observe', screen, visit: Boolean(visit), code: Boolean(code) };
  try {
    telemetry.logEvent('app_funnel.handoff_code', row);
  } catch (_) { /* logging never decides the response */ }
  return res.json({ success: true, code, bot: botNumber() });
});

module.exports = router;
