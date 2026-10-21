'use strict';
/**
 * bd-tbprit.1 — the coach's disagreements API (v10 coaching test, C/D teachers who answered "Not accurate").
 * Behind the coach app's guards and its own flag, coach_disagreement_card: off unless set, and a flag read
 * that fails is off. Off for her, every route is a 404 — week 1 of the test sees nothing new.
 *
 *   GET  /coach/disagreements              { todo, done } for the logged-in coach
 *   GET  /coach/disagreements/:id          { card } — 404 unless it is hers; stamps it opened (bd-tbprit.7, the
 *                                          list's blue dot) — a failed stamp is logged, the card still served
 *   POST /coach/disagreements/:id/visited  "✓ Mark as done" — hers only (bd-tbprit.12)
 *   POST /coach/disagreements/:id/undone   "Move back to To do" — hers only; undoes Done (bd-tbprit.12)
 *   GET  /coach/disagreements/:id/clip?at=[&to=] bd-tbprit.2 (to: bd-tbprit.9): the disputed step as mp3, hers only, inline and never
 *                                          cached; 503 when ffmpeg fails, which the card survives
 *   POST /coach/disagreements/:id/plan     bd-tbprit.11: the coaching box's choices, hers only → { plan }
 *   POST /coach/disagreements/:id/suggestion { found: 0-3 } bd-tbprit.11: the AI-tailored suggestion, hers only;
 *                                          null when the AI failed, so the page keeps its template
 */
const express = require('express');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });
const failed = (res) => res.status(500).json({ success: false, error: 'Something went wrong' });
const { parseAt } = require('../services/coach-disagreement-clip');

function createCoachDisagreementsRouter(deps) {
  const {
    guards = [], isOn, list, card, ownerOf, markVisited, markUndone, markOpened = async () => {}, recordingFor, openClip, savePlan, suggestion,
  } = deps;
  const router = express.Router();

  const gate = async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const uid = req.session && req.session.portalUserId;
    let on = false;
    try { on = !!uid && (await isOn(uid)) === true; } catch (_) { on = false; }
    if (!on) return notFound(res);
    req.coachId = uid;
    return next();
  };
  const idOk = (req, res, next) => (UUID.test(req.params.id) ? next() : notFound(res));
  const body = express.json({ limit: '4kb' });

  router.get('/coach/disagreements', ...guards, gate, async (req, res) => {
    try {
      const { todo, done } = await list(req.coachId);
      return res.json({ success: true, todo, done });
    } catch (err) {
      console.error('[coach-disagreements] list failed:', err.message);
      return failed(res);
    }
  });

  router.get('/coach/disagreements/:id', ...guards, gate, idOk, async (req, res) => {
    try {
      const c = await card(req.coachId, req.params.id);
      if (!c) return notFound(res);
      try { await markOpened(req.coachId, req.params.id); } catch (err) {
        console.error('[coach-disagreements] opened stamp failed:', err.message);
      }
      return res.json({ success: true, card: c });
    } catch (err) {
      console.error('[coach-disagreements] card failed:', err.message);
      return failed(res);
    }
  });

  router.post('/coach/disagreements/:id/visited', ...guards, gate, idOk, async (req, res) => {
    try {
      if ((await ownerOf(req.params.id)) !== req.coachId) return notFound(res);
      if (!(await markVisited(req.params.id, req.coachId))) return failed(res);
      return res.json({ success: true, done: true });
    } catch (err) {
      console.error('[coach-disagreements] visited failed:', err.message);
      return failed(res);
    }
  });

  router.post('/coach/disagreements/:id/undone', ...guards, gate, idOk, async (req, res) => {
    try {
      if ((await ownerOf(req.params.id)) !== req.coachId) return notFound(res);
      if (!(await markUndone(req.params.id, req.coachId))) return failed(res);
      return res.json({ success: true, done: false });
    } catch (err) {
      console.error('[coach-disagreements] undone failed:', err.message);
      return failed(res);
    }
  });

  router.post('/coach/disagreements/:id/plan', ...guards, gate, idOk, body, async (req, res) => {
    try {
      const plan = await savePlan(req.coachId, req.params.id, req.body || {});
      if (!plan) return notFound(res);
      return res.json({ success: true, plan });
    } catch (err) {
      console.error('[coach-disagreements] plan failed:', err.message);
      return failed(res);
    }
  });

  router.post('/coach/disagreements/:id/suggestion', ...guards, gate, idOk, body, async (req, res) => {
    const found = req.body && req.body.found;
    if (!Number.isInteger(found) || found < 0 || found > 3) return res.status(400).json({ success: false, error: 'Bad answer' });
    try {
      const s = await suggestion(req.coachId, req.params.id, found);
      if (s === undefined) return notFound(res);
      return res.json({ success: true, suggestion: s });
    } catch (err) {
      console.error('[coach-disagreements] suggestion failed:', err.message);
      return failed(res);
    }
  });

  router.get('/coach/disagreements/:id/clip', ...guards, gate, idOk, async (req, res) => {
    const at = parseAt(req.query.at);
    const to = req.query.to == null ? null : parseAt(req.query.to);
    if (at == null || (req.query.to != null && to == null)) return res.status(400).json({ success: false, error: 'Bad time' });
    let url;
    try { url = await recordingFor(req.coachId, req.params.id); } catch (err) {
      console.error('[coach-disagreements] clip lookup failed:', err.message);
      return failed(res);
    }
    if (!url) return notFound(res);
    let clip;
    try { clip = await openClip(url, at, to); } catch (err) {
      console.error('[coach-disagreements] clip failed:', err.message);
      return res.status(503).json({ success: false, error: 'Clip unavailable' });
    }
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Disposition': 'inline' });
    res.write(clip.first);
    req.on('close', () => { if (!res.writableEnded) { try { clip.proc.kill('SIGKILL'); } catch (_) { /* gone */ } } });
    clip.stream.on('error', () => res.end());
    clip.stream.pipe(res);
    clip.stream.resume();
    return undefined;
  });

  return router;
}

module.exports = { createCoachDisagreementsRouter };
