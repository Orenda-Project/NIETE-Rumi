'use strict';
/**
 * bd-33wxxi.2 — the principal app's school API (the principal portal revamp, behind portal_principal_app).
 *
 *   GET /principal/school/card?period=&level=   her OWN school's card: the coach School Card read through her
 *                                               users.school_id (services/coach-school-card.service.js
 *                                               getPrincipalSchoolCard), counts only — the Home's "My school" card
 *                                               and Analytics › My school read it
 *
 * Guards, in order: the ones it is given (portal.routes: requirePortalAuth) → the principal app on for her
 * (lib/teacher-app.js isPrincipalAppUser: the switch names her AND users.role principal) else 404 with nothing read →
 * her school from her own users row (lib/leader-role.js principalSchoolOf). Her row names no school: 200 { school:
 * null } (192 principals on prod), so the app says so instead of failing. The school is NEVER taken from the request.
 *
 * period = today | week | month (default week), Pakistan days; anything else 400 (the coach card's rule and helper).
 */
const express = require('express');
const { parsePeriodKey } = require('../lib/school-card-period');
const { isPrincipalAppUser } = require('../lib/teacher-app');
const { principalSchoolOf } = require('../lib/leader-role');
const { todayOf } = require('./coach-school-card.routes');

const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });

/**
 * @param {{ guards?: Function[], supabase: object, query: Function, card?: object, now?: () => Date }} deps
 *   card: the School Card service (injected in tests; the real one otherwise)
 */
function createPrincipalRouter(deps) {
  const { guards = [], supabase, query, now } = deps;
  const Card = deps.card || require('../services/coach-school-card.service');
  const router = express.Router();

  async function requirePrincipalApp(req, res, next) {
    let on = false;
    try { on = await isPrincipalAppUser(supabase, req.session.portalUserId); } catch (_) { on = false; }
    if (!on) return notFound(res);
    return next();
  }

  router.get('/principal/school/card', ...guards, requirePrincipalApp, async (req, res) => {
    const period = parsePeriodKey(req.query && req.query.period);
    if (!period) return res.status(400).json({ success: false, error: 'Unknown period: use today, week or month' });
    res.set('Cache-Control', 'private, no-store');
    const userId = req.session.portalUserId;
    try {
      const mine = await principalSchoolOf(supabase, userId, { strict: true });
      if (!mine) return notFound(res);
      if (!mine.schoolId) return res.json({ success: true, school: null });
      const level = req.query && typeof req.query.level === 'string' ? req.query.level : null;
      const out = await Card.getPrincipalSchoolCard(query, userId, { period, today: todayOf(req, now), ...(level ? { level } : {}) });
      if (!out) return notFound(res);
      return res.json({ success: true, ...out });
    } catch (err) {
      console.error('principal/school/card error:', err && err.message);
      return res.status(500).json({ success: false, error: 'Could not load this page.' });
    }
  });

  return router;
}

module.exports = { createPrincipalRouter };
