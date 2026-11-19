'use strict';
/**
 * The team view in Analytics — "Where teachers get to" (LP tab, Primary). Created by portal.routes.js with ITS
 * analytics-account guard and scope, so these routes turn away exactly whom every analytics route turns away.
 *
 *   GET /analytics/journey[?region=]                 → { success, ready:true, updatedAt, windowDays, tracked,
 *                                                       steps:[{ step, reached, stopped }], largestDrop } | { ready:false }
 *   GET /analytics/journey/teachers?step=[&region=]  → { success, ready, teachers:[{ id, name, school, lastKind, lastAt }] }
 *   GET /analytics/journey/teacher/:id               → { success, ready, name, school, updatedAt, steps } — read-only
 *
 * Read from the activity store ONLY (docs/teacher-activity-store.md): the team key's roster says each teacher's
 * organization and region, so the account sees its own organization's teachers (services/teacher-journey-view.service
 * inScope) without a database read. A teacher outside that scope, or not on the roster, is 404 and her key is not read.
 * Guards, in order: no session 401 → not an analytics account 403 (requireAnalyticsViewer) → portal_teacher_journey off
 * for the account 404. Logs carry no user id.
 */
const express = require('express');
const { isTeacherJourneyOn } = require('../lib/lp-app-switches');
const Store = require('../services/teacher-activity-store');
const View = require('../services/teacher-journey-view.service');

const NOT_FOUND = Object.freeze({ success: false, error: 'Not found' });

function createAnalyticsJourneyRouter({ supabase, requirePortalAuth, requireAnalyticsViewer, analyticsScope }) {
  const router = express.Router();

  async function requireJourney(req, res, next) {
    let on = false;
    try { on = await isTeacherJourneyOn(supabase, req.session.portalUserId); } catch (_) { on = false; }
    if (!on) return res.status(404).json(NOT_FOUND);
    return next();
  }
  const guards = [requirePortalAuth, requireAnalyticsViewer, requireJourney];

  /** scope + region + the team value, or an answer already sent (null). */
  async function load(req, res) {
    const scope = await analyticsScope(req);
    const region = View.parseRegion(scope, req.query.region);
    if (!region.ok) { res.status(400).json({ success: false, error: 'Unknown region.' }); return null; }
    return { scope, region: region.region, team: await Store.readTeamActivity() };
  }

  const handle = (name, fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error(`analytics/${name} error:`, error && error.message);
      res.status(500).json({ success: false, error: 'Failed to load the journey view.' });
    }
  };

  router.get('/analytics/journey', ...guards, handle('journey', async (req, res) => {
    const got = await load(req, res);
    if (!got) return;
    if (!got.team) { res.json({ success: true, ready: false }); return; }
    res.json({
      success: true, ready: true, updatedAt: got.team.updated_at, windowDays: got.team.window_days,
      region: got.region, ...View.teamView(got.team, got.scope, { region: got.region }),
    });
  }));

  router.get('/analytics/journey/teachers', ...guards, handle('journey/teachers', async (req, res) => {
    const step = String(req.query.step || '');
    if (!View.TEAM_STEPS.includes(step)) { res.status(400).json({ success: false, error: 'Unknown step.' }); return; }
    const got = await load(req, res);
    if (!got) return;
    if (!got.team) { res.json({ success: true, ready: false, teachers: [] }); return; }
    res.json({ success: true, ready: true, step, teachers: View.stoppedAt(got.team, got.scope, step, { region: got.region }) });
  }));

  router.get('/analytics/journey/teacher/:id', ...guards, handle('journey/teacher', async (req, res) => {
    const scope = await analyticsScope(req);
    const team = await Store.readTeamActivity();
    const id = String(req.params.id || '');
    const entry = team && team.teachers && Object.prototype.hasOwnProperty.call(team.teachers, id) ? team.teachers[id] : null;
    if (!entry || !View.inScope(entry, scope)) { res.status(404).json(NOT_FOUND); return; }
    const value = await Store.readTeacherActivity(id);
    const who = { name: entry.name, school: entry.school };
    if (!value) { res.json({ success: true, ready: false, ...who }); return; }
    res.json({ success: true, ready: true, ...who, updatedAt: value.updated_at, steps: View.journeySteps(value) });
  }));

  return router;
}

module.exports = { createAnalyticsJourneyRouter };
