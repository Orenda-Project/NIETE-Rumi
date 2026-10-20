'use strict';
/**
 * bd-tbprit.1 — the coach's disagreements API (v10 coaching test, C/D teachers who answered "Not accurate").
 * Behind the coach app's guards and its own flag, coach_disagreement_card: off unless set, and a flag read
 * that fails is off. Off for her, every route is a 404 — week 1 of the test sees nothing new.
 *
 *   GET  /coach/disagreements              { todo, done } for the logged-in coach
 *   GET  /coach/disagreements/:id          { card } — 404 unless it is hers; stamps it opened (bd-tbprit.7, the
 *                                          list's blue dot) — a failed stamp is logged, the card still served
 *   POST /coach/disagreements/:id/visited  "I have visited" — hers only, one-way (no undo route: the
 *                                          tracker's visited_7d counts it)
 *   GET  /coach/disagreements/:id/clip?at=[&to=] bd-tbprit.2 (to: bd-tbprit.9): the disputed step as mp3, hers only, inline and never
 *                                          cached; 503 when ffmpeg fails, which the card survives
 */
const express = require('express');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });
const failed = (res) => res.status(500).json({ success: false, error: 'Something went wrong' });
const { parseAt } = require('../services/coach-disagreement-clip');

function createCoachDisagreementsRouter(deps) {
  const { guards = [], isOn, list, card, ownerOf, markVisited, markOpened = async () => {}, recordingFor, openClip } = deps;
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
      if (!(await markVisited(req.params.id))) return failed(res);
      return res.json({ success: true, done: true });
    } catch (err) {
      console.error('[coach-disagreements] visited failed:', err.message);
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
