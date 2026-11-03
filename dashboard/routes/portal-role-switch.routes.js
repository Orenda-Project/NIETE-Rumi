'use strict';
/**
 * bd-tacnwy — internal staff switch their OWN profile type from the portal. Mounted at /api/portal by
 * dashboard/index.js (one line), beside the other /me routers, so it shares the portal's CORS / rate-limit / session.
 *
 *   POST /api/portal/me/role   { role: 'teacher' | 'coach' | 'principal' }
 *     200 { success, changed: false, role }                                   already that role: nothing written
 *     200 { success, changed: true, from, to, cleared, redis, correlationId } switched; the app reloads into /portal
 *     400 { success: false, error, roles }                                    not one of the three
 *     401                                                                     signed out
 *     404 { success: false, error: 'Not found' }                              not on app_settings.portal_role_switch
 *     502                                                                     the write failed; nothing changed
 *
 * Who: a users.id named on portal_role_switch (lib/feature-flags.js isRoleSwitchUser: list-only, fail closed). Every
 * other account — every real teacher and coach — gets the same 404 an unknown path gets, and GET /config tells the
 * app not to draw the control. The user is ALWAYS the session's; a body id is ignored.
 *
 * What a switch does, and why each step: services/role-switch.service.js. The audit is the record_history row the
 * users_history_trigger writes, attributed to her through x-rumi-actor. Nothing here sends a WhatsApp message.
 */
const crypto = require('crypto');
const express = require('express');
const supabase = require('../config/supabase');
const { isRoleSwitchUser, ROLE_SWITCH_ROLES } = require('../lib/feature-flags');
const edgeRedis = require('../lib/edge-redis');
const RoleSwitch = require('../services/role-switch.service');
const telemetry = require('../services/telemetry.service');

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

const router = express.Router();

async function requireRoleSwitch(req, res, next) {
  let on = false;
  try {
    on = await isRoleSwitchUser(supabase, req.session.portalUserId);
  } catch (_) {
    on = false; // a failed read is OFF, as every flag read is
  }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

/** 'teacher' | 'coach' | 'principal', or null for anything else. */
function parseRole(raw) {
  if (typeof raw !== 'string') return null;
  const role = raw.trim().toLowerCase();
  return ROLE_SWITCH_ROLES.includes(role) ? role : null;
}

router.post('/me/role', requirePortalAuth, requireRoleSwitch, async (req, res) => {
  const userId = req.session.portalUserId;
  const to = parseRole(req.body && req.body.role);
  if (!to) {
    return res.status(400).json({ success: false, error: 'That profile type is not available.', roles: [...ROLE_SWITCH_ROLES] });
  }
  const correlationId = crypto.randomUUID();
  try {
    const { data: user, error } = await supabase.from('users').select('id, role').eq('id', userId).maybeSingle();
    if (error || !user) throw new Error((error && error.message) || 'users row not found');
    const from = typeof user.role === 'string' ? user.role.trim().toLowerCase() : null;
    if (from === to) return res.json({ success: true, changed: false, role: to });

    await RoleSwitch.writeRole(userId, to);
    const { redis, cleared } = await RoleSwitch.clearFlowKeys(edgeRedis, userId);

    console.log(`🔁 Portal role switch: ${JSON.stringify({ correlationId, userId, from, to, redisCleared: cleared.length, redis })}`);
    try {
      telemetry.logEvent('portal_role_switch', { correlationId, userId, from, to, redisCleared: cleared.length, redis });
    } catch (_) { /* logging never decides the response */ }

    return res.json({ success: true, changed: true, from, to, cleared, redis, correlationId });
  } catch (err) {
    console.error(`❌ Portal role switch failed: ${JSON.stringify({ correlationId, userId, to, error: String((err && err.message) || err).slice(0, 200) })}`);
    return res.status(502).json({ success: false, error: 'Could not switch your profile. Please try again.' });
  }
});

module.exports = router;
