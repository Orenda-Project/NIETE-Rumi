'use strict';
/**
 * bd-snkn32.59 (queue #165) — "Make my own → A whole unit" (grades 1–5, from her book's chapters). Mounted at /api/portal
 * beside portal-lp612-own.routes.js. Every rule is in lp-own-unit.service; this passes the SESSION's user only.
 *
 *   GET  /lp/own/unit/chapters?grade&subject                 → { success, book, chapters: [{ number, title, days }], period }
 *   GET  /lp/own/unit/paces?grade&subject&from&to&period     → { success, counts: { recommended, slower, faster|null } }
 *   POST /lp/own/units  { grade, subject, classId?, from, to, period, pace, outline? }  → 201 { success, unit }
 *   GET  /lp/own/units                                       → { success, units }
 *   GET  /lp/own/units/:id                                   → { success, unit: { …, days: [{ day, kind, …, plan }], next } }
 *   PUT  /lp/own/units/:id  { pace?, period?, outline? }      → { success, unit } | 409 { outcome: 'locked' }
 *   POST /lp/own/units/:id/days/:day/open  { answers }       → 202 { success, state: 'authoring', renderId } (one make)
 *                                                              | { success, outcome: 'book', lessonId } (review/test: the
 *                                                                book's ready day, no model call)
 *                                                              | { success, outcome: 'made', ownId, status }
 *
 * Dark (404) unless the teacher app, portal_lp_make_own AND the LIST-ONLY portal_lp_own_unit are on for her, and she is
 * not a GB teacher. Actions logged ids-only (own_unit.*): never her answers.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY, PORTAL_LP_MAKE_OWN_KEY, isFlagEnabledForUser } = require('../lib/feature-flags');
const { isGbTeacher } = require('../../bot/shared/services/lp-own-gb');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { requirePortalAuth } = require('../lib/portal-auth');
const { logAppAction } = require('./app-funnel.routes');
const { unitOn, createUnitStore } = require('../../bot/shared/services/lp-own-unit.store');
const { createUnitService } = require('../../bot/shared/services/lp-own-unit.service');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = { ok: 200, bad_request: 400, not_found: 404, locked: 409 };

async function requireUnit(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = (await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId))
      && (await isFlagEnabledForUser(supabase, PORTAL_LP_MAKE_OWN_KEY, userId))
      && (await unitOn(supabase, userId))
      && !(await isGbTeacher(supabase, userId));
  } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

/** A day's plan is the existing own-plan make (the bot holds every rule, the daily limit included). */
async function makeDay({ userId, lessonId, answers }) {
  const axios = require('axios');
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('LP API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  const r = await axios.post(`${baseUrl}/api/internal/lp612/own`, { userId, lessonId, answers },
    { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 20000, validateStatus: () => true });
  if (r.status === 202 && r.data && r.data.success && r.data.renderId) return { outcome: 'queued', renderId: r.data.renderId };
  if (r.status === 409 && r.data && r.data.outcome) return { outcome: 'refused', refusal: String(r.data.outcome) };
  if ([400, 404].includes(r.status)) return { outcome: 'bad_request', error: 'Could not make that day' };
  throw new Error(`lp612/own failed (HTTP ${r.status})`);
}

let live = null;
function service() {
  live = live || createUnitService({
    bookFor: (grade, subject) => require('../../bot/shared/services/lp-v8-catalog.service').bookFor(grade, subject),
    // The day's own minutes live in its stored script, which only the bot reads (its modules need pino, never loaded
    // here). Until the bot answers it, no split for a short period: the outline is the book's days.
    bookMinutes: async () => null,
    store: createUnitStore(supabase),
    makeDay,
  });
  return live;
}

/** Send a service answer: its outcome picks the status; the rest of it is the body. */
function send(res, out, okStatus = 200) {
  const { outcome, ...rest } = out;
  if (outcome === 'ok') return res.status(okStatus).json({ success: true, ...rest });
  if (STATUS[outcome]) return res.status(STATUS[outcome]).json({ success: false, outcome, ...(rest.error ? { error: rest.error } : {}) });
  return res.status(502).json({ success: false, error: 'Could not do that' });
}

function guarded(label, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res, req.session.portalUserId);
    } catch (error) {
      console.error(`❌ Portal ${label} failed`, { error: error && error.message });
      return res.status(502).json({ success: false, error: 'Could not do that' });
    }
  };
}

const idOk = (req, res) => (UUID.test(req.params.id) ? true : (res.status(404).json({ success: false, error: 'Not found' }), false));
const q = (req) => req.query || {};

router.get('/lp/own/unit/chapters', requirePortalAuth, requireUnit, guarded('own unit chapters', async (req, res, userId) => {
  send(res, await service().chapters({ userId, grade: q(req).grade, subject: q(req).subject }));
}));

router.get('/lp/own/unit/paces', requirePortalAuth, requireUnit, guarded('own unit paces', async (req, res) => {
  const { grade, subject, from, to, period } = q(req);
  send(res, await service().paces({ grade, subject, from: Number(from), to: Number(to), period: Number(period) }));
}));

router.post('/lp/own/units', requirePortalAuth, requireUnit, guarded('own unit create', async (req, res, userId) => {
  const b = req.body || {};
  const out = await service().create({
    userId, grade: b.grade, subject: b.subject, classId: UUID.test(String(b.classId || '')) ? b.classId : null,
    from: Number(b.from), to: Number(b.to), period: Number(b.period), pace: b.pace, outline: b.outline,
  });
  logAppAction(req, 'own_unit.create', 'lesson_plan', { outcome: out.outcome, ...(out.unit ? { unitId: out.unit.id, days: out.unit.days.length } : {}) });
  send(res, out, 201);
}));

router.get('/lp/own/units', requirePortalAuth, requireUnit, guarded('own unit list', async (req, res, userId) => {
  send(res, await service().list(userId));
}));

router.get('/lp/own/units/:id', requirePortalAuth, requireUnit, guarded('own unit read', async (req, res, userId) => {
  if (!idOk(req, res)) return;
  send(res, await service().read({ userId, id: req.params.id }));
}));

router.put('/lp/own/units/:id', requirePortalAuth, requireUnit, guarded('own unit update', async (req, res, userId) => {
  if (!idOk(req, res)) return;
  const b = req.body || {};
  const out = await service().update({ userId, id: req.params.id, pace: b.pace, period: b.period, outline: b.outline });
  logAppAction(req, 'own_unit.update', 'lesson_plan', { unitId: req.params.id, outcome: out.outcome });
  send(res, out);
}));

router.post('/lp/own/units/:id/days/:day/open', requirePortalAuth, requireUnit, guarded('own unit open day', async (req, res, userId) => {
  if (!idOk(req, res)) return;
  const answers = req.body && req.body.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ success: false, error: 'answers are required' });
  const out = await service().openDay({ userId, id: req.params.id, day: Number(req.params.day), answers });
  logAppAction(req, 'own_unit.open_day', 'lesson_plan', { unitId: req.params.id, day: Number(req.params.day), outcome: out.outcome, ...(out.renderId ? { ownId: out.renderId } : {}) });
  if (out.outcome === 'queued') return res.status(202).json({ success: true, state: 'authoring', renderId: out.renderId });
  if (out.outcome === 'book') return res.json({ success: true, outcome: 'book', lessonId: out.lessonId });
  if (out.outcome === 'made') return res.json({ success: true, outcome: 'made', ownId: out.ownId, status: out.status });
  if (out.outcome === 'refused') return res.status(409).json({ success: false, outcome: out.refusal });
  return send(res, out);
}));

module.exports = router;
