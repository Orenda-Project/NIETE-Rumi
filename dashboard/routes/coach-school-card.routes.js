'use strict';
/**
 * The coach School Card API (services/coach-school-card.service.js). Every route runs the guards it is given —
 * the coach app v2 chain and requireSchoolCard, from portal.routes — so with app_settings.portal_coach_school_card
 * off for her, each one is a 404, the same as a route that does not exist. Inputs are checked before any read.
 *
 *   GET /coach/school/:emis/card?period=                    one of her schools for the period
 *   GET /coach/school/:emis/feature/:feature?period=        lp | dc | training | papers, a row per teacher
 *   GET /coach/teacher/:ext/card?period=                    one teacher in her patch
 *   GET /coach/teacher/:ext/items/:feature?period=          dc | coach | lp | papers | training
 *   GET /coach/teacher/:ext/reports?period=                 her coaching reports
 *   GET /coach/session/:id                                  one DC report of a teacher in her patch
 *
 * period = today | week | month (default week), Pakistan days; anything else is 400. ?today=YYYY-MM-DD is taken
 * only within one day of the Pakistan date (for a page that shows its own day, and for tests).
 */
const express = require('express');
const Card = require('../services/coach-school-card.service');
const { parsePeriodKey, addDays } = require('../lib/school-card-period');
const { karachiToday } = require('../lib/visit-time');

const EMIS_RX = /^[A-Za-z0-9-]{1,32}$/;
const EXT_RX = /^\d{6,15}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;

const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });
const failed = (res, where, err) => {
  console.error(`coach/school-card ${where} error:`, err && err.message);
  return res.status(500).json({ success: false, error: 'Could not load this page.' });
};

/** The Pakistan day, or the page's own ?today= when it is a real date within a day of it. */
function todayOf(req, now) {
  const pk = karachiToday(now ? now() : undefined);
  const asked = req.query && req.query.today;
  if (typeof asked !== 'string' || !DAY_RX.test(asked)) return pk;
  if (new Date(`${asked}T00:00:00Z`).toISOString().slice(0, 10) !== asked) return pk;
  return asked === pk || asked === addDays(pk, -1) || asked === addDays(pk, 1) ? asked : pk;
}

/**
 * @param {{ guards?: Function[], query: Function, memo?: object, now?: () => Date }} deps
 */
function createCoachSchoolCardRouter(deps) {
  const { guards = [], query, memo, now } = deps;
  const router = express.Router();

  const optsOf = (req, res) => {
    const period = parsePeriodKey(req.query && req.query.period);
    if (!period) {
      res.status(400).json({ success: false, error: 'Unknown period: use today, week or month' });
      return null;
    }
    res.set('Cache-Control', 'private, no-store');
    return { period, today: todayOf(req, now), ...(memo ? { memo } : {}) };
  };
  const coach = (req) => req.session.portalUserId;
  const answer = async (res, where, load) => {
    try {
      const out = await load();
      if (!out) return notFound(res);
      return res.json({ success: true, ...out });
    } catch (err) {
      return failed(res, where, err);
    }
  };

  router.get('/coach/school/:emis/card', ...guards, async (req, res) => {
    const emis = String(req.params.emis || '');
    if (!EMIS_RX.test(emis)) return notFound(res);
    const opts = optsOf(req, res);
    if (!opts) return undefined;
    return answer(res, 'school', () => Card.getSchoolCard(query, coach(req), emis, opts));
  });

  router.get('/coach/school/:emis/feature/:feature', ...guards, async (req, res) => {
    const emis = String(req.params.emis || '');
    const feature = String(req.params.feature || '');
    if (!EMIS_RX.test(emis) || !Card.FEATURES.includes(feature)) return notFound(res);
    const opts = optsOf(req, res);
    if (!opts) return undefined;
    return answer(res, 'feature', () => Card.getSchoolFeature(query, coach(req), emis, feature, opts));
  });

  router.get('/coach/teacher/:ext/card', ...guards, async (req, res) => {
    const ext = String(req.params.ext || '');
    if (!EXT_RX.test(ext)) return notFound(res);
    const opts = optsOf(req, res);
    if (!opts) return undefined;
    return answer(res, 'teacher', () => Card.getTeacherCard(query, coach(req), ext, opts));
  });

  router.get('/coach/teacher/:ext/items/:feature', ...guards, async (req, res) => {
    const ext = String(req.params.ext || '');
    const feature = String(req.params.feature || '');
    if (!EXT_RX.test(ext) || !Card.ITEM_FEATURES.includes(feature)) return notFound(res);
    const opts = optsOf(req, res);
    if (!opts) return undefined;
    return answer(res, 'items', () => Card.getTeacherItems(query, coach(req), ext, feature, opts));
  });

  router.get('/coach/teacher/:ext/reports', ...guards, async (req, res) => {
    const ext = String(req.params.ext || '');
    if (!EXT_RX.test(ext)) return notFound(res);
    const opts = optsOf(req, res);
    if (!opts) return undefined;
    return answer(res, 'reports', () => Card.getTeacherReports(query, coach(req), ext, opts));
  });

  router.get('/coach/session/:id', ...guards, async (req, res) => {
    const id = String(req.params.id || '');
    if (!UUID_RX.test(id)) return notFound(res);
    const opts = optsOf(req, res);
    if (!opts) return undefined;
    return answer(res, 'session', () => Card.getSession(query, coach(req), id, opts));
  });

  return router;
}

module.exports = { createCoachSchoolCardRouter, todayOf };
