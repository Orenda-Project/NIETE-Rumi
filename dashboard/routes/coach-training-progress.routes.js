'use strict';
/**
 * bd-rlxkkt.9 — Coach Training progress: which of the Coach Training modules (ten since bd-rlxkkt.12) a coach has marked done (the ICT HITL
 * owner, 6 Nov 2026: "when a coach completes a module she should get the complete option here").
 *
 *   GET /coach/coach-training/progress          → { success, done: { <module key>: <ISO time she marked it> } }
 *   PUT /coach/coach-training/progress/:key     body { done: true | false } → the same shape after the change
 *
 * WHERE IT IS KEPT: users.preferences.coach_training_done (jsonb that already exists, default {}). The modules are
 * pages outside the portal, not rows in training_modules, so teacher_training_progress (module_id → training_modules)
 * cannot hold them, and they need no table of their own. Other features keep their own keys in the same column
 * (observe_teachers, video_clips, observe_onboarding_arm), so a write is a read-merge-write of THIS key only.
 * The first time she marks a module is kept if she marks it again; undo removes it.
 *
 * IDENTITY: always req.session.portalUserId, never a body id. Every route runs the guards it is given (portal.routes:
 * signed in, leader role, coach app on); inputs are checked before any read or write.
 */
const express = require('express');

/** The Coach Training page's module keys, in order (portal coachTraining/modules.ts; a test pins the two). */
const MODULE_KEYS = Object.freeze(['praise', 'moment', 'asked', 'one', 'moves', 'own', 'less', 'rehearse', 'full', 'evidence']);
const PREF_KEY = 'coach_training_done';

const failed = (res, where, err) => {
  console.error(`coach/coach-training ${where} error:`, err && err.message);
  return res.status(500).json({ success: false, error: 'Could not save this.' });
};

/** Only the known modules, each with a string time. */
function doneOf(preferences) {
  const raw = preferences && typeof preferences === 'object' ? preferences[PREF_KEY] : null;
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of MODULE_KEYS) if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
  return out;
}

/**
 * @param {{ supabase: object, guards?: Function[], now?: () => Date }} deps
 */
function createCoachTrainingProgressRouter(deps) {
  const { supabase, guards = [], now = () => new Date() } = deps;
  const router = express.Router();

  const readPrefs = async (userId) => {
    const { data, error } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data && data.preferences && typeof data.preferences === 'object' ? data.preferences : {};
  };

  router.get('/coach/coach-training/progress', ...guards, async (req, res) => {
    try {
      const prefs = await readPrefs(req.session.portalUserId);
      return res.json({ success: true, done: doneOf(prefs) });
    } catch (err) {
      console.error('coach/coach-training progress read error:', err && err.message);
      return res.status(500).json({ success: false, error: 'Could not load this page.' });
    }
  });

  router.put('/coach/coach-training/progress/:key', ...guards, async (req, res) => {
    const key = req.params && req.params.key;
    if (!MODULE_KEYS.includes(key)) return res.status(404).json({ success: false, error: 'Not found' });
    const want = req.body && req.body.done;
    if (want !== true && want !== false) return res.status(400).json({ success: false, error: 'done must be true or false' });
    try {
      const userId = req.session.portalUserId;
      const prefs = await readPrefs(userId);
      const done = doneOf(prefs);
      if (want) done[key] = done[key] || now().toISOString();
      else delete done[key];
      const { error } = await supabase.from('users').update({ preferences: { ...prefs, [PREF_KEY]: done } }).eq('id', userId);
      if (error) throw error;
      return res.json({ success: true, done });
    } catch (err) {
      return failed(res, 'progress write', err);
    }
  });

  return router;
}

module.exports = { createCoachTrainingProgressRouter, MODULE_KEYS, PREF_KEY };
